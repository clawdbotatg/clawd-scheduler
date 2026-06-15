import { connectCDP } from './lib/connect.js';
const { browser, page } = await connectCDP(9223);
await page.goto('https://x.com/port_dev', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4500);
const info = await page.evaluate(() => ({
  title: document.title,
  desc: document.querySelector('meta[property="og:description"]')?.content
     || document.querySelector('meta[name="description"]')?.content || '',
  bio: document.querySelector('[data-testid="UserDescription"]')?.innerText || '',
  name: document.querySelector('[data-testid="UserName"]')?.innerText || '',
}));
await page.screenshot({ path: '/tmp/port-profile.png' });
console.log('TITLE:', info.title);
console.log('NAME :', info.name.replace(/\n/g,' '));
console.log('META :', info.desc);
console.log('BIO  :', info.bio);
await browser.close();
