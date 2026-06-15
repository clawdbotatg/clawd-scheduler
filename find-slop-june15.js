import { connectCDP } from './lib/connect.js';

const { browser, page } = await connectCDP(9223);

await page.goto('https://calendar.google.com/calendar/u/0/r/day/2026/6/15', {
  waitUntil: 'domcontentloaded',
});
await page.waitForTimeout(2800);

// Unique event ids on the day.
const ids = await page.evaluate(() => {
  const set = new Set();
  for (const el of document.querySelectorAll('[data-eventid]')) set.add(el.getAttribute('data-eventid'));
  return [...set];
});
console.log(`June 15 has ${ids.length} event chip(s). Opening each to read its description...\n`);

const SLOP = /slop\.computer/i;
const results = [];
for (const id of ids) {
  try {
    const chip = page.locator(`[data-eventid="${id}"]`).first();
    const label = (await chip.getAttribute('aria-label'))?.replace(/\s+/g, ' ').trim() || '(no label)';
    await chip.click({ timeout: 6000 });
    await page.waitForTimeout(1400);
    let detail = '';
    const dlg = page.locator('[role="dialog"]').first();
    if (await dlg.count()) detail = (await dlg.innerText().catch(() => '')).replace(/\n{2,}/g, '\n').trim();
    results.push({ label, detail });
    const hit = SLOP.test(label) || SLOP.test(detail);
    console.log(`• ${label}${hit ? '   <-- SLOP.COMPUTER MATCH' : ''}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
  } catch (e) {
    console.log(`• (could not open event ${id}: ${e.message})`);
  }
}

const match = results.find((r) => SLOP.test(r.label) || SLOP.test(r.detail));
console.log('\n========================================');
if (match) {
  console.log('FOUND slop.computer on Monday, June 15:\n');
  console.log('SUMMARY:', match.label);
  console.log('\nFULL EVENT DETAILS:\n' + match.detail);
  await page.locator(`text=/slop\\.computer/i`).first().scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: '/tmp/slop-june15.png' });
} else {
  console.log('No slop.computer found in any June 15 event description.');
}

await browser.close();
