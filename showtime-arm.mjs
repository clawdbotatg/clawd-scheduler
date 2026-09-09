#!/usr/bin/env node
// SHOWTIME AUTO-ARM: the piece that removes the human (and the chat session)
// from going live. Run every 5 min by launchd (com.clawd.slop-showtime).
//
// Scan: the YouTube API's upcoming broadcasts are the schedule of record (the
// scheduling pipeline always creates YT + X together with the same title/time).
// When one starts within LEAD_MIN, this process stays alive and runs the whole
// showtime sequence:
//   T-10m  switch on relay fanouts (they self-heal-loop until OBS pushes)
//   T      go-live-youtube.mjs  (bind active key → transition live)
//   T+15s  x-live-watchdog.mjs  (press Go Live if X's own trigger didn't)
//   after  watch the feed; gone > STOP_AFTER_MIN while live → end YT + X,
//          switch fanouts off. Austin's lifecycle: OBS start … OBS stop.
//
// Needs in .env: YT_* OAuth creds, SLOP_TOKEN (per-room, set at scheduling
// time). Needs the 9223 clone for the X leg (launched headless if down).
// A marker file per broadcast id prevents double-arming across launchd runs.
//
// Fanout law (2026-09-08 + 09-09, two shows Austin had to rescue by hand): a
// relay token is never trusted by NAME. lib/relay-token.mjs probes every
// SLOP_TOKEN*/SLOP_AUTOMATION_TOKEN in .env against /admin/fanouts and uses
// the first live one; every start/stop is read back and CONFIRMED (`desired`),
// retried until confirmed, and a failure is shouted into the room chat. A
// daily tick keeps SLOP_AUTOMATION_TOKEN renewed so the pool never runs dry.
// If the feed is late, nothing gives up: the watch loop re-fires the YouTube
// and X legs until the show is live (or T+RETRY_MIN).
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listUpcomingBroadcasts, getBroadcast, listStreams, transitionBroadcast } from './lib/yt-api.mjs';
import { pickFanoutToken, fanoutControl, fanoutState, ensureAutomationToken } from './lib/relay-token.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(HERE, '.showtime-state');
fs.mkdirSync(STATE, { recursive: true });
const LEAD_MIN = Number(process.env.SHOWTIME_LEAD_MIN || 5);
const STOP_AFTER_MIN = Number(process.env.SHOWTIME_STOP_AFTER_MIN || 6);
const RETRY_MIN = Number(process.env.SHOWTIME_RETRY_MIN || 40); // keep re-firing go-live until T+this
const stamp = () => new Date().toLocaleTimeString();
const log = (...a) => console.log(`[${stamp()}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const envFile = fs.existsSync(path.join(HERE, '.env')) ? fs.readFileSync(path.join(HERE, '.env'), 'utf8') : '';
const SLOP_TOKEN = (envFile.match(/^SLOP_TOKEN=(.+)$/m) || [])[1]?.trim();
// CDP port for the X leg's chrome-ethereum clone. On clawd-heart 9223 is owned
// by the twitter-reader's chrome-x clone (the WRONG X account — attaching to it
// is why an X leg finds no Go Live button), so .env pins SLOP_PORT_SOCIAL=9225.
const PORT_SOCIAL = Number(process.env.SLOP_PORT_SOCIAL || (envFile.match(/^SLOP_PORT_SOCIAL=(.+)$/m) || [])[1] || 9223);

// The fanout credential is whichever .env token PROVES live right now (probed
// on every use — a token that 401s mid-show is re-picked from the pool).
let fanoutTok = null;
async function fanoutToken() {
  if (fanoutTok) return fanoutTok;
  fanoutTok = (await pickFanoutToken({ log }))?.token || null;
  return fanoutTok;
}
async function fanout(action, { deadlineMs } = {}) { // start|stop, both destinations, CONFIRMED or false
  const ok = await fanoutControl(action, { token: await fanoutToken(), log, deadlineMs });
  if (!ok) fanoutTok = null;
  return ok;
}

function localHM(iso) { // ISO → "3:30 PM" local
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Visible heartbeat: post into the ROOM CHAT so the human in the green room
// can tell "alive and about to fire" from "dead" (2026-08-24: with no signal
// Austin started the stream by hand at T-1min, which flipped the broadcast out
// of `upcoming` mid-window and silently disarmed the whole sequence — X leg
// and teardown included). Contract shown to him in the T-30 line: no ⚡ARMED
// by T-LEAD ⇒ the watcher is dead, go manual. Best-effort only — chat must
// never block or break arming.
async function say(text) {
  const tok = SLOP_TOKEN || (await fanoutToken());
  if (!tok) return;
  try {
    await fetch('https://live.slop.computer/v1/chat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) { log(`chat post failed: ${String(e.message || e).slice(0, 80)}`); }
}

function ensureClone() { // the X leg needs the chrome-ethereum headless clone
  try { execSync(`curl -s --max-time 3 http://127.0.0.1:${PORT_SOCIAL}/json/version`, { stdio: 'pipe' }); return true; }
  catch {
    log(`${PORT_SOCIAL} clone down — launching headless`);
    try { execSync(`bash ${HERE}/launch-clone.sh "${HERE}/profiles/chrome-ethereum" ${PORT_SOCIAL} headless chrome`, { stdio: 'pipe', timeout: 60000 }); return true; }
    catch (e) { log(`✗ clone launch failed: ${e.message.slice(0, 120)}`); return false; }
  }
}

function run(cmd, args, env, tag) { // spawn a leg, stream its lines into our log
  // launchd's PATH has no `node` — resolve it to the running binary or the
  // legs die at spawn with ENOENT (2026-08-02: killed a show's go-live).
  if (cmd === 'node') cmd = process.execPath;
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: HERE, env: { ...process.env, ...env } });
    const pipe = (s) => s.on('data', (d) => String(d).trim().split('\n').forEach((l) => l && log(`${tag}: ${l}`)));
    pipe(p.stdout); pipe(p.stderr);
    p.on('exit', (code) => resolve(code));
  });
}

// ---- daily token upkeep (once per calendar day, before any scan) -----------
{
  const day = new Date().toISOString().slice(0, 10);
  const m = path.join(STATE, `token-upkeep.${day}`);
  if (!fs.existsSync(m)) {
    fs.writeFileSync(m, new Date().toISOString());
    for (const f of fs.readdirSync(STATE)) if (f.startsWith('token-upkeep.') && f !== `token-upkeep.${day}`) fs.rmSync(path.join(STATE, f), { force: true });
    const r = await ensureAutomationToken({ log });
    if (r.status === 'no-source') await say('🚨 showtime: NO live relay token on the box — fanouts cannot be automated. Someone must SIWE at live.slop.computer/admin and re-mint (see SLOP-WORKFLOW.md).');
  }
}

// ---- scan --------------------------------------------------------------
const upcoming = await listUpcomingBroadcasts();
const now = Date.now();
const stamped = upcoming
  .filter((b) => b.scheduledStart)
  .map((b) => ({ ...b, t: new Date(b.scheduledStart).getTime() }));

// T-ANNOUNCE .. T: tell the room the watcher is alive and exactly when it will
// fire, once per broadcast (.announced marker). This is the promise the human
// can hold us to: a chat line well before the window, and ⚡ARMED at T-LEAD.
// It doubles as the PREFLIGHT: the fanout token is probed here, 30 min out,
// so a dead pool is shouted while there is still time to fix it by hand.
const ANNOUNCE_MIN = Number(process.env.SHOWTIME_ANNOUNCE_MIN || 30);
for (const b of stamped.filter((b) => b.t > now && b.t < now + ANNOUNCE_MIN * 60_000)) {
  const m = path.join(STATE, `${b.id}.announced`);
  if (fs.existsSync(m)) continue;
  fs.writeFileSync(m, new Date().toISOString());
  log(`pre-announce "${b.title}" @ ${localHM(b.scheduledStart)}`);
  const tok = await fanoutToken();
  const armAt = localHM(b.t - LEAD_MIN * 60_000);
  if (tok) await say(`🤖 showtime watcher ALIVE for "${b.title}" — preflight ✓ relay token live. I arm at ${armAt} (fanouts on, confirmed), YouTube goes live at ${localHM(b.scheduledStart)}, X ~15s after. Just start OBS — do NOT press go-live by hand, a manual start disarms me. If no ⚡ARMED line lands here by ${armAt}, I'm dead: go manual.`);
  else await say(`🚨 showtime watcher for "${b.title}": preflight FAILED — no relay token on the box passes /admin/fanouts. I will keep retrying, but plan to switch the fanouts on BY HAND at live.slop.computer/admin at ${armAt} if no ⚡ARMED line lands here.`);
}

const next = stamped
  .filter((b) => b.t > now - 5 * 60_000 && b.t < now + LEAD_MIN * 60_000)
  .sort((a, b) => a.t - b.t)[0];

if (!next) process.exit(0); // nothing within the window — exit silently, launchd re-runs in 5 min

const marker = path.join(STATE, `${next.id}.armed`);
if (fs.existsSync(marker)) process.exit(0); // this episode is already being handled
fs.writeFileSync(marker, new Date().toISOString());
log(`ARMING "${next.title}" @ ${localHM(next.scheduledStart)} (yt=${next.id})`);

// ---- arm ---------------------------------------------------------------
// Fanouts on, CONFIRMED by the relay. ~45 s of quick retries here; if still
// unconfirmed, shout, and keep pushing in the background until T+5 — the
// go-live legs are spawned regardless so YouTube/X fire the moment the pipe
// carries data.
let fanoutsOn = await fanout('start');
const fireAt = localHM(next.scheduledStart);
if (fanoutsOn) await say(`⚡ ARMED — fanouts are ON (relay confirmed). YouTube fires at ${fireAt}, X ~15s after. Hands off the go-live buttons; your only job is OBS.`);
else {
  await say(`🚨 ARMING FAILED — the relay did NOT confirm the fanouts on. Switch YouTube + X fanouts on BY HAND at live.slop.computer/admin NOW. I keep retrying and will still fire YouTube/X once the feed reaches them.`);
  fanout('start', { deadlineMs: next.t + 5 * 60_000 }).then((ok) => { fanoutsOn = ok; if (ok) say('✓ fanouts came up on retry — relay confirmed.'); });
}
const cloneOk = ensureClone();

// process.execPath, not 'node': under launchd PATH has no node dir, so a bare
// 'node' spawn dies ENOENT after the fanouts are already on (2026-08-02).
const ytLeg = () => run(process.execPath, ['go-live-youtube.mjs', '--id', next.id, '--at', fireAt, '--arm'], {}, 'YT');
const xLeg = () => run(process.execPath, ['x-live-watchdog.mjs', '--arm', '--grace', '15'], { X_TITLE: next.title, X_FIRE_AT: fireAt, SLOP_PORT_SOCIAL: String(PORT_SOCIAL) }, 'X');
const legs = [ytLeg()];
if (cloneOk) legs.push(xLeg());
else log('⚠ X leg skipped (no clone) — YouTube still fires');
let codes = await Promise.all(legs);
log(`go-live legs done (exit codes: ${codes.join(',')})`);
let ytOk = codes[0] === 0;
let xOk = cloneOk ? codes[1] === 0 : false;
await say(codes.every((c) => c === 0)
  ? `✅ LIVE — YouTube + X are rolling. I'll auto-stop everything ~${STOP_AFTER_MIN} min after the OBS feed ends.`
  : `⚠ go-live legs exited ${codes.join(',')} — I keep retrying until ${localHM(next.t + RETRY_MIN * 60_000)}. CHECK YouTube and X by hand meanwhile, one of them may not be live.`);

// ---- watch the show, auto-stop when the feed ends ----------------------
// Not live yet? Keep the fanouts pushed on and re-fire the legs each minute
// until T+RETRY_MIN (09-09: the feed reached YouTube at T+7 after a manual
// fanout and the old loop just logged "state=testing — waiting" for 90 min).
let goneSince = null;
let xRetries = 0;
for (;;) {
  await sleep(60_000);
  const b = await getBroadcast(next.id).catch(() => null);
  if (!b || b.lifeCycleStatus === 'complete') { log('YT broadcast complete — teardown'); break; }
  if (b.lifeCycleStatus !== 'live') {
    log(`YT broadcast state=${b.lifeCycleStatus} — waiting`);
    if (Date.now() < next.t + RETRY_MIN * 60_000) {
      if (!fanoutsOn) fanoutsOn = await fanout('start');
      const active = (await listStreams().catch(() => [])).some((s) => s.status === 'active');
      if (active) { log('feed is on YouTube but broadcast not live — re-firing YT leg'); ytOk = (await ytLeg()) === 0; }
    }
    continue;
  }
  if (!ytOk) { ytOk = true; await say(`✅ YouTube is LIVE (late) — https://youtube.com/watch?v=${next.id}`); }
  if (!xOk && cloneOk && xRetries < 3 && Date.now() < next.t + RETRY_MIN * 60_000) {
    xRetries++;
    log(`X not confirmed live — re-firing X leg (retry ${xRetries})`);
    xOk = (await xLeg()) === 0;
    if (xOk) await say('✅ X is LIVE (late).');
  }
  const active = (await listStreams().catch(() => [])).some((s) => s.status === 'active');
  if (active) { goneSince = null; continue; }
  goneSince ??= Date.now();
  const goneMin = (Date.now() - goneSince) / 60_000;
  log(`feed gone ${goneMin.toFixed(1)} min (auto-stop at ${STOP_AFTER_MIN})`);
  if (goneMin >= STOP_AFTER_MIN) {
    log('AUTO-STOP: ending both broadcasts + fanouts');
    await transitionBroadcast(next.id, 'complete').catch((e) => log(`YT end: ${e.message.slice(0, 100)}`));
    await run('node', ['end-x-livestream.mjs'], { X_TITLE: next.title, SLOP_PORT_SOCIAL: String(PORT_SOCIAL) }, 'X-end');
    break;
  }
}
const off = await fanout('stop', { deadlineMs: Date.now() + 3 * 60_000 });
await say(off ? '📴 show over — YouTube + X ended, fanouts off (relay confirmed). Good show.'
  : '⚠ show over — YouTube + X ended, but the relay did NOT confirm the fanouts off. Switch them off by hand at live.slop.computer/admin.');
log('showtime complete');
