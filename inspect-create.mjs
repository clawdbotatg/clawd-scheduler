import { connectCDP } from './lib/connect.js';
const { browser, page } = await connectCDP(9223);
await page.goto('https://live.slop.computer/admin', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await page.getByPlaceholder('slug (e.g. ep0)').fill('port_dev');
await page.waitForTimeout(1000);
const els = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const t = (el.innerText || '').trim();
    if (t === 'CREATE' || t === 'REGENERATE') {
      out.push({ text: t, tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), disabled: el.disabled ?? el.getAttribute('aria-disabled'), cls: (el.className||'').toString().slice(0,40), clickable: el.onclick != null || el.tagName === 'BUTTON' });
    }
  }
  // dedupe by tag+text keeping innermost (shortest)
  return out;
});
console.log(JSON.stringify(els, null, 1));
await browser.close();
