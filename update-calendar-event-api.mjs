// Step 11a via the Google Calendar API — same edit as update-calendar-event.mjs
// (title prefix, location = room link, description = intro + link + the host's
// common questions) with no browser. ALWAYS silent: sendUpdates=none.
//
//   node update-calendar-event-api.mjs --day 2026/10/20 --match "SLOP.COMPUTER" \
//     --link "https://live.slop.computer/<slug>?invite=..." --token <bearer> [--save]
//
// Picks the one event that day whose title contains --match, skipping the
// "Prepare:"/"Wrap up:" blocks; if several remain, the one with a TODO location.
// Still ambiguous → exits 1 and lists them. Without --save it prints the diff only.
import { eventsOnDay, patchEvent, getEvent } from './lib/cal-api.mjs';
import { normDay, INTRO, TITLE_PREFIX } from './lib/cal-text.mjs';

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const DAY = normDay(arg('--day'));
const MATCH = arg('--match'), LINK = arg('--link'), TOKEN = arg('--token');
const SAVE = args.includes('--save');
if (!DAY || !MATCH || !LINK || !TOKEN) {
  console.error('usage: --day YYYY/M/D --match "<title substr>" --link <roomLink> --token <bearer> [--save]');
  process.exit(1);
}

const all = await eventsOnDay(DAY);
let hits = all.filter((e) => (e.summary || '').toLowerCase().includes(MATCH.toLowerCase()) && !/^(prepare|wrap up):/i.test(e.summary || ''));
// Already done? (re-run is a no-op)
const done = hits.find((e) => (e.location || '').includes(LINK));
if (done) { console.log(`✓ calendar already has the room link: "${done.summary}" ${done.start.dateTime}`); process.exit(0); }
if (hits.length > 1) hits = hits.filter((e) => /TODO/i.test(e.location || ''));
if (hits.length !== 1) {
  console.error(`✗ need exactly one event matching "${MATCH}" on ${DAY}, found ${hits.length}:`);
  for (const e of all) console.error(`   ${e.start?.dateTime}  ${e.summary}  [${e.location || ''}]`);
  process.exit(1);
}
const ev = hits[0];

const q = (await (await fetch('https://live.slop.computer/v1/admin/questions', { headers: { Authorization: `Bearer ${TOKEN}` } })).json()).text || '';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const toHtml = (s) => esc(s).replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
const description = toHtml(`${INTRO}\n\n${LINK}\n\n${q}`);
const summary = (ev.summary || '').startsWith(TITLE_PREFIX) ? ev.summary : TITLE_PREFIX + ev.summary;

console.log(`event: "${ev.summary}" ${ev.start.dateTime}\n  title    → ${summary}\n  location → ${LINK}\n  description → intro + link + ${q.length}-char questions`);
if (!SAVE) { console.log('(dry run — pass --save to write; it never emails the guest)'); process.exit(0); }

await patchEvent(ev.id, { summary, location: LINK, description });
const back = await getEvent(ev.id);
if (!(back.location || '').includes(LINK)) { console.error('✗ saved but read-back location does not show the link'); process.exit(1); }
console.log('✓ calendar saved silently (sendUpdates=none) and read back');
