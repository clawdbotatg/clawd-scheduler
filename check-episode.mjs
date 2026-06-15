// READ-ONLY status check: for a given guest + date, report which scheduling
// surfaces are already done vs missing. Changes nothing.
//   CHK_HANDLE=port_dev CHK_DATE='Jun 18, 2026' node check-episode.mjs
import { chromium } from 'playwright';
import { episode } from './lib/config.js';

const ep = episode(process.env.CHK_HANDLE || 'port_dev');
const DATE = process.env.CHK_DATE || 'Jun 18, 2026';
const monthDay = DATE.replace(/,\s*\d{4}$/, '');             // "Jun 18"
const dm = DATE.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s+(\d{4})$/);
const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const dayUrl = `${dm[3]}/${MONTHS[dm[1]]}/${Number(dm[2])}`;  // 2026/6/18
const handleRe = new RegExp(`@${ep.handle}\\b`, 'i');
const slugRe = new RegExp(ep.slug.replace(/-/g, '[- ]?'), 'i');

const r = { calendar: false, youtube: false, twitter: false, onchain: false };

// --- 9223: onchain, twitter, calendar ---
const social = await chromium.connectOverCDP('http://127.0.0.1:9223');
const sp = social.contexts()[0].pages()[0] || (await social.contexts()[0].newPage());

await sp.goto('https://slop.computer/', { waitUntil: 'domcontentloaded' }); await sp.waitForTimeout(6000);
r.onchain = slugRe.test((await sp.locator('body').innerText().catch(() => '')) || '');

await sp.goto('https://studio.x.com/producer', { waitUntil: 'domcontentloaded' }); await sp.waitForTimeout(6000);
{ const t = (await sp.locator('body').innerText().catch(() => '')) || ''; r.twitter = handleRe.test(t) && t.includes(monthDay); }

await sp.goto(`https://calendar.google.com/calendar/u/0/r/day/${dayUrl}`, { waitUntil: 'domcontentloaded' }); await sp.waitForTimeout(3000);
{
  const ids = await sp.evaluate(() => [...new Set([...document.querySelectorAll('[data-eventid]')].map((e) => e.getAttribute('data-eventid')))]);
  const matchStr = ep.handle.replace(/[_-]/g, ' ');
  for (const id of ids) {
    await sp.locator(`[data-eventid="${id}"]`).first().click({ timeout: 5000 }).catch(() => {});
    await sp.waitForTimeout(1000);
    const t = (await sp.locator('[role="dialog"]').first().innerText().catch(() => '')) || '';
    if (t.toLowerCase().includes(matchStr.toLowerCase())) { r.calendar = new RegExp(`live\\.slop\\.computer/${ep.slug}`, 'i').test(t); break; }
    await sp.keyboard.press('Escape'); await sp.waitForTimeout(300);
  }
  await sp.keyboard.press('Escape').catch(() => {});
}
await social.close();

// --- 9224: youtube ---
const yt = await chromium.connectOverCDP('http://127.0.0.1:9224');
const yp = yt.contexts()[0].pages()[0] || (await yt.contexts()[0].newPage());
await yp.goto('https://studio.youtube.com/channel/UC/livestreaming', { waitUntil: 'domcontentloaded' }); await yp.waitForTimeout(7000);
{ const t = (await yp.locator('body').innerText().catch(() => '')) || ''; r.youtube = handleRe.test(t) && t.includes(monthDay); }
await yt.close();

console.log(`\n=== ${ep.title} — ${DATE} ===`);
for (const k of ['calendar', 'youtube', 'twitter', 'onchain']) console.log(`  ${k.padEnd(9)} ${r[k] ? '✅ done' : '❌ MISSING'}`);
const missing = Object.keys(r).filter((k) => !r[k]);
console.log(missing.length ? `\nMISSING: ${missing.join(', ')}` : '\nALL DONE ✅');
