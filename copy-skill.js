import { connectCDP } from './lib/connect.js';
import fs from 'node:fs';

const url = process.argv[2] || 'https://live.slop.computer/port-dev?invite=YOUR_INVITE_CODE';
const { browser, page } = await connectCDP(9223);
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);

// Hook clipboard to capture whatever "copy skill" writes.
await page.evaluate(() => {
  window.__copied = null;
  try {
    const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (t) => { window.__copied = t; try { return orig(t); } catch { return Promise.resolve(); } };
  } catch {}
  const origExec = document.execCommand.bind(document);
  document.execCommand = (cmd, ...a) => {
    if (cmd === 'copy') {
      const el = document.activeElement;
      window.__copied = (el && 'value' in el) ? el.value : (window.getSelection() || '').toString();
    }
    return origExec(cmd, ...a);
  };
});

const boxOf = (text) => page.evaluate((t) => {
  let best = null;
  for (const el of document.querySelectorAll('*')) {
    if ((el.innerText || '').trim() !== t) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (!best || r.top < best.top) best = { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top };
  }
  return best;
}, text);

const menu = await boxOf('SLOP.COMPUTER');
await page.mouse.click(menu.x, menu.y);
await page.waitForTimeout(1200);
const item = await boxOf('copy skill');
console.log('copy skill at:', JSON.stringify(item));
await page.mouse.click(item.x, item.y);
await page.waitForTimeout(1500);

const skill = await page.evaluate(() => window.__copied);
console.log('\n=== captured skill ===');
console.log('length:', skill ? skill.length : 0, 'chars');
if (skill) {
  fs.writeFileSync('/tmp/port-dev-skill.txt', skill);
  console.log('saved: /tmp/port-dev-skill.txt');
  console.log('\n--- first 1500 chars ---\n' + skill.slice(0, 1500));
} else {
  console.log('(nothing captured — copy may use a different mechanism)');
}
await browser.close();
