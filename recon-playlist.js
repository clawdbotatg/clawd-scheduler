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

const info = await page.evaluate(() => {
  const trigs = [...document.querySelectorAll('ytcp-text-dropdown-trigger, ytcp-dropdown-trigger')];
  return trigs.map((t) => {
    const r = t.getBoundingClientRect();
    let heading = '';
    for (const h of document.querySelectorAll('*')) {
      const txt = (h.textContent || '').trim();
      if (!txt || txt.length > 24 || h.querySelectorAll('*').length > 1) continue;
      const hr = h.getBoundingClientRect();
      if (hr.top < r.top && r.top - hr.top < 70) heading = txt;
    }
    return { heading, text: (t.textContent || '').trim().slice(0, 24), aria: t.getAttribute('aria-label') || '', id: t.id || '', cls: (t.className || '').toString().slice(0, 30), y: Math.round(r.top) };
  });
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
