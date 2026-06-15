import { connectCDP } from './lib/connect.js';

const { browser, page } = await connectCDP(9223);

// Start today (2026-06-13) and step forward day by day.
const start = new Date(2026, 5, 13); // month is 0-indexed: 5 = June
const MAX_DAYS = 30;
const SLOP = /slop\.comp/i;

function extractEvents() {
  return page.evaluate(() => {
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('[role="button"][aria-label], [data-eventid][aria-label]')) {
      const label = el.getAttribute('aria-label');
      if (!label) continue;
      // Real events have a time like "8:30am" or "11:15 – 11:45am".
      if (!/\d{1,2}(:\d{2})?\s?(–|-|to|\s)?\s?\d{0,2}:?\d{0,2}\s?(am|pm)/i.test(label)) continue;
      if (seen.has(label)) continue;
      seen.add(label);
      out.push(label.replace(/\s+/g, ' ').trim());
    }
    return out;
  });
}

let found = null;
for (let i = 0; i < MAX_DAYS; i++) {
  const d = new Date(start);
  d.setDate(start.getDate() + i);
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  const label = d.toDateString();

  await page.goto(`https://calendar.google.com/calendar/u/0/r/day/${y}/${m}/${day}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(2200);

  const events = await extractEvents();
  const hits = events.filter((e) => SLOP.test(e));
  console.log(`${label.padEnd(16)} ${events.length} events` + (hits.length ? `  <-- ${hits.length} SLOP HIT` : ''));

  if (hits.length) {
    found = { date: label, y, m, day, hits, allEvents: events };
    await page.screenshot({ path: '/tmp/slop-event-day.png' });
    break;
  }
}

console.log('\n========================================');
if (found) {
  console.log('FIRST slop.computer event on:', found.date);
  console.log('URL: https://calendar.google.com/calendar/u/0/r/day/' + found.y + '/' + found.m + '/' + found.day);
  console.log('Matching event(s):');
  for (const h of found.hits) console.log('  • ' + h);
  console.log('\nAll events that day:');
  for (const e of found.allEvents) console.log('  - ' + e);
} else {
  console.log('No slop.computer event found in the next', MAX_DAYS, 'days.');
}

await browser.close();
