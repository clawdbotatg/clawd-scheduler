import { connectCDP } from './lib/connect.js';
import { PORTS } from './lib/config.js';
import fs from 'node:fs';

if (!process.argv[2]) { console.error('usage: node get-pfp.js <handle>'); process.exit(1); }
const handle = process.argv[2].replace(/^@/, '');
const { browser, page } = await connectCDP(PORTS.social);
await page.goto(`https://x.com/${handle}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

const { src, name } = await page.evaluate((h) => {
  // The profile-header avatar is the one whose link is exactly /<handle>/photo,
  // OR the container testid'd with THIS handle. Avoids the logged-in user's nav avatar.
  const pick = (root) => {
    if (!root) return null;
    const img = root.querySelector('img');
    if (img && /profile_images/.test(img.src)) return img.src;
    for (const e of root.querySelectorAll('*')) {
      const bg = getComputedStyle(e).backgroundImage;
      if (/profile_images/.test(bg)) { const m = bg.match(/url\("?(.*?)"?\)/); if (m) return m[1]; }
    }
    return null;
  };
  const src =
    pick(document.querySelector(`a[href="/${h}/photo"]`)) ||
    pick(document.querySelector(`[data-testid="UserAvatar-Container-${h}"]`));
  const name = document.querySelector('[data-testid="UserName"]')?.innerText.replace(/\n/g, ' ').trim() || '';
  return { src, name };
}, handle);

console.log('handle:', '@' + handle, '| profile name on page:', name || '(unknown)');
console.log('avatar src:', src || '(not found)');
if (!src) { await browser.close(); process.exit(1); }

// Upgrade to the 400x400 variant for a crisp card image.
const hi = src.replace(/_(normal|bigger|mini|\d+x\d+|x96)(\.\w+)(\?.*)?$/i, '_400x400$2$3');
console.log('downloading:', hi);
const res = await fetch(hi);
const buf = Buffer.from(await res.arrayBuffer());
const out = `/tmp/${handle}-pfp.jpg`;
fs.writeFileSync(out, buf);
console.log(`saved ${out} (${buf.length} bytes, HTTP ${res.status})`);
await browser.close();
