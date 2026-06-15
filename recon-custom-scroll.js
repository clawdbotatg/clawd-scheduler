import { connectCDP } from './lib/connect.js';

const { browser, page } = await connectCDP(9224);
await page.goto('https://studio.youtube.com/channel/UC/livestreaming', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4500);
await page.getByText('Schedule Stream', { exact: false }).first().click({ timeout: 12000 });
await page.waitForTimeout(3000);
await page.getByRole('button', { name: /create new/i }).click({ timeout: 12000 });
await page.waitForTimeout(4000);

const title = page.locator('div[role="textbox"][aria-label^="Add a title"]');
await title.click();
await title.fill('recon').catch(() => {});
await page.locator('tp-yt-paper-radio-button').filter({ hasText: "No, it's not made for kids" }).click({ timeout: 8000 }).catch(() => {});
await page.getByRole('button', { name: 'Next' }).click({ timeout: 8000 });
await page.waitForTimeout(3000);

// Scroll every scrollable container in the dialog to the bottom.
for (let i = 0; i < 4; i++) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      if (el.scrollHeight > el.clientHeight + 20 && el.clientHeight > 120) el.scrollTop = el.scrollHeight;
    }
  });
  await page.waitForTimeout(700);
}
await page.screenshot({ path: '/tmp/yt-custom-bottom.png' });

// Full text + any thumbnail/playlist affordances.
const info = await page.evaluate(() => {
  const dialogText = (document.querySelector('tp-yt-paper-dialog, ytcp-dialog, [role="dialog"]')?.innerText || document.body.innerText || '').replace(/\n{2,}/g, '\n');
  const hits = [];
  for (const el of document.querySelectorAll('button,[role="button"],input[type="file"],ytcp-thumbnails-compact-editor,[aria-label]')) {
    const t = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50);
    if (/thumbnail|playlist|upload|add to/i.test(t)) hits.push(`${el.tagName.toLowerCase()}: "${t}"`);
  }
  return { thumbsOrPlaylists: [...new Set(hits)], textHasThumb: /thumbnail/i.test(dialogText), textHasPlaylist: /playlist/i.test(dialogText), snippet: dialogText.slice(0, 700) };
});
console.log('thumbnail/playlist affordances:', JSON.stringify(info.thumbsOrPlaylists, null, 0));
console.log('text mentions thumbnail:', info.textHasThumb, '| playlist:', info.textHasPlaylist);
console.log('--- customization text (top 700) ---\n' + info.snippet);
await browser.close();
