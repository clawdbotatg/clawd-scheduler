import { TOKEN, BASE } from './lib/config.js';
const SLUG = process.argv[2] || 'port-dev';
const TWITTER = process.argv[3] || '@port_dev';
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const research = async () => ((await (await fetch(`${BASE}/v1/state?slug=${SLUG}`, { headers: H })).json()).researchState) || {};

async function pollDone(maxMs) {
  const t0 = Date.now(); let last = '';
  while (Date.now() - t0 < maxMs) {
    const r = await research();
    if (r.job == null) return r;
    if (r.phase !== last) { console.log(`   …phase=${r.phase} job=${r.job?.kind}`); last = r.phase; }
    await new Promise((z) => setTimeout(z, 3000));
  }
  return await research();
}

// 1) Lookup — "get the twitter handle into the research app"
console.log(`POST guest-lookup {query:"${TWITTER}"}`);
let res = await fetch(`${BASE}/v1/guest-lookup?slug=${SLUG}`, { method: 'POST', headers: H, body: JSON.stringify({ query: TWITTER }) });
console.log('   ->', res.status);
let r = await pollDone(90000);
console.log(`after lookup: phase=${r.phase}  name="${r.name || ''}"  socials=${JSON.stringify(r.socials || {})}`);

// 2) Research — kick off the dossier
const socials = { ...(r.socials || {}), twitter: TWITTER };
const name = r.name || TWITTER.replace(/^@/, '');
console.log(`\nPOST guest-research {name:"${name}", socials:${JSON.stringify(socials)}}`);
res = await fetch(`${BASE}/v1/guest-research?slug=${SLUG}`, { method: 'POST', headers: H, body: JSON.stringify({ name, socials, notes: 'SLOP.COMPUTER podcast guest.' }) });
console.log('   ->', res.status);
r = await pollDone(240000);
console.log(`after research: phase=${r.phase}`);

if (r.result) {
  console.log('\n=========== DOSSIER ===========');
  console.log('PREVIEW BLURB:', (r.result.socialsDesc || '').slice(0, 400));
  console.log('\nQUESTIONS:');
  (r.result.questions || []).forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
  console.log(`\nsources: ${(r.result.sources || []).length}   tweets: ${(r.result.tweets || []).length}`);
} else {
  console.log('NO RESULT. errors:', JSON.stringify(r.errors || r.error || '(none)'));
}
