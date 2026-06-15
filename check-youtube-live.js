import { connectCDP } from './lib/connect.js';

const { browser, page } = await connectCDP(9222);

await page.goto('https://studio.youtube.com/channel/UC/livestreaming', {
  waitUntil: 'domcontentloaded',
});
await page.waitForTimeout(4000);

const url = page.url();
const bodyText = (await page.locator('body').innerText().catch(() => '')) || '';
const gated = /request access|may take up to 24 hours|enable live streaming|verify/i.test(bodyText);
const hasSchedule = /schedule|stream|go live|manage/i.test(bodyText);

await page.screenshot({ path: '/tmp/canary-live-check.png' });

console.log('FINAL URL:', url);
console.log('GATED (needs access/verify):', gated);
console.log('SHOWS STREAM/SCHEDULE UI:', hasSchedule);
console.log('--- first 400 chars of page ---');
console.log(bodyText.slice(0, 400).replace(/\n{2,}/g, '\n'));

await browser.close();
