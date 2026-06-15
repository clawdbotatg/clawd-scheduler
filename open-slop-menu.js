import { connectCDP } from './lib/connect.js';

const { browser, page } = await connectCDP(9223);
await page.goto('https://live.slop.computer/port-dev?invite=YOUR_INVITE_CODE', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);

// Hook clipboard so we can read whatever "copy skill" writes.
await page.evaluate(() => {
  window.__copied = null;
  try {
    const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (t) => { window.__copied = t; return orig(t); };
  } catch {}
  const origExec = document.execCommand.bind(document);
  document.execCommand = (cmd, ...a) => {
    if (cmd === 'copy') {
      const el = document.activeElement;
      if (el && 'value' in el) window.__copied = el.value;
      else window.__copied = (window.getSelection() || '').toString();
    }
    return origExec(cmd, ...a);
  };
});

console.log('locating top-left SLOP.COMPUTER menu...');
const box = await page.evaluate(() => {
  let best = null;
  for (const el of document.querySelectorAll('*')) {
    if ((el.innerText || '').trim() !== 'SLOP.COMPUTER') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // menu-bar item = topmost (smallest y), not the big center watermark
    if (!best || r.top < best.top) best = { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, w: r.width };
  }
  return best;
});
console.log('menu box:', JSON.stringify(box));
if (!box) { console.log('could not locate menu'); await browser.close(); process.exit(1); }
await page.mouse.click(box.x, box.y);
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/slop-menu.png' });

const items = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('[role="menuitem"], li, button, a')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const t = (el.innerText || '').trim().replace(/\s+/g, ' ');
    if (t && t.length < 40) out.push(t);
  }
  return [...new Set(out)];
});
console.log('--- menu items visible ---');
console.log(JSON.stringify(items, null, 0));
await browser.close();
