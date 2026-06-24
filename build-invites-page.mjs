// Build a little local HTML dashboard of guest Telegram invites — one card per
// upcoming episode, each with a "copy message + link" button — and open it on the
// user's screen. They paste & send each as the call comes up (we never auto-send a
// private room link toward a guessed contact). The per-guest clipboard version is
// notify-guest.mjs; this is the cross-episode, copy-as-you-go view.
//
//   node build-invites-page.mjs [--no-open] [--out <path>]
//
// Discovers episodes straight from the calendar (so it always reflects current,
// post-reschedule times) — every upcoming event whose location is a real
// live.slop.computer/<slug>?invite=… room link. The welcome blurb is shared with
// notify-guest.mjs via lib/config.js (GUEST_BLURB) so the two never drift.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { connectCDP } from './lib/connect.js';
import { guestMessage, PORTS } from './lib/config.js';
import { handleToSlug } from './lib/slugify.js';
import { searchSlopEpisodes } from './workflows/find-next-slop.js';

const OUT = (() => { const i = process.argv.indexOf('--out'); return i >= 0 ? process.argv[i + 1] : '/tmp/slop-invites.html'; })();
const NO_OPEN = process.argv.includes('--no-open');
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Optional guest cache (gitignored) → slug→{handle,note} for nicer labels.
let bySlug = {};
try {
  const cache = JSON.parse(fs.readFileSync(new URL('./data/guest-twitter.json', import.meta.url), 'utf8'));
  for (const v of Object.values(cache)) if (v?.handle) bySlug[handleToSlug(v.handle)] = v;
} catch { /* no cache — labels fall back to the calendar title */ }

const { browser, page } = await connectCDP(PORTS.social);
let upcomingEpisodes;
try { ({ upcomingEpisodes } = await searchSlopEpisodes(page)); }
finally { await browser.close(); }

const episodes = upcomingEpisodes
  .map((e) => {
    const m = (e.location || '').match(/https:\/\/live\.slop\.computer\/([^?]+)\?invite=\S+/i);
    if (!m) return null;                              // skip TODO-link / no-room episodes
    const slug = m[1];
    const invite = e.location;
    const cached = bySlug[slug];
    const name = (e.title || '').replace(/^Slop\.Computer:\s*/i, '').replace(/\s+and\s+Austin Griffith\s*$/i, '').trim() || slug;
    const when = e.start ? `${WD[e.start.getDay()]} ${MO[e.start.getMonth()]} ${e.start.getDate()} · ${(e.timeRange || '').split('–')[0] || ''}` : (e.date || '');
    return { name, handle: cached?.handle ? `@${cached.handle}` : '', slug, when, link: invite, text: guestMessage(invite) };
  })
  .filter(Boolean);

const data = JSON.stringify(episodes);
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SLOP.COMPUTER — guest invites to send</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         background:#0c0c12; color:#e8e8f0; padding:28px 18px 60px; }
  h1 { font-size:22px; margin:0 0 4px; letter-spacing:.3px; }
  .sub { color:#9a9ab0; margin:0 0 24px; font-size:13px; }
  .grid { display:grid; gap:18px; max-width:760px; margin:0 auto; }
  .card { background:#15151f; border:1px solid #26263a; border-radius:14px; padding:18px 18px 16px; }
  .row { display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .name { font-size:17px; font-weight:600; }
  .handle { color:#7bd5ff; font-weight:500; }
  .when { color:#ffd479; font-size:13px; font-weight:600; white-space:nowrap; }
  .meta { color:#8a8aa0; font-size:12px; margin:2px 0 12px; }
  textarea { width:100%; height:120px; resize:vertical; background:#0e0e16; color:#cfcfe0;
             border:1px solid #2a2a40; border-radius:9px; padding:10px 12px; font:13px/1.45 inherit; }
  .btns { display:flex; gap:10px; margin-top:12px; flex-wrap:wrap; }
  button { cursor:pointer; border:0; border-radius:9px; padding:10px 16px; font-size:14px; font-weight:600;
           transition:background .15s, transform .05s; }
  button:active { transform:translateY(1px); }
  .primary { background:#5b7cfa; color:#fff; }
  .primary:hover { background:#4a6bf0; }
  .ghost { background:#23233a; color:#cfcfe0; }
  .ghost:hover { background:#2c2c48; }
  .ok { background:#2faa6a !important; color:#fff !important; }
  .empty { color:#9a9ab0; text-align:center; padding:40px; }
  .foot { max-width:760px; margin:26px auto 0; color:#70708a; font-size:12px; }
</style></head>
<body>
  <h1>SLOP.COMPUTER — guest invites</h1>
  <p class="sub">Paste into each guest's Telegram and send (you send these — nothing auto-sends). Ordered by call time.</p>
  <div class="grid" id="grid"></div>
  <p class="foot">Message + room link copy as one paste (the blurb is one line; the only newline is before the link). Re-run <code>node build-invites-page.mjs</code> to refresh.</p>
<script>
const EP = ${data};
const grid = document.getElementById('grid');
if (!EP.length) grid.innerHTML = '<div class="empty">No upcoming episodes with a room link found on the calendar.</div>';
for (const e of EP) {
  const card = document.createElement('div'); card.className = 'card';
  card.innerHTML =
    '<div class="row"><div class="name"></div><div class="when"></div></div>'+
    '<div class="meta"></div>'+
    '<textarea readonly></textarea>'+
    '<div class="btns">'+
      '<button class="primary" data-act="msg">Copy message + link</button>'+
      '<button class="ghost" data-act="link">Copy link only</button>'+
    '</div>';
  card.querySelector('.name').textContent = e.name;
  if (e.handle) { const s = document.createElement('span'); s.className='handle'; s.textContent=' '+e.handle; card.querySelector('.name').appendChild(s); }
  card.querySelector('.when').textContent = e.when;
  card.querySelector('.meta').textContent = e.link;
  card.querySelector('textarea').value = e.text;
  const flash = (btn, label) => { const o = btn.textContent; btn.textContent = label; btn.classList.add('ok'); setTimeout(()=>{btn.textContent=o; btn.classList.remove('ok');}, 1400); };
  card.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
    const val = b.dataset.act === 'link' ? e.link : e.text;
    try { await navigator.clipboard.writeText(val); flash(b, 'Copied ✓'); }
    catch { const t = card.querySelector('textarea'); t.focus(); t.select(); document.execCommand('copy'); flash(b, 'Copied ✓'); }
  }));
  grid.appendChild(card);
}
</script>
</body></html>`;

fs.writeFileSync(OUT, html);
console.log(`wrote ${OUT} — ${episodes.length} episode(s): ${episodes.map((e) => e.slug).join(', ') || '(none)'}`);
if (!NO_OPEN) execFile('open', [OUT], () => {});
