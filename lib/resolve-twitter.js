// Shared X/Twitter resolution core. Runs a query in the (logged-in) Google of the
// connected clone, gathers candidate handles, opens each profile, and verifies the
// bio/name against signals derived from the guest. Robust to namesake traps.

const RESERVED = new Set(['i', 'home', 'search', 'hashtag', 'explore', 'notifications',
  'messages', 'settings', 'intent', 'share', 'login', 'tweetdeck', 'about', 'tos',
  'privacy', 'status', 'compose', 'logout', 'signup']);

const GENERIC_EMAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com',
  'yahoo.com', 'proton.me', 'protonmail.com', 'icloud.com', 'me.com', 'pm.me', 'aol.com',
  'live.com', 'fastmail.com', 'hey.com']);

/** acme.org -> "acme"; widgets.xyz -> "widgets"; gmail.com -> null */
export function deriveOrgSignal(email) {
  const domain = (String(email).split('@')[1] || '').toLowerCase().trim();
  if (!domain || GENERIC_EMAIL.has(domain)) return null;
  const parts = domain.split('.');
  // second-level label (handles foo.org, foo.foundation, foo.co.uk roughly)
  const sld = parts.length >= 3 && parts[parts.length - 2].length <= 3
    ? parts[parts.length - 3]  // foo.co.uk -> foo
    : parts[parts.length - 2]; // foo.org    -> foo
  return sld || null;
}

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

/**
 * @param page  Playwright page on the logged-in clone
 * @param opts  { query, names:[], orgs:[], constants:['buidlguidl'], emailLocal, max:5 }
 * @returns { candidates:[handle], results:[{handle,name,bio,followsYou,nameMatch,orgMatched,constMatched,emailExact,score}], best }
 */
export async function resolveTwitter(page, opts) {
  const { query, names = [], orgs = [], constants = ['buidlguidl'], emailLocal = null, max = 5 } = opts;
  const localL = emailLocal ? String(emailLocal).toLowerCase() : null;

  await page.goto('https://www.google.com/search?q=' + encodeURIComponent(query), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const hrefs = await page.evaluate(() => [...document.querySelectorAll('a')].map((a) => a.href).filter(Boolean));

  const seen = new Set(); const candidates = [];
  for (const h of hrefs) {
    const hd = handleFromUrl(h);
    if (hd && !seen.has(hd.toLowerCase())) { seen.add(hd.toLowerCase()); candidates.push(hd); }
  }
  const top = candidates.slice(0, max);

  const nameTokens = names.join(' ').toLowerCase().split(/\s+/).filter((t) => t.length > 1 && t !== 'dev');
  const orgL = orgs.filter(Boolean).map((s) => s.toLowerCase());
  const constL = constants.map((s) => s.toLowerCase());

  const results = [];
  for (const handle of top) {
    await page.goto('https://x.com/' + handle, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const info = await page.evaluate(() => ({
      name: (document.querySelector('[data-testid="UserName"]')?.innerText || '').replace(/\n/g, ' ').trim(),
      bio: document.querySelector('[data-testid="UserDescription"]')?.innerText || '',
      followsYou: /(^|\s)Follows you(\s|$)/.test(document.body.innerText || ''),
      // Do I (the logged-in user) follow them? The profile action button reads
      // "Following" (data-testid ...-unfollow) when you already follow them.
      iFollow: !!document.querySelector('[data-testid$="-unfollow"]')
        || !!document.querySelector('button[aria-label^="Following @"]'),
      // Mutuals: X shows "Followed by a, b and N others you follow" on the profile.
      mutuals: (() => {
        const t = document.body.innerText || '';
        const m = t.match(/and\s+([\d,]+)\s+others?\s+you follow/i);
        if (m) return parseInt(m[1].replace(/,/g, ''), 10) + 2; // + the named ones
        return /Followed by .+? you follow/i.test(t) ? 2 : 0;     // a couple named, no "others"
      })(),
    }));
    const hl = handle.toLowerCase();
    const nameHay = info.name.toLowerCase();
    const bioHay = (info.bio + ' ' + info.name).toLowerCase();
    const nameMatch = nameTokens.length > 0 && nameTokens.every((t) => nameHay.includes(t));
    const orgMatched = orgL.filter((o) => bioHay.includes(o));
    const constMatched = constL.filter((c) => bioHay.includes(c));
    // email local-part vs handle: "alice@gmail" -> @alice is an exact hit.
    const emailExact = !!localL && hl === localL;
    const emailPartial = !!localL && !emailExact && localL.length >= 5 && (hl.includes(localL) || localL.includes(hl));
    // iFollow & email=handle are "strong-alone" (each clears the threshold by
    // itself). name/org are verifiers; mutuals>20 & followsYou are bonuses.
    const manyMutuals = info.mutuals > 20;
    const score = (info.iFollow ? 5 : 0) + (emailExact ? 5 : 0) + (nameMatch ? 3 : 0) +
      orgMatched.length * 2 + (manyMutuals ? 2 : 0) + (info.followsYou ? 1 : 0) +
      constMatched.length + (emailPartial ? 1 : 0);
    results.push({ handle, ...info, nameMatch, orgMatched, constMatched, emailExact, emailPartial, manyMutuals, score });
  }
  results.sort((a, b) => b.score - a.score);

  // A candidate is "verified" if it carries a STRONG identity signal.
  const verified = results.filter((r) => r.iFollow || r.emailExact || r.nameMatch || r.orgMatched.length > 0);
  const best = verified[0] || null;
  const second = verified[1] || null;

  // Confidence: auto-accept at or above the threshold, unless the runner-up is
  // also above it and within 1 pt (genuinely ambiguous -> ask).
  const THRESHOLD = opts.threshold ?? 5;
  const confident = !!best && best.score >= THRESHOLD;
  const ambiguous = confident && !!second && second.score >= THRESHOLD && best.score - second.score <= 1;
  const decision = !best ? 'ask-none' : !confident ? 'ask-low' : ambiguous ? 'ask-ambiguous' : 'auto';

  return { candidates: top, results, best, second, threshold: THRESHOLD, confident, ambiguous, decision };
}
