import { connectCDP } from './lib/connect.js';
import fs from 'node:fs';

const SLUG = process.argv[2];
const URL = process.argv[3]; // full room URL incl. ?invite=...
if (!SLUG || !URL) { console.error('usage: node save-card.js <slug> \'<roomUrl with ?invite=...>\' [outPath]'); process.exit(1); }
const OUT = process.argv[4] || `/tmp/${SLUG}card.png`;

const { browser, page } = await connectCDP(9223);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);

const findSave = () => page.locator('[aria-label="save as unfurl"]');

// Open the Card app if its window (save button) isn't present.
if (await findSave().count() === 0) {
  console.log('card window not open — locating the Card desktop icon…');
  const box = await page.evaluate(() => {
    for (const e of document.querySelectorAll('*')) {
      const t = (e.innerText || '').trim().toLowerCase();
      const r = e.getBoundingClientRect();
      if (t === 'card' && r.width > 0 && r.width < 160 && r.top < window.innerHeight) {
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }
    return null;
  });
  if (box) { console.log('double-clicking Card icon at', JSON.stringify(box)); await page.mouse.dblclick(box.x, box.y); await page.waitForTimeout(2500); }
  else console.log('could not find a "card" desktop icon');
}

const n = await findSave().count();
console.log('save-as-unfurl button present:', n > 0);
if (n > 0) {
  await findSave().first().click();
  console.log('clicked "save as unfurl" (bake + publish)…');
  await page.waitForTimeout(4000);
} else {
  const icons = await page.evaluate(() => [...new Set([...document.querySelectorAll('button,[role="button"],li,div,span')]
    .map((e) => (e.innerText || '').trim()).filter((t) => t && t.length > 0 && t.length < 18))].slice(0, 60));
  console.log('desktop labels (to find the card app):', JSON.stringify(icons));
}

// Download the published unfurl image.
const res = await fetch(`https://live.slop.computer/v1/cards/${SLUG}/published.png?v=${Date.now()}`);
if (res.ok) {
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(OUT, buf);
  console.log(`saved ${OUT} (${buf.length} bytes, HTTP ${res.status})`);
} else {
  console.log('published.png not ready yet — HTTP', res.status);
}
await browser.close();
