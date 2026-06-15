import { connectCDP } from './lib/connect.js';

const { browser, page } = await connectCDP(9223);
await page.goto('https://live.slop.computer/admin', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

console.log('URL  :', page.url());
console.log('TITLE:', await page.title());

const text = (await page.locator('body').innerText().catch(() => '')) || '';
console.log('\n--- page text (first 1200 chars) ---');
console.log(text.slice(0, 1200));

// Note any obvious login / room-list / create affordances.
const ui = await page.evaluate(() => {
  const out = { buttons: [], inputs: [], looksLikeLogin: false };
  for (const b of document.querySelectorAll('button, [role="button"], a')) {
    const t = (b.innerText || b.getAttribute('aria-label') || '').trim();
    if (t && t.length < 40) out.buttons.push(t);
  }
  for (const i of document.querySelectorAll('input')) {
    out.inputs.push(i.getAttribute('placeholder') || i.getAttribute('name') || i.type);
  }
  out.looksLikeLogin = /sign in|log in|login|connect wallet|continue with/i.test(document.body.innerText || '');
  out.buttons = [...new Set(out.buttons)].slice(0, 25);
  out.inputs = [...new Set(out.inputs)].slice(0, 15);
  return out;
});
console.log('\n--- buttons/links:', JSON.stringify(ui.buttons));
console.log('--- inputs:', JSON.stringify(ui.inputs));
console.log('--- looks like login wall:', ui.looksLikeLogin);

await page.screenshot({ path: '/tmp/slop-admin.png', fullPage: true });
await browser.close();
