#!/usr/bin/env node
// End a live X livestream cleanly: find it by title in Live Studio, open its
// details page, press "End Livestream" + confirm. Companion to x-live-watchdog
// (which starts the same stream) — used by showtime-arm's auto-stop.
//
//   X_TITLE='<exact title>' node end-x-livestream.mjs
import { chromium } from 'playwright';

const TITLE = process.env.X_TITLE;
const PORT = Number(process.env.SLOP_PORT_SOCIAL || 9223);
if (!TITLE) { console.error('set X_TITLE'); process.exit(1); }

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx = browser.contexts()[0];
const pg = await ctx.newPage();
const park = async () => { await pg.goto('about:blank').catch(() => {}); await pg.close().catch(() => {}); await browser.close(); };
const die = async (msg, code) => { console.log(msg); await park(); process.exit(code); };

// find the livestream's details page by title
await pg.goto('https://studio.x.com/live', { waitUntil: 'domcontentloaded' });
let found = false;
for (let i = 0; i < 25 && !found; i++) {
  await pg.waitForTimeout(2500);
  found = await pg.evaluate((t) => document.body.innerText.includes(t), TITLE);
}
if (!found) await die(`✗ "${TITLE}" not in Live Studio list`, 1);
await pg.locator('div,tr').filter({ hasText: TITLE }).last().click();
await pg.waitForTimeout(4000);
if (!/\/live\/\w+/.test(pg.url())) await die(`✗ row click did not open details (${pg.url()})`, 1);

let done = false;
for (let a = 0; a < 4 && !done; a++) {
  for (let i = 0; i < 12 && !done; i++) {
    await pg.waitForTimeout(2500);
    const st = await pg.evaluate(() => {
      const end = [...document.querySelectorAll('button')].find((x) => /End Livestream/i.test(x.innerText) && x.getBoundingClientRect().width > 0);
      if (end) { end.click(); return 'clicked'; }
      const t = document.body.innerText;
      if (/Ended/i.test(t) && t.trim().length > 100) return 'already-ended';
      return t.trim().length > 100 ? 'no-end-btn' : 'loading';
    }).catch(() => 'err');
    if (st === 'clicked') {
      await pg.waitForTimeout(1500);
      await pg.evaluate(() => { const d = document.querySelector('[role=dialog],[aria-modal]'); const e = d ? [...d.querySelectorAll('button')].find((x) => /end/i.test(x.innerText)) : null; e?.click(); });
      await pg.waitForTimeout(4000);
      done = true;
    } else if (st === 'already-ended') { console.log('✓ already ended'); done = true; }
    else if (st === 'no-end-btn') break; // rendered but not live — reload and retry
  }
  if (!done) await pg.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
}
const final = await pg.evaluate(() => (/Ended/i.test(document.body.innerText) ? 'Ended' : 'unknown'));
console.log(`X livestream final state: ${final}`);
await park();
process.exit(final === 'Ended' ? 0 : 1);
