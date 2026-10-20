// resolve a guest X handle from an explicit email + name (+ org, seeds) — the Calendar-API path of schedule-next.mjs
import { connectCDP } from './lib/connect.js';
import { PORTS } from './lib/config.js';
import { resolveTwitter } from './lib/resolve-twitter.js';
import fs from 'node:fs';
const [email, name, org, ...seeds] = process.argv.slice(2);
const CACHE = 'data/guest-twitter.json';
const { browser, page } = await connectCDP(PORTS.social);
try {
  const emailLocal = email.split('@')[0];
  const { results, best, second, dormantSkipped, threshold, decision } = await resolveTwitter(page, { query: `${name} twitter`, names: [name], orgs: [org], emailLocal, constants: [], seeds });
  for (const r of results) {
    const tags = [r.iFollow ? 'I-FOLLOW✓' : '', r.emailExact ? 'email=handle✓' : (r.emailPartial ? 'email~handle' : ''), r.nameMatch ? 'name✓' : '', r.orgMatched.length ? 'org:' + r.orgMatched.join('+') : '', r.manyMutuals ? `mutuals:${r.mutuals}` : '', r.followsYou ? 'follows-me' : '', r.viaSibling ? `sibling-of:@${r.viaSibling}` : '', r.dormant ? 'DORMANT✗' : ''].filter(Boolean).join(' ');
    const s = r.stats || {};
    console.log(`  @${r.handle}  score=${r.score}  ${tags}\n     ${r.name} — ${r.bio.replace(/\n/g, ' ').slice(0, 100)}\n     posts=${s.posts ?? '?'} followers=${s.followers ?? '?'} following=${s.following ?? '?'}`);
  }
  for (const d of dormantSkipped) console.log(`!! SKIPPED @${d.handle} — DORMANT (posts=${d.stats?.posts ?? '?'})`);
  console.log(`decision=${decision} best=@${best?.handle} score=${best?.score} threshold=${threshold} second=@${second?.handle}`);
  if (decision === 'auto') {
    const signals = [best.iFollow ? 'i-follow-them' : '', best.emailExact ? 'email=handle' : '', best.nameMatch ? 'name' : '', ...best.orgMatched, best.manyMutuals ? 'mutuals>20' : '', best.followsYou ? 'follows-me' : ''].filter(Boolean);
    let cache = {}; try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch {}
    cache[email] = { handle: best.handle, url: `https://x.com/${best.handle}`, name: best.name, verifiedSignals: signals, bio: best.bio.replace(/\n/g, ' '), episode: 'SLOP.COMPUTER', score: best.score };
    fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2) + '\n');
    console.log(`cached: ${email} -> @${best.handle}`);
  }
} finally { await browser.close(); }
