// Schedule the episode's YouTube broadcast via the Data API (cookie-free).
// Drop-in replacement for fill-yt-schedule.js in the pipeline — same env
// contract (YT_HANDLE, YT_DATE, YT_TIME, --submit), same idempotency (skips if
// an Upcoming broadcast for this @handle on this date already exists).
// With NO API creds in .env it execs fill-yt-schedule.js (the browser/cookie
// fallback) so the pipeline still works pre-OAuth.
//   YT_HANDLE=port_dev YT_DATE='Jun 18, 2026' YT_TIME='9:30 AM' node schedule-youtube-api.mjs [--submit]
//   node schedule-youtube-api.mjs --check     # just list upcoming broadcasts
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { episode, fetchSocialsDesc } from './lib/config.js';
import { haveCreds, whoAmI, listUpcomingBroadcasts, createBroadcast, setThumbnail, denverToISO } from './lib/yt-api.mjs';

const SUBMIT = process.argv.includes('--submit');

if (process.argv.includes('--check')) {
  const me = await whoAmI();
  console.log(`channel: ${me.title} (${me.id})${me.isSlopChannel ? ' ✓' : '  ✗ WRONG CHANNEL'}`);
  for (const b of await listUpcomingBroadcasts()) console.log(`  ${b.scheduledStart}  [${b.privacy}]  ${b.title}`);
  process.exit(0);
}

const HANDLE = process.env.YT_HANDLE, DATE = process.env.YT_DATE, TIME = process.env.YT_TIME;
if (!HANDLE || !DATE || !TIME) { console.error('set YT_HANDLE, YT_DATE, YT_TIME'); process.exit(1); }

if (!haveCreds()) {
  console.log('(no YT API creds — falling back to the browser/cookie path: fill-yt-schedule.js)');
  execFileSync('node', ['fill-yt-schedule.js', ...(SUBMIT ? ['--submit'] : [])], { stdio: 'inherit', env: process.env });
  process.exit(0);
}

const ep = episode(HANDLE);
const startISO = denverToISO(DATE, TIME);
const handleRe = new RegExp(`@${ep.handle}\\b`, 'i');

// Guard: right channel?
const me = await whoAmI();
if (!me.isSlopChannel) { console.error(`✗ token bound to wrong channel ("${me.title}") — re-run yt-oauth-setup.mjs as austin@concurrence.io`); process.exit(1); }

// IDEMPOTENT: an upcoming broadcast for this handle on this LOCAL date → skip.
const denverDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const upcoming = await listUpcomingBroadcasts();
const dupe = upcoming.find((b) => handleRe.test(b.title) && b.scheduledStart && denverDay(b.scheduledStart) === denverDay(startISO));
if (dupe) { console.log(`✓ already scheduled: "${dupe.title}" @ ${dupe.scheduledStart} — SKIP (no duplicate).`); process.exit(0); }

const DESC = await fetchSocialsDesc(ep.slug);
if (!DESC.trim()) { console.error('✗ empty description from fetchSocialsDesc — is SLOP_TOKEN the right per-room token?'); process.exit(1); }

console.log(`YouTube (API): "${ep.title}"`);
console.log(`  start=${DATE} ${TIME} (${startISO})  thumb=${ep.card}  desc=${DESC.slice(0, 50)}…`);
if (!SUBMIT) { console.log('\nDRY RUN — add --submit to create the broadcast.'); process.exit(0); }

const id = await createBroadcast({ title: ep.title, description: DESC, startISO });
console.log(`✓ broadcast created: https://studio.youtube.com/video/${id}/livestreaming`);
if (fs.existsSync(ep.card)) { await setThumbnail(id, ep.card); console.log('✓ thumbnail set'); }
else console.log(`⚠ card ${ep.card} not on disk — thumbnail NOT set (run the card/publish phases first)`);

// Verify like the browser path did: it must now be in Upcoming.
const after = await listUpcomingBroadcasts();
const mine = after.find((b) => b.id === id);
if (!mine) { console.error('✗ created but NOT found in Upcoming — investigate'); process.exit(1); }
console.log(`\nSCHEDULED ✅ — "${mine.title}" @ ${mine.scheduledStart} [${mine.privacy}]`);
