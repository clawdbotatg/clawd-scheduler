import { connectCDP } from './lib/connect.js';

const url = process.argv[2] || 'https://live.slop.computer/port-dev?invite=YOUR_INVITE_CODE';
const { browser, page } = await connectCDP(9223);
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);

console.log('URL  :', page.url());
console.log('TITLE:', await page.title());

// Top-left menu / buttons. Capture clickable affordances and any "skill" text.
const ui = await page.evaluate(() => {
  const btns = [];
  for (const b of document.querySelectorAll('button, [role="button"], a, [role="menuitem"], li')) {
    const t = (b.innerText || b.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ');
    if (t && t.length < 50) btns.push(t);
  }
  const hasSkill = /skill/i.test(document.body.innerText || '');
  return { btns: [...new Set(btns)].slice(0, 40), hasSkill };
});
console.log('\n--- clickable items ---');
console.log(JSON.stringify(ui.btns, null, 0));
console.log('\n"skill" text present on page:', ui.hasSkill);

await page.screenshot({ path: '/tmp/room.png' });
console.log('(screenshot: /tmp/room.png)');
await browser.close();
