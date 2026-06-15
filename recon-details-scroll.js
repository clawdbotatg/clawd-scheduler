import { connectCDP } from './lib/connect.js';

const { browser, page } = await connectCDP(9224);
await page.goto('https://studio.youtube.com/channel/UC/livestreaming', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4500);
await page.getByText('Schedule Stream', { exact: false }).first().click({ timeout: 12000 });
await page.waitForTimeout(3000);
await page.getByRole('button', { name: /create new/i }).click({ timeout: 12000 });
await page.waitForTimeout(4000);

// On the DETAILS tab — look for a "Show more" expander, then scroll to bottom.
const showMore = page.getByRole('button', { name: /show more/i });
if (await showMore.count()) { await showMore.first().click().catch(() => {}); await page.waitForTimeout(1500); console.log('clicked "Show more"'); }

for (let i = 0; i < 5; i++) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      if (el.scrollHeight > el.clientHeight + 20 && el.clientHeight > 120) el.scrollTop = el.scrollHeight;
    }
  });
  await page.waitForTimeout(600);
}
await page.screenshot({ path: '/tmp/yt-details-bottom.png' });

const info = await page.evaluate(() => {
  const t = (document.querySelector('[role="dialog"]')?.innerText || document.body.innerText || '');
  const labels = [];
  for (const el of document.querySelectorAll('button,[role="button"],input,[aria-label],ytcp-text-dropdown-trigger,#playlists-dropdown,ytcp-thumbnails-compact-editor')) {
    const s = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 45);
    if (/thumbnail|playlist|category|tag|show more|upload/i.test(s)) labels.push(s);
  }
  return { hasThumb: /thumbnail/i.test(t), hasPlaylist: /playlist/i.test(t), hasCategory: /category/i.test(t), labels: [...new Set(labels)] };
});
console.log('Details mentions → thumbnail:', info.hasThumb, '| playlist:', info.hasPlaylist, '| category:', info.hasCategory);
console.log('matched controls:', JSON.stringify(info.labels));
await browser.close();
