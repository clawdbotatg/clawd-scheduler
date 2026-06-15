import { connectCDP } from './lib/connect.js';

const { browser, page } = await connectCDP(9222);

await page.goto('https://studio.youtube.com/channel/UC/livestreaming', {
  waitUntil: 'domcontentloaded',
});
await page.waitForTimeout(4000);

// Click "Schedule Stream" (do NOT submit anything downstream).
try {
  await page.getByText('Schedule Stream', { exact: false }).first().click({ timeout: 8000 });
  await page.waitForTimeout(3500);
} catch (e) {
  console.log('could not click Schedule Stream:', e.message);
}

await page.screenshot({ path: '/tmp/canary-schedule-form.png', fullPage: false });

// Dump visible interactive fields so we know what to parameterize.
const fields = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('input,textarea,[role="textbox"],[role="radio"],[role="combobox"],button,[contenteditable="true"]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || '').trim().slice(0, 60);
    if (!label) continue;
    out.push(`${el.tagName.toLowerCase()}${el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : ''}: "${label}"`);
  }
  return [...new Set(out)];
});

console.log('URL:', page.url());
console.log('--- visible fields/controls ---');
console.log(fields.join('\n'));

await browser.close();
