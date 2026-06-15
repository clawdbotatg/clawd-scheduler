import { connectCDP } from './lib/connect.js';

const { browser, page } = await connectCDP(9222);

await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);

// Open the account menu to read the logged-in channel name + @handle.
let identity = '(could not read)';
try {
  await page.locator('#avatar-btn').click({ timeout: 5000 });
  await page.waitForTimeout(1500);
  const text = await page.locator('ytd-active-account-header-renderer').innerText({ timeout: 5000 });
  identity = text.replace(/\n+/g, ' | ').trim();
  await page.keyboard.press('Escape');
} catch (e) {
  identity = `(menu read failed: ${e.message})`;
}

await page.screenshot({ path: '/tmp/canary-clone-youtube.png' });
console.log('LOGGED-IN IDENTITY:', identity);
console.log('PAGE TITLE:', await page.title());

await browser.close(); // disconnect only; real Canary clone stays up
