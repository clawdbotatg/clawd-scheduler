import { connectCDP } from './lib/connect.js';

const MATCH = (process.argv[2] || 'port dev').toLowerCase();
const DAY = process.argv[3] || '2026/6/18';

const { browser, page } = await connectCDP(9223);
await page.goto(`https://calendar.google.com/calendar/u/0/r/day/${DAY}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2800);

const ids = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-eventid]')].map((e) => e.getAttribute('data-eventid')))]);

let detail = null;
for (const id of ids) {
  const chip = page.locator(`[data-eventid="${id}"]`).first();
  await chip.click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1300);
  const dlg = page.locator('[role="dialog"]').first();
  const text = (await dlg.innerText().catch(() => '')) || '';
  if (text.toLowerCase().includes(MATCH)) {
    detail = text.replace(/\n{2,}/g, '\n').trim();
    await page.keyboard.press('Escape');
    break;
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

console.log(detail ? `=== EVENT DETAILS (match: "${MATCH}") ===\n${detail}` : `No event matching "${MATCH}" on ${DAY}`);
await browser.close();
