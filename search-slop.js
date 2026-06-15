import { connectCDP } from './lib/connect.js';

const { browser, page } = await connectCDP(9223);

await page.goto('https://calendar.google.com/calendar/u/0/r/search?q=slop.computer', {
  waitUntil: 'domcontentloaded',
});
await page.waitForTimeout(4000);

// Search results are clickable rows; their aria-labels carry date + title + time.
const rows = await page.evaluate(() => {
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('[role="button"][aria-label], [data-eventid][aria-label], a[aria-label]')) {
    const t = (el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    // Keep rows that look like a dated event.
    if (!/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
});

console.log(`Search "slop.computer" returned ${rows.length} dated result(s):\n`);
rows.forEach((r, i) => console.log(`${i + 1}. ${r}`));

await page.screenshot({ path: '/tmp/slop-search.png', fullPage: true });
console.log('\n(screenshot: /tmp/slop-search.png)');

await browser.close();
