// ───────────────────────────────────────────────────────────────────────────
// SLOP.COMPUTER episode orchestrator — the "main workflow".
// Runs every pipeline step in order from a single guest @handle, with a SAFETY
// GATE on each step that writes or needs human judgment. Default = PLAN (prints
// the exact command for every phase, touches nothing). Add --go to execute.
//
//   node slop-episode.mjs --handle port_dev --date 'Jun 18, 2026' --time '9:30 AM'
//       → prints the full plan, runs nothing.
//   node slop-episode.mjs --handle port_dev ... --go
//       → runs read/idempotent phases, STOPS at the first gate it lacks a flag
//         for, and prints the resume command.
//
// Gate flags (each opts past one human checkpoint):
//   --create-room      create the room if find-room reports none (WRITE)
//   --pfp-ok           proceed past the "is this the right face?" check to card
//   --save-calendar    actually save the calendar edit (silent, never emails)
//   --submit-youtube   click Done to schedule the YouTube broadcast (else stops for review)
//   --submit-twitter   create the X/Twitter livestream (else stops for review)
//   --submit-onchain   click SCHEDULE EPISODE → YOU sign the wallet tx (else stops for review)
//
// Every scheduling phase is IDEMPOTENT: it checks whether this episode is already
// scheduled on that surface (calendar link / YouTube Upcoming / X Producer /
// slop.computer) and SKIPS if so — safe to re-run, never double-books.
//
// Scope flags:  --from <phase>   start at a phase (skip earlier)
//               --only <phase>   run just one phase
//   phases: room research pfp card publish calendar youtube twitter onchain notify
// `notify` is the manual-send finale: it copies the guest's Telegram welcome
// message + room invite to the clipboard (you paste & send — never auto-sent).
//
// Per-episode inputs:  --handle (req) --token <roomToken> --date --time
//                      --duration <min> (X broadcast length, default 70) --invite <roomUrl> --match
// The relay token is PER-ROOM (not global). Get it from the room's invite link:
//   node copy-skill.js '<inviteUrl>'   → prints .../v1/skill?token=<ROOM_TOKEN>&slug=…
// Pass that 64-hex token as --token (used for research/card/publish/description).
// Discovery:  run `node resolve-guest.js` first to find+confirm the handle.
// ───────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { episode, TOKEN, PORTS } from './lib/config.js';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

// Calendar match default: the event title rarely contains the @handle (e.g.
// @0xzak's calendar event is "Zak Cole and Austin Griffith"). Prefer the guest's
// resolved episode title from data/guest-twitter.json (keyed by email; carries
// handle + episode), falling back to the handle-as-words.
function defaultMatch(h) {
  try {
    const cache = JSON.parse(fs.readFileSync(new URL('./data/guest-twitter.json', import.meta.url), 'utf8'));
    const hit = Object.values(cache).find((v) => String(v.handle).toLowerCase() === h.toLowerCase());
    if (hit?.episode) return hit.episode;                       // "Zak Cole and Austin Griffith"
    if (hit?.name) { const n = hit.name.split('@')[0].trim(); if (n) return n; }
  } catch { /* no cache — fall through */ }
  return h.replace(/[_-]/g, ' ');
}

const handle = opt('handle');
if (!handle) { console.error('usage: node slop-episode.mjs --handle <x> [--date .. --time .. --invite .. --go]\n(run resolve-guest.js first to discover the handle)'); process.exit(1); }
const ep = episode(handle);
const GO = flag('go');
const TOK = opt('token', TOKEN);                    // PER-ROOM token (see copy-skill.js); --token wins
const tokenSource = opt('token') ? '--token' : (TOK ? '.env/SLOP_TOKEN' : 'NONE');
const DATE = opt('date', 'Jun 18, 2026');
const TIME = opt('time', '9:30 AM');
const DURATION = opt('duration', '70');             // X broadcast length in minutes
const INVITE = opt('invite');                       // room share link (for calendar)
const MATCH = opt('match', defaultMatch(ep.handle)); // calendar title match
const FROM = opt('from');
const ONLY = opt('only');

const node = (args, env = {}) => execFileSync('node', args, { stdio: 'inherit', env: { ...process.env, ...env } });

// Phase table — order matters. gate:null = always-runnable (read/idempotent).
const phases = [
  { name: 'room', desc: 'find the room; create it if missing',
    cmd: [`find-room.js`, ep.handle],
    gate: { flag: 'create-room', when: 'find-room reports no room', run: [`create-room.js`, ep.slug] } },
  { name: 'research', desc: 'kick guest research + poll until done',
    cmd: [`kick-research.mjs`, ep.slug, ep.at] },
  { name: 'pfp', desc: `download @${ep.handle} profile pic → ${ep.pfp}`,
    cmd: [`get-pfp.js`, ep.handle] },
  { name: 'card', desc: 'generate the episode card from the pfp',
    cmd: [`card-from-pfp.mjs`, ep.slug, ep.pfp],
    gate: { flag: 'pfp-ok', when: 'before baking the card — VERIFY the pfp is the right person' } },
  { name: 'publish', desc: 'server-side bake + publish the unfurl image',
    cmd: [`publish-card.mjs`, ep.slug, TOK, ep.card] },
  { name: 'calendar', desc: 'write room link + blurb + questions into the cal event (silent)',
    cmd: () => { if (!INVITE) throw new Error('calendar needs --invite <roomUrl>'); return [`update-calendar-event.mjs`, '--day', DATE, '--match', MATCH, '--link', INVITE, '--token', TOK, ...(flag('save-calendar') ? ['--save'] : [])]; },
    gate: { flag: 'save-calendar', when: 'without it this is a DRY RUN (fills, screenshots, does not save)' } },
  { name: 'youtube', desc: `schedule the YouTube broadcast (${DATE} ${TIME}) — API (cookie-free) when creds exist, else browser`,
    cmd: [`schedule-youtube-api.mjs`, ...(flag('submit-youtube') ? ['--submit'] : [])],
    env: { YT_HANDLE: ep.handle, YT_DATE: DATE, YT_TIME: TIME },
    gate: { flag: 'submit-youtube', when: 'without it the wizard is filled but STOPS before Done (review)' } },
  { name: 'twitter', desc: `schedule the X/Twitter livestream (${DATE} ${TIME}, ${DURATION}min)`,
    cmd: [`x-schedule.mjs`, ...(flag('submit-twitter') ? ['--submit'] : [])],
    env: { X_HANDLE: ep.handle, X_DATE: DATE, X_TIME: TIME, X_DURATION_MIN: String(DURATION) },
    gate: { flag: 'submit-twitter', when: 'without it the form is filled but STOPS before create (review). NB: on X, Cancel/Escape DELETES — x-schedule finishes by navigating away.' } },
  { name: 'onchain', desc: `register the episode on-chain via slop.computer (${DATE} ${TIME}) — YOU sign the wallet tx`,
    cmd: [`schedule-onchain.mjs`, ...(flag('submit-onchain') ? ['--submit'] : [])],
    env: { X_HANDLE: ep.handle, ONCHAIN_DATE: DATE, ONCHAIN_TIME: TIME },
    gate: { flag: 'submit-onchain', when: 'skips if already on slop.computer; otherwise fills the form, and WITH the gate clicks SCHEDULE EPISODE → a wallet tx pops up for YOU to sign (the script never signs).' } },
  { name: 'notify', desc: 'LAST: copy the guest Telegram welcome message + room invite to your clipboard (you paste/send it)',
    cmd: [`notify-guest.mjs`],
    env: { NOTIFY_HANDLE: ep.handle, NOTIFY_INVITE: INVITE || '' } },
];

let list = phases;
if (ONLY) list = phases.filter((p) => p.name === ONLY);
else if (FROM) { const i = phases.findIndex((p) => p.name === FROM); if (i < 0) { console.error('unknown --from', FROM); process.exit(1); } list = phases.slice(i); }

console.log(`\n━━━ SLOP episode: ${ep.title}`);
console.log(`    handle=@${ep.handle}  slug=${ep.slug}  card=${ep.card}`);
console.log(`    date=${DATE}  time=${TIME}  invite=${INVITE || '(none — pass --invite for calendar)'}`);
console.log(`    token=${TOK ? TOK.slice(0, 6) + '… (' + tokenSource + ')' : 'NONE — pass --token <roomToken> from copy-skill.js'}`);
console.log(`    mode=${GO ? 'GO (executing)' : 'PLAN (nothing runs — add --go)'}  ports: social=${PORTS.social} yt=${PORTS.youtube}\n`);
if (GO && !TOK) { console.error('✗ no room token. Pass --token <roomToken> (from copy-skill.js) or set SLOP_TOKEN.'); process.exit(1); }

for (const p of list) {
  const cmd = typeof p.cmd === 'function' ? (() => { try { return p.cmd(); } catch (e) { return { err: e.message }; } })() : p.cmd;
  const mask = (s) => (s === TOK ? TOK.slice(0, 6) + '…' : s); // don't print the full token
  const pretty = Array.isArray(cmd) ? `node ${cmd.map(mask).join(' ')}` : `(blocked: ${cmd.err})`;
  const envPretty = p.env ? Object.entries(p.env).map(([k, v]) => `${k}='${v}'`).join(' ') + ' ' : '';
  console.log(`▸ ${p.name} — ${p.desc}`);
  console.log(`    $ ${envPretty}${pretty}`);
  if (p.gate) console.log(`    ⚠ gate --${p.gate.flag}: ${p.gate.when}` + (flag(p.gate.flag) ? '  [SET]' : '  [not set]'));

  if (!GO) { console.log(); continue; }
  if (!Array.isArray(cmd)) { console.error(`\n✗ STOP at "${p.name}": ${cmd.err}\n`); process.exit(2); }
  try {
    node(cmd, { SLOP_TOKEN: TOK, ...(p.env || {}) }); // every child uses the per-room token
    // Gates that need a separate WRITE script (e.g. create-room) run only if flagged.
    if (p.gate?.run) {
      if (flag(p.gate.flag)) { console.log(`  → gate --${p.gate.flag} set: running ${p.gate.run.join(' ')}`); node(p.gate.run, { SLOP_TOKEN: TOK }); }
      else console.log(`  (gate --${p.gate.flag} not set — skipping the WRITE half; re-run with it if needed)`);
    }
    console.log(`  ✓ ${p.name} done\n`);
  } catch (e) {
    console.error(`\n✗ STOP at "${p.name}" (exit ${e.status}). Fix, then resume:\n    node slop-episode.mjs --handle ${ep.handle} --token ${TOK.slice(0, 6)}… --date '${DATE}' --time '${TIME}'${INVITE ? ` --invite ${INVITE}` : ''} --from ${p.name} --go\n`);
    process.exit(e.status || 1);
  }
}

if (GO) console.log('━━━ all selected phases complete.');
else console.log('━━━ plan only. Re-run with --go to execute (and add gate flags to pass write checkpoints).');
