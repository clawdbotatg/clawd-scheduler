#!/usr/bin/env node
// Move an already-scheduled YouTube broadcast to a new date/time — the
// cookie-free replacement for reschedule-youtube.mjs (which drove the banned
// 9224 Canary clone). Finds the broadcast by @handle (case-insensitive) in the
// channel's Upcoming list and PUTs the new scheduledStartTime via the Data API.
//
//   YT_HANDLE=ASvanevik YT_DATE='Sep 17, 2026' YT_TIME='5:00 PM' node reschedule-youtube-api.mjs [--submit]
//
// Without --submit it only prints what it would do. Remember: if the showtime
// watcher already armed this broadcast, delete .showtime-state/<id>.armed.
import { haveCreds, listUpcomingBroadcasts, rescheduleBroadcast, denverToISO } from './lib/yt-api.mjs';

const HANDLE = (process.env.YT_HANDLE || '').replace(/^@/, '');
const DATE = process.env.YT_DATE, TIME = process.env.YT_TIME;
const SUBMIT = process.argv.includes('--submit');
if (!HANDLE || !DATE || !TIME) { console.error('set YT_HANDLE, YT_DATE ("Mon DD, YYYY"), YT_TIME ("H:MM AM")'); process.exit(1); }
if (!haveCreds()) { console.error('no YT API creds in .env — see yt-oauth-setup.mjs'); process.exit(1); }

const target = denverToISO(DATE, TIME);
const hits = (await listUpcomingBroadcasts()).filter((b) => new RegExp(`@${HANDLE}\\b`, 'i').test(b.title));
if (hits.length !== 1) { console.error(`✗ expected exactly one upcoming broadcast for @${HANDLE}, found ${hits.length}:`, hits.map((h) => `${h.id} ${h.title}`)); process.exit(2); }
const [b] = hits;
console.log(`broadcast ${b.id} "${b.title}"\n  ${b.scheduledStart}  →  ${target}  submit=${SUBMIT}`);
if (new Date(b.scheduledStart).getTime() === new Date(target).getTime()) { console.log('✓ already at that time — nothing to do.'); process.exit(0); }
if (!SUBMIT) { console.log('dry run — pass --submit to apply.'); process.exit(0); }
const after = await rescheduleBroadcast(b.id, target);
if (new Date(after).getTime() !== new Date(target).getTime()) { console.error(`✗ read-back mismatch: ${after}`); process.exit(3); }
console.log(`RESCHEDULED ✅ ${b.id} now starts ${after} — if .showtime-state/${b.id}.armed exists, delete it.`);
