// General: pick a slop episode needing a link -> read its guest email -> derive
// verify-signals automatically (org from email domain + name + buidlguidl) ->
// resolve & verify the X handle -> cache it, or STOP & ask. Works for ANY guest.
//
//   node resolve-guest.js              # the next TODO episode
//   node resolve-guest.js 2            # the 2nd TODO in the queue
//   node resolve-guest.js "Zak"        # the TODO whose title matches
import { connectCDP } from './lib/connect.js';
import { searchSlopEpisodes } from './workflows/find-next-slop.js';
import { resolveTwitter, deriveOrgSignal } from './lib/resolve-twitter.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(__dirname, 'data', 'guest-twitter.json');
const force = process.argv.includes('--force');           // bypass cache (re-resolve)
const arg = process.argv.slice(2).find((a) => a !== '--force');

async function openEventDetail(page, start, titleMatch) {
  const y = start.getFullYear(), m = start.getMonth() + 1, d = start.getDate();
  await page.goto(`https://calendar.google.com/calendar/u/0/r/day/${y}/${m}/${d}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);
  const ids = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-eventid]')].map((e) => e.getAttribute('data-eventid')))]);
  for (const id of ids) {
    const chip = page.locator(`[data-eventid="${id}"]`).first();
    await chip.click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const text = (await page.locator('[role="dialog"]').first().innerText().catch(() => '')) || '';
    await page.keyboard.press('Escape');
    if (text.toLowerCase().includes(titleMatch.toLowerCase())) return text;
    await page.waitForTimeout(350);
  }
  return '';
}

function guestEmailFrom(detail) {
  const emails = [...detail.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)].map((m) => m[0]);
  return emails.find((e) => !/ethereum\.org$/i.test(e) && !/austin/i.test(e)) || null;
}

async function main(page) {
  const { episodesNeedingLink } = await searchSlopEpisodes(page);
  if (!episodesNeedingLink.length) return console.log('No upcoming slop episodes need a link.');

  let pick;
  if (arg && /^\d+$/.test(arg)) pick = episodesNeedingLink[parseInt(arg, 10) - 1];
  else if (arg) pick = episodesNeedingLink.find((e) => e.title.toLowerCase().includes(arg.toLowerCase()));
  else pick = episodesNeedingLink[0];
  if (!pick) return console.log(`No TODO episode matched "${arg}". TODOs: ${episodesNeedingLink.map((e) => e.title).join(' | ')}`);

  const guestName = pick.title.replace(/\s+and\s+Austin Griffith.*$/i, '').trim();
  console.log(`TARGET: ${pick.title}  (${pick.date}, ${pick.timeRange})`);

  const detail = await openEventDetail(page, pick.start, guestName);
  const email = guestEmailFrom(detail);
  const org = email ? deriveOrgSignal(email) : null;
  console.log(`guest: "${guestName}"   email: ${email || '(not found)'}   org-signal: ${org || '(generic/none)'}`);

  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch {}
  if (email && cache[email] && !force) return console.log(`\n==> CACHE HIT: ${email} -> @${cache[email].handle} (already resolved)`);

  const emailLocal = email ? email.split('@')[0] : null;
  const query = `${guestName} twitter`;
  console.log(`\nresolving "${query}"  | signals: name="${guestName}" org="${org || ''}" email-local="${emailLocal || ''}" (+follows-you)\n`);
  const { results, best, second, threshold, decision } = await resolveTwitter(page, { query, names: [guestName], orgs: [org], emailLocal, constants: [] });

  console.log(`candidates: ${results.map((r) => '@' + r.handle).join(', ') || '(none)'}`);
  for (const r of results) {
    const tags = [r.iFollow ? 'I-FOLLOW✓' : '', r.emailExact ? 'email=handle✓' : (r.emailPartial ? 'email~handle' : ''), r.nameMatch ? 'name✓' : '', r.orgMatched.length ? 'org:' + r.orgMatched.join('+') : '', r.manyMutuals ? 'mutuals>20' : '', r.followsYou ? 'follows-me' : ''].filter(Boolean).join(' ');
    console.log(`  @${r.handle}  score=${r.score}  ${tags}\n     ${r.name} — ${r.bio.replace(/\n/g, ' ').slice(0, 80)}`);
  }

  const signalsOf = (r) => [r.iFollow ? 'i-follow-them' : '', r.emailExact ? 'email=handle' : '', r.nameMatch ? 'name' : '', ...r.orgMatched, r.manyMutuals ? 'mutuals>20' : '', r.followsYou ? 'follows-me' : ''].filter(Boolean);
  const writeCache = (r) => {
    if (!email) return;
    cache[email] = { handle: r.handle, url: `https://x.com/${r.handle}`, name: r.name, verifiedSignals: signalsOf(r), bio: r.bio.replace(/\n/g, ' '), episode: pick.title, score: r.score };
    fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2) + '\n');
    console.log(`    cached: ${email} -> @${r.handle}`);
  };

  if (decision === 'auto') {
    console.log(`\n==> AUTO-ACCEPT (confident): @${best.handle}  score ${best.score} ≥ ${threshold}  [${signalsOf(best).join(', ')}]`);
    writeCache(best);
  } else if (decision === 'ask-ambiguous') {
    console.log(`\n==> AMBIGUOUS — two strong matches.`);
    console.log(`ASK AUSTIN: "Two strong matches for ${guestName} — @${best.handle} (${best.score}) or @${second.handle} (${second.score})?"`);
  } else if (decision === 'ask-low') {
    console.log(`\n==> LOW CONFIDENCE: best @${best.handle} score ${best.score} < ${threshold}.`);
    console.log(`ASK AUSTIN: "Best guess for ${guestName} is @${best.handle} (low confidence) — right, or a different handle?"`);
  } else {
    console.log(`\n==> UNCONFIRMED — no candidate verified.`);
    console.log(`ASK AUSTIN: "I can't confidently find ${guestName}'s X handle — what is it?"`);
  }
}

const { browser, page } = await connectCDP(9223);
try { await main(page); } finally { await browser.close(); }
