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
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listUpcomingBroadcasts, getBroadcast, listStreams, transitionBroadcast } from './lib/yt-api.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(HERE, '.showtime-state');
fs.mkdirSync(STATE, { recursive: true });
const LEAD_MIN = Number(process.env.SHOWTIME_LEAD_MIN || 10);
const STOP_AFTER_MIN = Number(process.env.SHOWTIME_STOP_AFTER_MIN || 6);
const stamp = () => new Date().toLocaleTimeString();
const log = (...a) => console.log(`[${stamp()}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const envFile = fs.existsSync(path.join(HERE, '.env')) ? fs.readFileSync(path.join(HERE, '.env'), 'utf8') : '';
const SLOP_TOKEN = (envFile.match(/^SLOP_TOKEN=(.+)$/m) || [])[1]?.trim();

async function fanout(action) { // action: start|stop, both destinations
  if (!SLOP_TOKEN) { log('⚠ no SLOP_TOKEN — cannot control fanouts'); return; }
  for (const id of ['youtube', 'twitter']) {
    const r = await fetch(`https://live.slop.computer/admin/fanouts/${id}/${action}`, {
      method: 'POST', headers: { Authorization: `Bearer ${SLOP_TOKEN}` },
    }).catch((e) => ({ ok: false, statusText: e.message }));
    log(`fanout ${id} ${action}: ${r.ok ? 'ok' : r.statusText}`);
  }
}

function localHM(iso) { // ISO → "3:30 PM" local
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function ensureClone() { // the X leg needs the 9223 headless clone
  try { execSync('curl -s --max-time 3 http://127.0.0.1:9223/json/version', { stdio: 'pipe' }); return true; }
  catch {
    log('9223 clone down — launching headless');
    try { execSync(`bash ${HERE}/launch-clone.sh "${HERE}/profiles/chrome-ethereum" 9223 headless chrome`, { stdio: 'pipe', timeout: 60000 }); return true; }
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

// ---- scan --------------------------------------------------------------
const upcoming = await listUpcomingBroadcasts();
const now = Date.now();
const next = upcoming
  .filter((b) => b.scheduledStart)
  .map((b) => ({ ...b, t: new Date(b.scheduledStart).getTime() }))
  .filter((b) => b.t > now - 5 * 60_000 && b.t < now + LEAD_MIN * 60_000)
  .sort((a, b) => a.t - b.t)[0];

if (!next) process.exit(0); // nothing within the window — exit silently, launchd re-runs in 5 min

const marker = path.join(STATE, `${next.id}.armed`);
if (fs.existsSync(marker)) process.exit(0); // this episode is already being handled
fs.writeFileSync(marker, new Date().toISOString());
log(`ARMING "${next.title}" @ ${localHM(next.scheduledStart)} (yt=${next.id})`);

// ---- arm ---------------------------------------------------------------
await fanout('start');
const cloneOk = ensureClone();
const fireAt = localHM(next.scheduledStart);

const legs = [
  run('node', ['go-live-youtube.mjs', '--id', next.id, '--at', fireAt, '--arm'], {}, 'YT'),
];
if (cloneOk) legs.push(run('node', ['x-live-watchdog.mjs', '--arm', '--grace', '15'], { X_TITLE: next.title, X_FIRE_AT: fireAt }, 'X'));
else log('⚠ X leg skipped (no clone) — YouTube still fires');
const codes = await Promise.all(legs);
log(`go-live legs done (exit codes: ${codes.join(',')})`);

// ---- watch the show, auto-stop when the feed ends ----------------------
let goneSince = null;
for (;;) {
  await sleep(60_000);
  const b = await getBroadcast(next.id).catch(() => null);
  if (!b || b.lifeCycleStatus === 'complete') { log('YT broadcast complete — teardown'); break; }
  if (b.lifeCycleStatus !== 'live') { log(`YT broadcast state=${b.lifeCycleStatus} — waiting`); continue; }
  const active = (await listStreams().catch(() => [])).some((s) => s.status === 'active');
  if (active) { goneSince = null; continue; }
  goneSince ??= Date.now();
  const goneMin = (Date.now() - goneSince) / 60_000;
  log(`feed gone ${goneMin.toFixed(1)} min (auto-stop at ${STOP_AFTER_MIN})`);
  if (goneMin >= STOP_AFTER_MIN) {
    log('AUTO-STOP: ending both broadcasts + fanouts');
    await transitionBroadcast(next.id, 'complete').catch((e) => log(`YT end: ${e.message.slice(0, 100)}`));
    await run('node', ['end-x-livestream.mjs'], { X_TITLE: next.title }, 'X-end');
    break;
  }
}
await fanout('stop');
log('showtime complete');
