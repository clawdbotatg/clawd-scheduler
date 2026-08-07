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

  const seen = new Set(); const candidates = [];
  const add = (hd) => {
    if (!hd || seen.has(hd.toLowerCase())) return;
    seen.add(hd.toLowerCase()); candidates.push(hd);
  };

  // --- candidate source 0: explicit seeds ---
  // Handles proposed from OUTSIDE the search: a GitHub username, the guest's
  // website, a guess, something Austin mentioned. These are precisely the ones
  // that used to get hand-written into the cache with no verification at all —
  // the 2026-08-07 failure (github.com/ludamad -> assumed x.com/ludamad, which
  // is a dormant account). Seeding them here runs them through the same
  // dormancy gate and sibling sweep as anything else.
  for (const s of (opts.seeds || [])) add(String(s).replace(/^@/, '').trim());

  // --- candidate source 1: Google ---
  // Great when the person's X account is well-linked on the open web. Useless
  // when it isn't: Google for "Adam Domurad twitter" returns LinkedIn,
  // ResearchGate and Facebook and ZERO x.com links, which is how the
  // 2026-08-07 episode ended up hand-resolved off a GitHub username instead.
  await page.goto('https://www.google.com/search?q=' + encodeURIComponent(query), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const hrefs = await page.evaluate(() => [...document.querySelectorAll('a')].map((a) => a.href).filter(Boolean));
  for (const h of hrefs) add(handleFromUrl(h));
  const googleFound = candidates.length;

  // --- candidate source 2: X's OWN people search ---
  // The authority on who exists on X, and the only source that finds accounts
  // with a small follower count and no inbound web links.
  const peopleSearch = async (q) => {
    await page.goto('https://x.com/search?q=' + encodeURIComponent(q) + '&f=user', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    return page.evaluate(() => [...document.querySelectorAll('[data-testid="UserCell"]')]
      .map((c) => [...c.querySelectorAll('a')].map((a) => a.getAttribute('href')).find((x) => /^\/[A-Za-z0-9_]+$/.test(x || '')))
      .filter(Boolean).map((h) => h.slice(1)));
  };
  for (const n of names.filter(Boolean)) {
    for (const hd of (await peopleSearch(n)).slice(0, max)) add(hd);
  }

  // Each candidate costs a page load + settle, so cap the board. Seeds and
  // Google hits are first in the list and always survive the cut.
  const top = candidates.slice(0, opts.cap ?? 12);

  const nameTokens = names.join(' ').toLowerCase().split(/\s+/).filter((t) => t.length > 1 && t !== 'dev');
  const orgL = orgs.filter(Boolean).map((s) => s.toLowerCase());
  const constL = constants.map((s) => s.toLowerCase());

  // Scrape one profile. Split out of the loop so the dormant-sibling probe
  // below can reuse it on handles Google never surfaced.
  const inspect = async (handle) => {
    await page.goto('https://x.com/' + handle, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    return page.evaluate(() => ({
      exists: !document.body.innerText.includes("This account doesn’t exist")
        && !document.body.innerText.includes("This account doesn't exist"),
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
      // Activity: is there a PERSON behind this handle, or just a reservation?
      stats: (() => {
        const num = (s) => {
          const m = String(s || '').replace(/,/g, '').match(/([\d.]+)\s*([KM])?/i);
          if (!m) return null;
          const mult = /k/i.test(m[2] || '') ? 1e3 : /m/i.test(m[2] || '') ? 1e6 : 1;
          return Math.round(parseFloat(m[1]) * mult);
        };
        const linkNum = (suffix) => {
          const a = [...document.querySelectorAll('a')].find((x) => (x.getAttribute('href') || '').endsWith(suffix));
          return a ? num(a.innerText) : null;
        };
        const t = document.body.innerText || '';
        return {
          posts: num((t.match(/([\d.,KM]+)\s+posts?\b/i) || [])[1]),
          following: linkNum('/following'),
          followers: linkNum('/verified_followers') ?? linkNum('/followers'),
        };
      })(),
    }));
  };

  // Grade one scraped profile against the signals.
  const grade = (handle, info) => {
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
    // DORMANT = a handle with the right name and no human behind it. X is full
    // of these: an account someone registered years ago, never posts from, but
    // which still carries their real name and may even still follow you. It
    // lights up every name signal and is the wrong answer every time — the
    // live account is almost always a near-variant (@name_, @name1). This cost
    // us the 2026-08-07 episode: @ludamad (0 posts, no bio, real name "Adam
    // Domurad", follows-you) beat the real @ludamad_ (2.2k posts, @aztecnetwork
    // in bio, 35 mutuals). A dormant account can never be auto-accepted.
    const st = info.stats || {};
    const dormant = st.posts === 0 || (st.posts !== null && st.posts < 5 && !String(info.bio).trim());
    // Mutual overlap with the host is GRADED, not a flat bonus: "35 people you
    // follow also follow them" is the strongest community signal available when
    // the display name is a nickname rather than a legal name, and it's what
    // separates the real guest from a same-name stranger (a namesake has 0).
    const mutualPts = info.mutuals > 20 ? 3 : info.mutuals > 5 ? 2 : info.mutuals > 0 ? 1 : 0;
    const score = (info.iFollow ? 5 : 0) + (emailExact ? 5 : 0) + (nameMatch ? 3 : 0) +
      orgMatched.length * 2 + mutualPts + (info.followsYou ? 1 : 0) +
      constMatched.length + (emailPartial ? 1 : 0);
    return { handle, ...info, nameMatch, orgMatched, constMatched, emailExact, emailPartial, manyMutuals, dormant, score };
  };

  const results = [];
  for (const handle of top) results.push(grade(handle, await inspect(handle)));

  // If a dormant handle matched, the live account is usually the same handle
  // with punctuation (@name_, @name1). Ask X's people search for the handle
  // itself — searching "ludamad" returns @ludamad_ (2.2k posts, @aztecnetwork)
  // ABOVE the dormant @ludamad, which is exactly the correction we need.
  for (const r of results.filter((x) => x.dormant && (x.nameMatch || x.emailExact || x.iFollow))) {
    for (const sib of (await peopleSearch(r.handle)).slice(0, 4)) {
      if (seen.has(sib.toLowerCase())) continue;
      seen.add(sib.toLowerCase());
      const info = await inspect(sib);
      if (!info.exists || !info.name) continue;
      const g = grade(sib, info);
      // A LIVE account sitting next to the dormant one that matched the guest's
      // name is the single best correction signal we have — worth more than a
      // random namesake, but deliberately NOT enough to clear the threshold on
      // its own: the whole point is to surface it and still ask.
      results.push({ ...g, viaSibling: r.handle, score: g.score + (g.dormant ? 0 : 2) });
    }
  }
  // Deterministic tiebreak: on equal score prefer the account the host's circle
  // actually follows, then the one with a real posting history.
  const rank = (a, b) => b.score - a.score || b.mutuals - a.mutuals || (b.stats?.posts ?? 0) - (a.stats?.posts ?? 0);
  results.sort(rank);

  // A candidate is "verified" if it carries a STRONG identity signal — and is
  // not a dormant name-squat (see above). Heavy mutual overlap counts: it's how
  // you find the account a community actually follows when the display name is
  // a nickname rather than the person's legal name.
  const verified = results.filter((r) => !r.dormant
    && (r.iFollow || r.emailExact || r.nameMatch || r.orgMatched.length > 0 || r.manyMutuals));
  const best = verified[0] || null;
  const second = verified[1] || null;
  // Surfaced so the caller can say "I ignored @x because it looks abandoned".
  const dormantSkipped = results.filter((r) => r.dormant
    && (r.iFollow || r.emailExact || r.nameMatch || r.orgMatched.length > 0));

  // Confidence: auto-accept at or above the threshold, unless the runner-up is
  // also above it and within 1 pt (genuinely ambiguous -> ask).
  const THRESHOLD = opts.threshold ?? 5;
  const confident = !!best && best.score >= THRESHOLD;
  const ambiguous = confident && !!second && second.score >= THRESHOLD && best.score - second.score <= 1;
  // A winner reached via the dormant-sibling sweep is us saying "the obvious
  // answer looks wrong and this is our correction" — never auto-accept that,
  // however well it scores. It costs one question and it is exactly the case
  // that went out wrong on 2026-08-07.
  const decision = !best ? 'ask-none'
    : best.viaSibling ? 'ask-sibling'
    : !confident ? 'ask-low'
    : ambiguous ? 'ask-ambiguous' : 'auto';

  return { candidates: top, results, best, second, dormantSkipped, threshold: THRESHOLD, confident, ambiguous, decision };
}
