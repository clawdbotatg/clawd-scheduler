#!/usr/bin/env node
// ONE-COMMAND scheduler: runs the whole SLOP-WORKFLOW runbook deterministically,
// with no human copy-paste between steps (the old flow needed a hand-carried
// room token, invite link, handle, date and time across 5 commands).
//
//   node schedule-next.mjs                    # next calendar TODO episode, end to end
//   node schedule-next.mjs --plan             # read-only: print what a run would do
//   node schedule-next.mjs --handle econoar --date 'Aug 20, 2026' --time '10:00 AM'
//                                             # calendar-less (handle already known)
//
// What it does, in order (each step verifies itself and exits loudly on failure):
//   0. launch both clones headless (idempotent)
//   1. find the next calendar episode whose location is a TODO placeholder
//   2. resolve the guest's X handle (cache hit, or resolve-guest.js auto-accept;
//      any ASK AUSTIN → exit 2 with the question printed — the ONE human gate here)
//   3. find or create the room; capture the invite link
//   4. fetch the per-room token (reuse a verified .env one when present, else
//      copy-skill.js), write SLOP_TOKEN + SLOP_TOKEN_<SLUG> into .env, and
//      GET-verify it (Bearer /admin/fanouts must be 200) before proceeding
//   5. slop-episode.mjs --go through room→…→twitter (all gates pre-approved);
//      it stops at the onchain gate by design — that needs Austin's signature
//   6. check-episode.mjs verification table + exact commands for the two
//      remaining human steps (onchain signature, telegram notify)
//
// Deliberately NOT automated: the on-chain wallet signature and the guest
// Telegram send (see CLAUDE.md hard rules), plus any ambiguous guest handle.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
process.chdir(HERE);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const PLAN = process.argv.includes('--plan');
let HANDLE = (arg('--handle') || '').replace(/^@/, '') || null;
let DATE = arg('--date'), TIME = arg('--time');

const log = (s) => console.log(s);
const die = (msg, code = 1) => { console.error(`\n✗ ${msg}`); process.exit(code); };
const banner = (s) => log(`\n━━━ ${s}`);

// run a step script, stream its output indented, return {code, out}
function run(cmd, args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: HERE, env: { ...process.env, ...env } });
    let out = '';
    const pipe = (s) => s.on('data', (d) => { out += d; process.stdout.write(String(d).replace(/^/gm, '    ')); });
    pipe(p.stdout); pipe(p.stderr);
    p.on('exit', (code) => resolve({ code, out }));
  });
}
const node = (args, env) => run(process.execPath, args, env);

const envFile = () => fs.readFileSync('.env', 'utf8');
const envKey = (k) => (envFile().match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim() || null;
const tokenOk = async (tok) => {
  if (!tok || !/^[0-9a-f]{64}$/.test(tok)) return false;
  const r = await fetch('https://live.slop.computer/admin/fanouts', { headers: { Authorization: `Bearer ${tok}` } }).catch(() => null);
  return !!r?.ok;
};

// ---- 0. clones ------------------------------------------------------------
banner('0/6 clones (headless)');
const SOCIAL = envKey('SLOP_PORT_SOCIAL') || '9223';
if (PLAN) log(`    would launch chrome-ethereum:${SOCIAL} + canary-concurrence:9224 headless`);
else {
  await run('bash', ['launch-clone.sh', path.join(HERE, 'profiles/chrome-ethereum'), SOCIAL, 'headless', 'chrome']);
  await run('bash', ['launch-clone.sh', path.join(HERE, 'profiles/canary-concurrence'), '9224', 'headless']);
}

// ---- 1. next TODO episode ---------------------------------------------------
let guestEmail = null;
if (!HANDLE || !DATE || !TIME) {
  banner('1/6 next calendar episode needing a link');
  const { findNextSlopNeedingLink } = await import('./workflows/find-next-slop.js');
  const { nextNeedingLink: ep } = await findNextSlopNeedingLink(Number(SOCIAL));
  if (!ep) die('no upcoming episode has a TODO location — nothing to schedule. (Pass --handle/--date/--time to schedule without a calendar event.)', 0);
  DATE = DATE || ep.date;
  TIME = TIME || (ep.timeRange || '').split('–')[0].trim();
  log(`    ${ep.title}  →  ${DATE} ${TIME}`);
  if (!DATE || !TIME) die(`could not parse date/time from calendar event ("${ep.date}" / "${ep.timeRange}")`);
} else banner(`1/6 calendar lookup skipped (—handle/--date/--time given): ${DATE} ${TIME}`);

// ---- 2. guest handle --------------------------------------------------------
banner('2/6 guest X handle');
if (!HANDLE) {
  const r = await node(['resolve-guest.js']);
  const auto = r.out.match(/AUTO-ACCEPT \(confident\): @(\w+)/) || r.out.match(/CACHE HIT: (\S+) -> @(\w+)/);
  if (r.out.includes('ASK AUSTIN')) die('guest handle needs Austin — see the ASK AUSTIN line above. Re-run with --handle <answer> once confirmed.', 2);
  if (!auto) die('resolve-guest did not produce a confident handle — read its output above.', 2);
  HANDLE = auto[2] || auto[1];
}
log(`    guest: @${HANDLE}`);
const { episode } = await import('./lib/config.js');
const ep = episode(HANDLE);
log(`    slug: ${ep.slug}   title: ${ep.title}`);
if (PLAN) { log('\n(plan mode — stopping before any writes. Everything above is read-only.)'); process.exit(0); }

// ---- 3. room ---------------------------------------------------------------
banner('3/6 room');
let invite = null;
{
  const r = await node(['find-room.js', HANDLE]);
  if (!r.out.includes('FOUND:')) {
    const c = await node(['create-room.js', ep.slug]);
    invite = (c.out.match(/https:\/\/live\.slop\.computer\/[a-z0-9-]+\?invite=\S+/) || [])[0];
    if (!invite) die('create-room did not print a shareable invite link.');
  }
}

// ---- 4. per-room token → .env, verified -------------------------------------
banner('4/6 room token');
const slugKey = `SLOP_TOKEN_${ep.slug.toUpperCase().replace(/-/g, '_')}`;
let token = envKey(slugKey);
if (await tokenOk(token)) log(`    reusing verified ${slugKey} from .env`);
else {
  const target = invite || `https://live.slop.computer/${ep.slug}`;
  const r = await node(['copy-skill.js', target]);
  token = (r.out.match(/[?&]token=([0-9a-f]{64})/) || [])[1];
  if (!token) die('copy-skill did not yield a 64-hex room token.');
  if (!(await tokenOk(token))) die('room token failed verification (Bearer GET /admin/fanouts not 200) — never proceed on an unverified token.');
}
{ // SLOP_TOKEN = active episode token; keep the per-slug copy for later swaps
  let s = envFile();
  s = s.replace(/^SLOP_TOKEN=.*$/m, `SLOP_TOKEN=${token}`);
  if (!new RegExp(`^${slugKey}=`, 'm').test(s)) s = s.trimEnd() + `\n${slugKey}=${token}\n`;
  else s = s.replace(new RegExp(`^${slugKey}=.*$`, 'm'), `${slugKey}=${token}`);
  fs.writeFileSync('.env', s);
  log(`    .env updated: SLOP_TOKEN + ${slugKey} (verified ✓)`);
}

// ---- 5. all phases through twitter ------------------------------------------
banner('5/6 phases (room research pfp card publish calendar youtube twitter)');
const inviteArg = invite || `https://live.slop.computer/${ep.slug}`;
const r5 = await node(['slop-episode.mjs', '--handle', HANDLE, '--token', token,
  '--date', DATE, '--time', TIME, '--invite', inviteArg,
  '--go', '--pfp-ok', '--save-calendar', '--submit-youtube', '--submit-twitter']);
// stopping at the onchain gate is the EXPECTED end of the automated run
const stoppedAtOnchain = /STOP at "onchain"/.test(r5.out);
if (r5.code !== 0 && !stoppedAtOnchain) die(`slop-episode failed before the onchain gate (exit ${r5.code}) — read its output above; fix and re-run (idempotent).`);

// ---- 6. verify + remaining human steps --------------------------------------
banner('6/6 verification');
await node(['check-episode.mjs'], { CHK_HANDLE: HANDLE, CHK_DATE: DATE });
log(`
━━━ automated surfaces done. Two human steps remain:
  1) ON-CHAIN (Austin signs):
       bash launch-clone.sh "$PWD/profiles/chrome-ethereum" ${SOCIAL} headed chrome
       node slop-episode.mjs --handle ${HANDLE} --token ${token.slice(0, 6)}… --date '${DATE}' --time '${TIME}' --invite '${inviteArg}' --go --only onchain --submit-onchain
       # then IMMEDIATELY relaunch ${SOCIAL} headless
  2) NOTIFY guest (Austin sends):
       node notify-guest.mjs ${HANDLE}
`);
