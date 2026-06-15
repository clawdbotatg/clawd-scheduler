import { connectCDP } from './lib/connect.js';

const dump = (page) => page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('input,textarea,[role="textbox"],[role="radio"],[role="combobox"],[role="switch"],tp-yt-paper-radio-button,button,#radioContainer')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const t = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (t) out.push(`${el.tagName.toLowerCase()}${el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : ''}: "${t}"`);
  }
  return [...new Set(out)];
});

const { browser, page } = await connectCDP(9224);
await page.goto('https://studio.youtube.com/channel/UC/livestreaming', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4500);

console.log('→ Schedule Stream');
await page.getByText('Schedule Stream', { exact: false }).first().click({ timeout: 12000 });
await page.waitForTimeout(3000);
console.log('→ Create new');
await page.getByRole('button', { name: /create new/i }).click({ timeout: 12000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: '/tmp/yt-1-details.png' });

// Details: title + made-for-kids (required to advance).
const title = page.locator('div[role="textbox"][aria-label^="Add a title"]');
await title.click();
await title.fill('Slop.Computer: port dev and Austin Griffith').catch(async () => { await page.keyboard.type('Slop.Computer: port dev and Austin Griffith'); });
await page.locator('tp-yt-paper-radio-button').filter({ hasText: "No, it's not made for kids" }).click({ timeout: 8000 }).catch(() => console.log('made-for-kids click failed'));
await page.waitForTimeout(800);

console.log('→ Next (to Customization)');
await page.getByRole('button', { name: 'Next' }).click({ timeout: 8000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: '/tmp/yt-2-customization.png' });
console.log('--- CUSTOMIZATION ---\n' + (await dump(page)).join('\n'));

console.log('→ Next (to Visibility)');
await page.getByRole('button', { name: 'Next' }).click({ timeout: 8000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: '/tmp/yt-3-visibility.png' });
console.log('--- VISIBILITY ---\n' + (await dump(page)).join('\n'));

console.log('\nSTOPPED at Visibility — nothing submitted.');
await browser.close();
