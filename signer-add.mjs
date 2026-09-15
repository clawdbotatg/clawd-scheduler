// Queue an on-chain scheduling tx for the signer page (http://127.0.0.1:8790/).
//
//   node signer-add.mjs --slug asvanevik --datetime 2026-09-16T17:00 [--liveslug asvanevik] [--name asvanevik] [--open]
//   node signer-add.mjs --slug fucory-2 --datetime … --liveslug fucory        # returning guest
//   node signer-add.mjs --reschedule <slug> --datetime 2026-09-17T17:00 [--open] # delete + re-add (two signatures)
//   node signer-add.mjs --list | --remove <id> | --open
//
// IDEMPOTENT: an episode already on-chain at that datetime queues nothing; a
// pending item for the same slug is updated in place (never duplicated).
// --open brings the page up in Austin's real browser via the clawd-browser
// bridge (open/activate only — never navigates or drives his other tabs).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { REGISTRY, CHAIN_ID, validSlug, encodeAddEpisode, encodeDeleteEpisode, getEpisodeBySlug, denverToUnix, fmtDenver } from './lib/slop-registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUEUE = process.env.SIGNER_QUEUE || path.join(HERE, '.signer-queue.json');
const PORT = Number(process.env.SIGNER_PORT || 8790);
const URL_ = `http://127.0.0.1:${PORT}/`;
const BRIDGE = process.env.BRIDGE_URL || 'http://127.0.0.1:8765';
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const flag = (n) => argv.includes(`--${n}`);
const readQueue = () => { try { return JSON.parse(fs.readFileSync(QUEUE, 'utf8')); } catch { return { items: [] }; } };
const writeQueue = (q) => { fs.writeFileSync(QUEUE + '.tmp', JSON.stringify(q, null, 2) + '\n'); fs.renameSync(QUEUE + '.tmp', QUEUE); };
const die = (m, c = 1) => { console.error(`✗ ${m}`); process.exit(c); };
const active = (q) => q.items.filter((i) => i.status === 'pending' || i.status === 'sent');

async function bringUp() {
  const cmd = async (c, args = {}) => { const r = await (await fetch(`${BRIDGE}/cmd`, { method: 'POST', body: JSON.stringify({ cmd: c, args }) })).json(); if (!r.ok) throw new Error(`${c}: ${r.error}`); return r.result; };
  try {
    const t = await cmd('tabs'); const list = Array.isArray(t) ? t : t.tabs || [];
    let tab = list.find((x) => String(x.url || '').startsWith(URL_));
    if (!tab) { const o = await cmd('open', { url: URL_ }); tab = { tab_id: o.tab_id ?? o.id ?? o }; }
    await cmd('activate', { tab_id: tab.tab_id });
    console.log(`↗ signer page is up in Austin's browser (tab ${tab.tab_id})`);
  } catch (e) { console.log(`(could not bring the page up via the bridge: ${e.message} — send Austin ${URL_})`); }
}

if (flag('list')) {
  const q = readQueue();
  if (!q.items.length) console.log('(queue empty)');
  for (const i of q.items) console.log(`${i.status.padEnd(9)} ${i.id}  ${i.op.padEnd(6)} ${i.slug.padEnd(20)} ${i.unix ? fmtDenver(i.unix) : ''} ${i.txHash ? ' tx ' + i.txHash.slice(0, 12) + '…' : ''}${i.conflict ? '\n          ⚠ ' + i.conflict : ''}`);
  console.log(`\npage: ${URL_}`); process.exit(0);
}
if (arg('remove')) { const q = readQueue(); const n = q.items.length; q.items = q.items.filter((i) => i.id !== arg('remove')); if (q.items.length === n) die('no such id'); writeQueue(q); console.log('removed'); process.exit(0); }

const DT = arg('datetime');
const RESCHED = arg('reschedule');
const SLUG = RESCHED || arg('slug');
if (!SLUG) { if (flag('open')) { await bringUp(); process.exit(0); } die('need --slug <s> --datetime YYYY-MM-DDTHH:MM (or --list / --remove <id> / --open)'); }
if (!validSlug(SLUG)) die('slug must be [a-z0-9-]{1,64}');
if (!DT) die('need --datetime YYYY-MM-DDTHH:MM (Denver wall clock)');
const LIVE = arg('liveslug') || '';
if (LIVE && !validSlug(LIVE)) die('--liveslug must be [a-z0-9-]{1,64}');
const NAME = arg('name') || SLUG; // convention: name === slug
const unix = denverToUnix(DT);
console.log(`episode ${SLUG}${LIVE ? ` (live room ${LIVE})` : ''} @ ${fmtDenver(unix)}  (unix ${unix})`);

const ep = await getEpisodeBySlug(SLUG);
const q = readQueue();
q.items = q.items.filter((i) => !(i.slug === SLUG && i.status === 'pending')); // replace any pending item for this slug
const mk = (o) => ({ id: crypto.randomBytes(4).toString('hex'), status: 'pending', createdAt: Date.now(), chainId: CHAIN_ID, to: REGISTRY, ...o });

if (ep && ep.datetime === unix) { writeQueue(q); console.log(`✓ already on-chain at that time (id ${ep.id.slice(0, 10)}…) — nothing to sign.`); if (flag('open')) await bringUp(); process.exit(0); }
if (ep && !RESCHED) die(`slug "${SLUG}" is already on-chain at ${fmtDenver(ep.datetime)}. Use --reschedule ${SLUG} --datetime ${DT} (delete + re-add, two signatures) or a new slug (returning guest → ${SLUG}-2 --liveslug ${SLUG}).`, 2);
if (RESCHED && !ep) console.log('(nothing on-chain to delete — queuing a plain add)');

const items = [];
if (RESCHED && ep) items.push(mk({ op: 'delete', slug: SLUG, episodeId: ep.id, name: ep.name, unix: ep.datetime,
  label: `delete old "${ep.slug}" @ ${fmtDenver(ep.datetime)}`, data: encodeDeleteEpisode(ep.id) }));
items.push(mk({ op: 'add', slug: SLUG, liveSlug: RESCHED && ep ? ep.liveSlug : LIVE, name: RESCHED && ep ? ep.name : NAME, unix, datetime: DT,
  label: `schedule "${SLUG}" @ ${fmtDenver(unix)}`,
  data: encodeAddEpisode({ name: RESCHED && ep ? ep.name : NAME, slug: SLUG, liveSlug: RESCHED && ep ? ep.liveSlug : LIVE, manifest: RESCHED && ep ? ep.manifest : '', contractAddr: RESCHED && ep ? ep.contractAddr : undefined, unix }) }));
q.items.push(...items);
writeQueue(q);
for (const i of items) console.log(`+ queued ${i.op} ${i.id}: ${i.label}`);
const up = await fetch(`${URL_}api/health`).then((r) => r.ok).catch(() => false);
console.log(up ? `page: ${URL_}` : `⚠ signer server is not running — start it: bash signer-install.sh (or node signer-server.mjs)`);
console.log(`pending signatures: ${active(q).length}`);
if (flag('open')) await bringUp();
