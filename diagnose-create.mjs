import { connectCDP } from './lib/connect.js';
const { browser, page } = await connectCDP(9223);
const logs = [], fails = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`.slice(0,160)));
page.on('requestfailed', r => fails.push(`${r.failure()?.errorText} ${r.url()}`.slice(0,160)));
page.on('response', r => { if (r.status() >= 400) fails.push(`HTTP ${r.status()} ${r.url()}`.slice(0,160)); });

await page.goto('https://live.slop.computer/admin', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await page.getByPlaceholder('slug (e.g. ep0)').fill('port_dev');
await page.waitForTimeout(800);
await page.evaluate(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='CREATE'); b && b.click(); });
await page.waitForTimeout(4000);

// any visible error/toast?
const err = await page.evaluate(() => {
  const t = document.body.innerText || '';
  const lines = t.split('\n').filter(l => /fail|error|denied|unauthor|sign|relay|wallet|reject/i.test(l));
  return lines.slice(0,8);
});
console.log('--- console (last 12) ---'); console.log(logs.slice(-12).join('\n'));
console.log('\n--- failed/4xx requests ---'); console.log([...new Set(fails)].slice(-10).join('\n') || '(none)');
console.log('\n--- on-page error-ish lines ---'); console.log(err.join('\n') || '(none)');

// reload & check persistence
await page.goto('https://live.slop.computer/admin', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
const slugs = await page.evaluate(() => (document.body.innerText||'').split('\n').map(l=>l.trim().match(/^\/([a-z0-9_-]{1,30})$/i)?.[1]).filter(Boolean));
console.log('\n--- rooms after reload ---'); console.log(slugs.join('  '));
console.log('port_dev present:', slugs.map(s=>s?.toLowerCase()).includes('port_dev'));
await browser.close();
