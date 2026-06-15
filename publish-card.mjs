// Step 10 (pure API, no browser): server-side bake + publish the unfurl, then
// download it. Replaces the disk-icon click. Token comes from step 6 (copy skill).
//   node publish-card.mjs <slug> <bearerToken> [outPath]
import fs from 'node:fs';

const BASE = 'https://live.slop.computer';
const slug = process.argv[2];
const token = process.argv[3];
const out = process.argv[4] || `/tmp/${slug}card.png`;
if (!slug || !token) { console.error('usage: node publish-card.mjs <slug> <bearerToken> [outPath]'); process.exit(1); }

const H = { Authorization: `Bearer ${token}` };

// 1) Server-side bake + publish (no client needed).
const res = await fetch(`${BASE}/v1/card/publish?slug=${slug}`, { method: 'POST', headers: H });
const body = await res.json().catch(() => ({}));
console.log('POST /v1/card/publish →', res.status, JSON.stringify(body));
if (!res.ok || !body.ok) { console.error('publish failed'); process.exit(1); }

// 2) Download the published unfurl image.
const png = await fetch(`${BASE}/v1/cards/${slug}/published.png?v=${Date.now()}`);
if (!png.ok) { console.error('download failed:', png.status); process.exit(1); }
const buf = Buffer.from(await png.arrayBuffer());
fs.writeFileSync(out, buf);
console.log(`saved ${out} (${buf.length} bytes) — unfurl ready for ${BASE}/${slug}`);
