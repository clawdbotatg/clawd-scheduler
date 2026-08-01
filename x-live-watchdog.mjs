#!/usr/bin/env node
// WATCHDOG: guarantee a scheduled X livestream goes live at its scheduled time.
//
// X's server-side auto-start is dead (2026-08-01: three controlled failures with
// Auto-start ON, source connected, feed present — see SLOP-WORKFLOW.md). This
// watchdog sits on the livestream's Live Studio details page (studio.x.com/live),
// gives X a grace period at the scheduled minute, then presses that page's
// "Go Live" — firing the SAME livestream (same URL, tweeted card intact).
//
//   X_TITLE='Slop.Computer with @guest …' X_FIRE_AT='4:00 PM' \
//     node x-live-watchdog.mjs --arm [--grace 20]
//
// Finds the livestream by title in Live Studio, opens its details page, then:
//   before fire time: idle-polls the badge (X may fire it first — we yield).
//   fire time + grace, still Scheduled: click Go Live (+ any confirm dialog).
//   verify the badge flips to Live; exit 0 on live (by X or by us), 1 on failure.
import { chromium } from 'playwright';

const TITLE = process.env.X_TITLE;
const FIRE_AT = process.env.X_FIRE_AT; // "H:MM AM" local
const GRACE_S = Number(process.env.X_GRACE || (process.argv.includes('--grace') ? process.argv[process.argv.indexOf('--grace') + 1] : 20));
const PORT = Number(process.env.SLOP_PORT_SOCIAL || 9223);
const ARM = process.argv.includes('--arm');
if (!TITLE || !FIRE_AT) { console.error(`set X_TITLE and X_FIRE_AT ("H:MM AM")`); process.exit(1); }
const toMin = (t) => { const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i); return ((Number(m[1]) % 12) + (/pm/i.test(m[3]) ? 12 : 0)) * 60 + Number(m[2]); };
const fireMin = toMin(FIRE_AT);
const nowS = () => { const d = new Date(); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(); };
const fireS = fireMin * 60;
const stamp = () => new Date().toLocaleTimeString();
console.log(`WATCHDOG: "${TITLE}" fire=${FIRE_AT} grace=${GRACE_S}s arm=${ARM}`);

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx = browser.contexts()[0];
const pg = await ctx.newPage();
const park = async () => { await pg.goto('about:blank').catch(() => {}); await pg.close().catch(() => {}); };
const die = async (msg, code) => { console.log(msg); await pg.screenshot({ path: '/tmp/x-watchdog.png' }).catch(() => {}); await park(); await browser.close(); process.exit(code); };

// find the livestream by title in Live Studio and open its details page
await pg.goto('https://studio.x.com/live', { waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(6000);
const row = pg.locator('div,tr').filter({ hasText: TITLE }).last();
if (!(await row.count())) await die(`✗ livestream "${TITLE}" not found in Live Studio`, 1);
await row.click({ timeout: 8000 });
await pg.waitForTimeout(4000);
if (!/\/live\/\w+/.test(pg.url())) await die(`✗ clicking the row did not open a details page (url=${pg.url()})`, 1);
console.log(`✓ details page: ${pg.url()}`);

const badge = async () => {
  // the status badge sits next to the stream title in the header. A bare text
  // match is NOT enough: the sidebar/breadcrumb also says "Live" ("X Studio >
  // Live > ...") and once produced a false "went live" reading on a half-
  // rendered reload. Anchor to the title and pick the nearest match; return
  // '?' (not a guess) when the title isn't mounted yet.
  return await pg.evaluate((title) => {
    const tEl = [...document.querySelectorAll('h1,h2,div,span')].find((e) => e.children.length === 0 && e.textContent.trim() === title && e.getBoundingClientRect().width > 0);
    if (!tEl) return '?';
    const tr = tEl.getBoundingClientRect();
    const cands = [...document.querySelectorAll('div,span')].filter((e) => e.children.length === 0 && /^(Scheduled|Live|Ended)$/i.test(e.textContent.trim()) && e.getBoundingClientRect().width > 0);
    let best = null, bd = Infinity;
    for (const c of cands) {
      const r = c.getBoundingClientRect();
      const d = Math.abs(r.top - tr.top) + Math.abs(r.left - tr.right);
      if (Math.abs(r.top - tr.top) < 60 && d < bd) { bd = d; best = c; }
    }
    return best ? best.textContent.trim() : '?';
  }, TITLE);
};

// idle until fire time (X gets every chance to fire it first)
let last = '';
for (;;) {
  const b = await badge();
  if (b !== last) { console.log(`[${stamp()}] badge: ${b}`); last = b; }
  if (/live/i.test(b)) await die(`✓ X fired it on its own at ${stamp()} — watchdog not needed`, 0);
  if (/ended/i.test(b)) await die(`✗ livestream shows ENDED before start`, 1);
  if (nowS() >= fireS + GRACE_S) break;
  await pg.waitForTimeout(5000);
  await pg.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await pg.waitForTimeout(3500);
}

if (!ARM) await die(`(dry run) would press Go Live now — ${stamp()}. Re-run with --arm.`, 0);

console.log(`[${stamp()}] grace expired, still "${last}" — pressing Go Live`);
const goLive = pg.locator('button').filter({ hasText: /^Go Live$/i }).first();
if (!(await goLive.count())) await die(`✗ no Go Live button on the page`, 1);
await goLive.click({ timeout: 8000 });
await pg.waitForTimeout(2000);
// confirm dialog, if any
const confirm = pg.locator('[role=dialog] button, [aria-modal] button').filter({ hasText: /go live|start|confirm|yes/i }).first();
if (await confirm.count().catch(() => 0)) { await confirm.click({ timeout: 5000 }).catch(() => {}); console.log('✓ confirmed dialog'); }

// verify the flip. When actually live, Live Studio REMOVES the status chip and
// reshapes the header: "Go Live" becomes a red "End Livestream" button and a
// views counter appears. THAT is the live signal — not a "Live" badge (the
// first proof run went live fine but the old badge check reported failure).
for (let i = 0; i < 10; i++) {
  await pg.waitForTimeout(3000);
  const live = await pg.evaluate(() => !![...document.querySelectorAll('button')].find((b) => /End Livestream/i.test(b.innerText)));
  if (live) await die(`✅ WATCHDOG FIRED — livestream is LIVE at ${stamp()} ("End Livestream" present)`, 0);
  const b = await badge();
  if (/live/i.test(b)) await die(`✅ WATCHDOG FIRED — livestream is LIVE at ${stamp()}`, 0);
}
await die(`✗ pressed Go Live but no live signal appeared — check /tmp/x-watchdog.png`, 1);
