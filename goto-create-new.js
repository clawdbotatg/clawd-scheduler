import { connectCDP } from './lib/connect.js';

const { browser, page } = await connectCDP(9222);

console.log('navigating to live streaming control room...');
await page.goto('https://studio.youtube.com/channel/UC/livestreaming', {
  waitUntil: 'domcontentloaded',
});
await page.waitForTimeout(4500);

console.log('clicking "Schedule Stream"...');
await page.getByText('Schedule Stream', { exact: false }).first().click({ timeout: 12000 });
await page.waitForTimeout(3000);

console.log('clicking "Create new"...');
await page.getByRole('button', { name: /create new/i }).click({ timeout: 12000 });
await page.waitForTimeout(4500);

await page.screenshot({ path: '/tmp/create-new-form.png' });

const fields = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('input,textarea,[role="textbox"],[role="radio"],[role="combobox"],[contenteditable="true"],tp-yt-paper-radio-button')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70);
    if (!label) continue;
    out.push(`${el.tagName.toLowerCase()}${el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : ''}: "${label}"`);
  }
  return [...new Set(out)];
});

console.log('URL:', page.url());
console.log('TITLE:', await page.title());
console.log('--- visible fields on the Create-new form ---');
console.log(fields.join('\n') || '(none captured — see screenshot)');

await browser.close(); // disconnect only; clone stays open on the Create-new screen
