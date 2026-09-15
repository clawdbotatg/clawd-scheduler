// The slop signer page: http://127.0.0.1:8790/ — a local page Austin opens,
// connects Rainbow (slop.atg.eth) and signs whatever on-chain scheduling txs are
// queued. Claude fills the queue with `signer-add.mjs`; the page polls it, so a
// tab left open updates itself. Binds 127.0.0.1 ONLY, writes .signer.pid.
// Nothing here ever signs — the wallet does, in Austin's browser.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGISTRY, CHAIN_ID, OWNER_ENS, owner, getEpisodeBySlug, receipt, fmtDenver } from './lib/slop-registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SIGNER_PORT || 8790);
const QUEUE = process.env.SIGNER_QUEUE || path.join(HERE, '.signer-queue.json');
const PID = path.join(HERE, '.signer.pid');
const PAGE = path.join(HERE, 'signer', 'index.html');

export const readQueue = () => { try { return JSON.parse(fs.readFileSync(QUEUE, 'utf8')); } catch { return { items: [] }; } };
export const writeQueue = (q) => { const tmp = QUEUE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(q, null, 2) + '\n'); fs.renameSync(tmp, QUEUE); };

let ownerAddr = null, lastRefresh = 0;
async function refresh(force = false) {
  const q = readQueue();
  if (!force && Date.now() - lastRefresh < 10000) return q;
  lastRefresh = Date.now();
  if (!ownerAddr) ownerAddr = await owner().catch(() => null);
  let dirty = false;
  for (const it of q.items) {
    try {
      if (it.status === 'sent' && it.txHash) {
        const r = await receipt(it.txHash);
        if (r) { it.status = r.status === '0x1' ? 'confirmed' : 'failed'; it.block = parseInt(r.blockNumber, 16); it.confirmedAt = Date.now(); dirty = true; }
      }
      if (it.op === 'add' && it.status !== 'confirmed' && it.status !== 'dismissed') {
        const ep = await getEpisodeBySlug(it.slug);
        if (ep && ep.datetime === it.unix) { it.status = 'confirmed'; it.onchain = ep; it.confirmedAt = it.confirmedAt || Date.now(); dirty = true; }
        else if (ep && ep.datetime !== it.unix) { it.conflict = `slug already on-chain at ${fmtDenver(ep.datetime)} (id ${ep.id.slice(0, 10)}…) — needs a delete first`; it.onchainId = ep.id; dirty = true; }
        else if (it.conflict) { delete it.conflict; delete it.onchainId; dirty = true; }
      }
      if (it.op === 'delete' && it.status !== 'confirmed' && it.status !== 'dismissed') {
        const ep = await getEpisodeBySlug(it.slug);
        if (!ep || ep.id.toLowerCase() !== String(it.episodeId).toLowerCase()) { it.status = 'confirmed'; it.confirmedAt = it.confirmedAt || Date.now(); dirty = true; }
      }
    } catch (e) { it.lastError = String(e.message || e); }
  }
  if (dirty) writeQueue(q);
  return q;
}

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((ok) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e5) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(d || '{}')); } catch { ok({}); } }); });

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  try {
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(fs.readFileSync(PAGE));
    }
    if (req.method === 'GET' && u.pathname === '/api/health') return json(res, 200, { ok: true, port: PORT, pid: process.pid });
    if (req.method === 'GET' && u.pathname === '/api/queue') {
      const q = await refresh(u.searchParams.has('force'));
      return json(res, 200, { registry: REGISTRY, chainId: CHAIN_ID, owner: ownerAddr, ownerEns: OWNER_ENS, items: q.items, now: Date.now() });
    }
    let m;
    if (req.method === 'POST' && (m = u.pathname.match(/^\/api\/items\/([\w-]+)\/(sent|dismiss|reset)$/))) {
      const [, id, action] = m; const b = await body(req);
      const q = readQueue(); const it = q.items.find((x) => x.id === id);
      if (!it) return json(res, 404, { error: 'no such item' });
      if (action === 'sent') {
        if (!/^0x[0-9a-fA-F]{64}$/.test(b.txHash || '')) return json(res, 400, { error: 'txHash required' });
        it.txHash = b.txHash; it.from = b.from || null; it.status = 'sent'; it.sentAt = Date.now();
      } else if (action === 'dismiss') { it.status = 'dismissed'; it.dismissedAt = Date.now(); }
      else if (action === 'reset') { it.status = 'pending'; delete it.txHash; delete it.from; delete it.lastError; }
      writeQueue(q); lastRefresh = 0;
      return json(res, 200, { ok: true, item: it });
    }
    json(res, 404, { error: 'not found' });
  } catch (e) { json(res, 500, { error: String(e.message || e) }); }
});

server.listen(PORT, '127.0.0.1', () => {
  fs.writeFileSync(PID, String(process.pid));
  console.log(`slop signer: http://127.0.0.1:${PORT}/  (queue: ${path.basename(QUEUE)})`);
});
const bye = () => { try { if (fs.readFileSync(PID, 'utf8') === String(process.pid)) fs.unlinkSync(PID); } catch {} process.exit(0); };
process.on('SIGINT', bye); process.on('SIGTERM', bye);
