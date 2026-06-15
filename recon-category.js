import { connectCDP } from './lib/connect.js';

const { browser, page } = await connectCDP(9224);
await page.goto('https://studio.youtube.com/channel/UC/livestreaming', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4500);
await page.getByText('Schedule Stream', { exact: false }).first().click({ timeout: 12000 });
await page.waitForTimeout(3000);
await page.getByRole('button', { name: /create new/i }).click({ timeout: 12000 });
await page.waitForTimeout(4000);
const title = page.locator('div[role="textbox"][aria-label^="Add a title"]');
await title.click(); await title.fill('recon'); await page.keyboard.press('Escape');
await page.locator('tp-yt-paper-radio-button').filter({ hasText: "No, it's not made for kids" }).click().catch(() => {});
await page.getByText('Show more', { exact: true }).first().click({ timeout: 6000 }).catch(() => {});
await page.waitForTimeout(1500);

// coordinate-click the category dropdown
const box = await page.evaluate(() => {
  for (const el of document.querySelectorAll('ytcp-select, ytcp-text-dropdown-trigger')) {
    if (/People & Blogs/.test(el.textContent || '')) { el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); if (r.width > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName.toLowerCase() }; }
  }
  return null;
});
console.log('category box:', JSON.stringify(box));
await page.mouse.click(box.x, box.y);
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/yt-category-open.png' });

// what opened? dump menu items + anything matching Science
const info = await page.evaluate(() => {
  const items = [];
  for (const el of document.querySelectorAll('tp-yt-paper-item, [role="option"], ytcp-text-menu-item, paper-item, .ytcp-menu-item, yt-formatted-string')) {
    const t = (el.textContent || '').trim();
    const r = el.getBoundingClientRect();
    if (t && r.width > 0 && r.height > 0 && t.length < 40) items.push({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', text: t });
  }
  const sci = [...document.querySelectorAll('*')].filter((e) => (e.textContent || '').trim() === 'Science & Technology' && e.getBoundingClientRect().width > 0).map((e) => ({ tag: e.tagName.toLowerCase(), role: e.getAttribute('role') || '', cls: (e.className || '').toString().slice(0, 30) }));
  return { itemCount: items.length, sample: [...new Map(items.map((i) => [i.text, i])).values()].slice(0, 12), sciElements: sci };
});
console.log('open menu items:', JSON.stringify(info.sample, null, 0));
console.log('Science & Technology elements:', JSON.stringify(info.sciElements, null, 0));
await browser.close();
