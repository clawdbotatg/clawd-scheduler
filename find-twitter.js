// Deterministic Twitter/X resolver. Runs a query in YOUR logged-in Google (clone),
// collects candidate X handles, opens each profile, and VERIFIES the bio against
// expected signals (e.g. "monad","buidlguidl"). Picks the verified match — robust
// to namesake traps where the wrong "port" (a company) outranks the person.
//
//   node find-twitter.js "<google query>" "<comma,separated,verify,keywords>"
//
// Returns the verified handle, or flags UNCONFIRMED (-> stop and ask).
import { connectCDP } from './lib/connect.js';

const query = process.argv[2] || 'port dev twitter';
const keywords = (process.argv[3] || 'monad,buidlguidl')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const RESERVED = new Set(['i', 'home', 'search', 'hashtag', 'explore', 'notifications',
  'messages', 'settings', 'intent', 'share', 'login', 'tweetdeck', 'about', 'tos',
  'privacy', 'status', 'compose', 'logout', 'signup']);

function handleFromUrl(u) {
  try {
    const url = new URL(u);
    if (!/(^|\.)(x|twitter)\.com$/i.test(url.hostname)) return null;
    const seg = url.pathname.split('/').filter(Boolean);
    if (!seg.length || seg.includes('status')) return null;
    const h = seg[0];
    if (RESERVED.has(h.toLowerCase())) return null;
    if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) return null;
    return h;
  } catch { return null; }
}

const { browser, page } = await connectCDP(9223);
try {
  await page.goto('https://www.google.com/search?q=' + encodeURIComponent(query), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const hrefs = await page.evaluate(() => [...document.querySelectorAll('a')].map((a) => a.href).filter(Boolean));
  const seen = new Set(); const candidates = [];
  for (const h of hrefs) {
    const hd = handleFromUrl(h);
    if (hd && !seen.has(hd.toLowerCase())) { seen.add(hd.toLowerCase()); candidates.push(hd); }
  }
  const top = candidates.slice(0, 5);

  const results = [];
  for (const handle of top) {
    await page.goto('https://x.com/' + handle, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const info = await page.evaluate(() => ({
      name: (document.querySelector('[data-testid="UserName"]')?.innerText || '').replace(/\n/g, ' ').trim(),
      bio: document.querySelector('[data-testid="UserDescription"]')?.innerText || '',
      followsYou: /(^|\s)Follows you(\s|$)/.test(document.body.innerText || ''),
    }));
    const hay = (info.bio + ' ' + info.name).toLowerCase();
    const matched = keywords.filter((k) => hay.includes(k));
    const score = matched.length * 2 + (info.followsYou ? 1 : 0);
    results.push({ handle, ...info, matched, score });
  }
  results.sort((a, b) => b.score - a.score);

  console.log(`QUERY: "${query}"   verify=[${keywords.join(', ')}]`);
  console.log(`candidate handles (in Google rank): ${top.map((h) => '@' + h).join(', ') || '(none)'}\n`);
  for (const r of results) {
    console.log(`@${r.handle}  score=${r.score}${r.followsYou ? '  (follows you)' : ''}${r.matched.length ? '  matched:[' + r.matched.join(',') + ']' : ''}`);
    console.log(`   name: ${r.name}`);
    console.log(`   bio : ${r.bio.replace(/\n/g, ' ')}`);
  }
  const best = results.find((r) => r.matched.length > 0); // require at least one verified signal
  console.log('\n==> RESULT:', best
    ? `@${best.handle}  ✅ VERIFIED via [${best.matched.join(', ')}]`
    : 'UNCONFIRMED — no candidate verified against the signals. STOP and ask Austin.');
} finally {
  await browser.close();
}
