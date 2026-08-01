#!/usr/bin/env node
// WATCHDOG (YouTube leg): press "Go Live" on a scheduled YouTube broadcast at
// its scheduled minute — the API twin of x-live-watchdog.mjs.
//
// Broadcasts are created with enableAutoStart=false on purpose (the rig streams
// into the key early for preview; auto-start would go live too soon). So at
// showtime this: binds the broadcast to the stream key receiving data → waits
// for the feed to be active → transitions testing (if monitor is on) → live.
//
//   node go-live-youtube.mjs --id kDDQfsIyXjA --at '3:00 PM' --arm
//   node go-live-youtube.mjs --id kDDQfsIyXjA --arm          # fire immediately
//
// Without --arm: reports what it would do (bind state, stream status), touches
// nothing.
import { getBroadcast, listStreams, bindBroadcast, transitionBroadcast } from './lib/yt-api.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const ID = arg('--id');
const AT = arg('--at'); // "H:MM PM" local; omit = now
const ARM = process.argv.includes('--arm');
if (!ID) { console.error('usage: go-live-youtube.mjs --id <broadcastId> [--at "H:MM PM"] [--arm]'); process.exit(1); }
const stamp = () => new Date().toLocaleTimeString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let b = await getBroadcast(ID);
console.log(`YT go-live: "${b.title}" (${ID})  state=${b.lifeCycleStatus}  bound=${b.boundStreamId || 'NO'}  monitor=${b.monitorEnabled}`);
if (b.lifeCycleStatus === 'live') { console.log('✓ already live — nothing to do'); process.exit(0); }
if (b.lifeCycleStatus === 'complete') { console.log('✗ broadcast already ended'); process.exit(1); }

// which stream key is (or will be) carrying the feed?
const pickStream = async () => {
  const streams = await listStreams();
  for (const s of streams) console.log(`  stream ${s.id} "${s.title}" status=${s.status} health=${s.health}`);
  return streams.find((s) => s.status === 'active') || (streams.length === 1 ? streams[0] : null);
};

if (!ARM) {
  await pickStream();
  console.log(`(dry run) would: bind if needed → wait for active feed → transition to live${AT ? ` at ${AT}` : ' now'}. Re-run with --arm.`);
  process.exit(0);
}

// wait for the scheduled minute
if (AT) {
  const m = AT.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) { console.error(`bad --at "${AT}"`); process.exit(1); }
  const fireS = (((+m[1] % 12) + (/pm/i.test(m[3]) ? 12 : 0)) * 60 + +m[2]) * 60;
  const nowS = () => { const d = new Date(); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(); };
  if (nowS() < fireS) console.log(`[${stamp()}] waiting until ${AT}…`);
  while (nowS() < fireS) await sleep(5000);
}
console.log(`[${stamp()}] firing`);

// 1) bind to the active stream key (idempotent if already bound)
let stream = await pickStream();
if (!stream) { console.error('✗ no active stream and multiple keys — cannot pick; is the rig streaming?'); process.exit(1); }
if (b.boundStreamId !== stream.id) {
  await bindBroadcast(ID, stream.id);
  console.log(`✓ bound to stream ${stream.id}`);
} else console.log('✓ already bound');

// 2) wait for the feed (rig must be pushing) — up to 3 min
for (let i = 0; stream.status !== 'active' && i < 36; i++) {
  await sleep(5000);
  stream = (await listStreams()).find((s) => s.id === stream.id);
  console.log(`[${stamp()}] stream=${stream.status} health=${stream.health}`);
}
if (stream.status !== 'active') { console.error('✗ stream never went active — rig is not pushing to YouTube'); process.exit(1); }

// 3) transition: testing first when the monitor stream is on (YT requires it)
const waitFor = async (states, tries = 24) => {
  for (let i = 0; i < tries; i++) {
    b = await getBroadcast(ID);
    console.log(`[${stamp()}] broadcast=${b.lifeCycleStatus}`);
    if (states.includes(b.lifeCycleStatus)) return true;
    await sleep(5000);
  }
  return false;
};
b = await getBroadcast(ID);
if (b.monitorEnabled && ['ready', 'created'].includes(b.lifeCycleStatus)) {
  await transitionBroadcast(ID, 'testing').catch((e) => console.log(`(testing transition: ${e.message.slice(0, 120)})`));
  if (!(await waitFor(['testing', 'live']))) { console.error('✗ stuck before testing'); process.exit(1); }
}
if (b.lifeCycleStatus !== 'live') {
  await transitionBroadcast(ID, 'live');
  if (!(await waitFor(['live']))) { console.error('✗ transition to live did not stick'); process.exit(1); }
}
console.log(`✅ YOUTUBE LIVE at ${stamp()} — https://youtube.com/watch?v=${ID}`);
