import { connectCDP } from './lib/connect.js';

const q = process.argv[2] || 'port dev twitter';
const { browser, page } = await connectCDP(9223);

await page.goto('https://www.google.com/search?q=' + encodeURIComponent(q), {
  waitUntil: 'domcontentloaded',
});
await page.waitForTimeout(3000);

// Grab the top organic results (title + url).
const results = await page.evaluate(() => {
  const out = [];
  for (const h3 of document.querySelectorAll('h3')) {
    const a = h3.closest('a');
    const href = a?.href || '';
    if (!href || href.startsWith('https://www.google.')) continue;
    out.push({ title: h3.textContent.trim(), url: href });
    if (out.length >= 8) break;
  }
  return out;
});

await page.screenshot({ path: '/tmp/google-port.png' });
console.log(`QUERY: ${q}\n`);
results.forEach((r, i) => console.log(`${i + 1}. ${r.title}\n   ${r.url}`));
if (!results.length) console.log('(no h3 results parsed — see /tmp/google-port.png; may be a captcha)');

await browser.close();
