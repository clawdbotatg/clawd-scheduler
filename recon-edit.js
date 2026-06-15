import { connectCDP } from './lib/connect.js';

const { browser, page } = await connectCDP(9223);
await page.goto('https://calendar.google.com/calendar/u/0/r/day/2026/6/18', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2800);

// Open the port dev event popup, then click "Edit event".
const ids = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-eventid]')].map((e) => e.getAttribute('data-eventid')))]);
for (const id of ids) {
  const chip = page.locator(`[data-eventid="${id}"]`).first();
  await chip.click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const txt = (await page.locator('[role="dialog"]').first().innerText().catch(() => '')) || '';
  if (/port dev/i.test(txt)) { console.log('opened port dev popup'); break; }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

await page.getByRole('button', { name: /edit event/i }).first().click({ timeout: 8000 });
await page.waitForTimeout(3500);
console.log('URL:', page.url());

const fields = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('input,textarea,[contenteditable="true"],[role="textbox"]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    out.push({
      tag: el.tagName.toLowerCase(),
      ce: el.getAttribute('contenteditable'),
      role: el.getAttribute('role'),
      label: (el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').slice(0, 50),
      val: ('value' in el ? el.value : el.innerText || '').slice(0, 40),
    });
  }
  return out;
});
console.log('--- editable fields in the editor ---');
fields.forEach((f) => console.log(JSON.stringify(f)));
await page.screenshot({ path: '/tmp/event-editor.png', fullPage: false });
await browser.close();
