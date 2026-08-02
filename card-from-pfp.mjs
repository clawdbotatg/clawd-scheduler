import fs from 'node:fs';
import { TOKEN, BASE } from './lib/config.js';
const SLUG = process.argv[2];
const IMG = process.argv[3];
if (!SLUG || !IMG) { console.error('usage: node card-from-pfp.mjs <slug> <pfpPath>'); process.exit(1); }
const H = { Authorization: `Bearer ${TOKEN}` };

const cardOf = async () => {
  const s = await (await fetch(`${BASE}/v1/state?slug=${SLUG}`, { headers: H })).json();
  return { job: s.cardJob, state: s.cardState };
};

const before = await cardOf();
console.log('card before:', JSON.stringify(before));

const bytes = fs.readFileSync(IMG);
console.log(`POST /v1/card (${bytes.length} bytes, image/jpeg) from ${IMG}`);
const res = await fetch(`${BASE}/v1/card?slug=${SLUG}`, { method: 'POST', headers: { ...H, 'Content-Type': 'image/jpeg' }, body: bytes });
console.log('   ->', res.status, (await res.text().catch(() => '')).slice(0, 120));

// Poll until the generation job finishes.
const t0 = Date.now(); let done = null;
while (Date.now() - t0 < 200000) {
  const c = await cardOf();
  if (c.job == null && c.state && (!before.state || c.state.version !== before.state.version)) { done = c; break; }
  if (c.job) process.stdout.write('.');
  await new Promise((z) => setTimeout(z, 4000));
}
console.log('\ncard after:', JSON.stringify(done || (await cardOf())));

// Download the generated card to eyeball.
const png = await fetch(`${BASE}/v1/cards/${SLUG}/card.png`);
if (png.ok) {
  const out = `/tmp/${SLUG}-card.png`;
  fs.writeFileSync(out, Buffer.from(await png.arrayBuffer()));
  console.log(`saved ${out} (HTTP ${png.status})`);
} else {
  console.log('card.png not ready:', png.status);
}
