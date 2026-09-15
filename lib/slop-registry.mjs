// SlopComputer episode registry (Ethereum mainnet) — dependency-free ABI codec
// + JSON-RPC reads. Mirrors exactly what slop.computer/admin's "// schedule"
// form sends: addEpisode(name, slug, liveSlug, "", 0x0, unixSeconds).
// Selectors were computed with `cast sig` (see signer-probe.mjs, which
// cross-checks the encoder against cast's calldata).
import { execFileSync } from 'node:child_process';

export const CHAIN_ID = 1;
export const REGISTRY = '0xf3ce3614fe8cd4294a0bf05d10cfda9d9cbc4886';
export const OWNER_ENS = 'slop.atg.eth';
export const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
export const RPCS = (process.env.SLOP_RPCS || 'https://ethereum-rpc.publicnode.com,https://eth.drpc.org,https://rpc.flashbots.net').split(',');

const SEL = {
  addEpisode: '3f4df8f6',       // addEpisode(string,string,string,string,address,uint256)
  deleteEpisode: 'ab52e8e6',    // deleteEpisode(bytes32)
  slugToId: '2e078a98',         // slugToId(string)
  getEpisodeBySlug: '0f359d0f', // getEpisodeBySlug(string)
  owner: '8da5cb5b',
};

const hex = (buf) => Buffer.from(buf).toString('hex');
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const strWord = (s) => { const b = Buffer.from(s, 'utf8'); return word(b.length) + hex(b).padEnd(Math.ceil(b.length / 32) * 64, '0'); };
const addrWord = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');

// Generic encoder for a flat arg list of {t:'string'|'address'|'uint256'|'bytes32', v}.
export function encodeArgs(args) {
  const heads = [], tails = [];
  const headLen = args.length * 32;
  for (const a of args) {
    if (a.t === 'string') { heads.push(null); tails.push(strWord(a.v)); }
    else if (a.t === 'address') heads.push(addrWord(a.v));
    else if (a.t === 'uint256') heads.push(word(a.v));
    else if (a.t === 'bytes32') heads.push(a.v.replace(/^0x/, '').padStart(64, '0'));
    else throw new Error('unsupported type ' + a.t);
  }
  let off = headLen, ti = 0, out = '';
  for (let i = 0; i < args.length; i++) {
    if (heads[i] === null) { out += word(off); off += tails[ti++].length / 2; }
    else out += heads[i];
  }
  return out + tails.join('');
}

export const validSlug = (s) => /^[a-z0-9-]{1,64}$/.test(s);

export function encodeAddEpisode({ name, slug, liveSlug = '', manifest = '', contractAddr = ZERO_ADDR, unix }) {
  if (!validSlug(slug)) throw new Error(`slug must be [a-z0-9-]{1,64}: ${slug}`);
  if (liveSlug && !validSlug(liveSlug)) throw new Error(`liveSlug must be [a-z0-9-]{1,64}: ${liveSlug}`);
  if (!Number.isInteger(unix) || unix <= 0) throw new Error('unix must be a positive integer');
  return '0x' + SEL.addEpisode + encodeArgs([
    { t: 'string', v: name }, { t: 'string', v: slug }, { t: 'string', v: liveSlug },
    { t: 'string', v: manifest }, { t: 'address', v: contractAddr }, { t: 'uint256', v: unix },
  ]);
}
export const encodeDeleteEpisode = (id) => '0x' + SEL.deleteEpisode + encodeArgs([{ t: 'bytes32', v: id }]);
const encodeSlugToId = (slug) => '0x' + SEL.slugToId + encodeArgs([{ t: 'string', v: slug }]);
const encodeGetEpisodeBySlug = (slug) => '0x' + SEL.getEpisodeBySlug + encodeArgs([{ t: 'string', v: slug }]);

// ---- JSON-RPC (first RPC that answers wins) ----
export async function rpc(method, params) {
  let lastErr;
  for (const url of RPCS) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 12000);
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ctl.signal }).finally(() => clearTimeout(t));
      const j = await r.json();
      if (j.error) { const e = new Error(j.error.message || 'rpc error'); e.rpcError = j.error; throw e; }
      return j.result;
    } catch (e) { lastErr = e; if (e.rpcError) throw e; /* revert: don't retry elsewhere */ }
  }
  throw lastErr || new Error('no rpc answered');
}
const call = (data) => rpc('eth_call', [{ to: REGISTRY, data }, 'latest']);

function decodeString(ret, off) { // ret = hex without 0x, off = byte offset of the string head
  const len = parseInt(ret.slice(off * 2, off * 2 + 64), 16);
  return Buffer.from(ret.slice(off * 2 + 64, off * 2 + 64 + len * 2), 'hex').toString('utf8');
}
// (bytes32 id, string name, string slug, string liveSlug, string manifest, address contractAddr, uint256 datetime)
export function decodeEpisode(retHex) {
  const ret = retHex.replace(/^0x/, '');
  const base = parseInt(ret.slice(0, 64), 16); // offset of the tuple
  const w = (i) => ret.slice((base + i * 32) * 2, (base + i * 32) * 2 + 64);
  const str = (i) => decodeString(ret, base + parseInt(w(i), 16));
  return { id: '0x' + w(0), name: str(1), slug: str(2), liveSlug: str(3), manifest: str(4),
    contractAddr: '0x' + w(5).slice(24), datetime: parseInt(w(6), 16) };
}

export async function slugToId(slug) { const r = await call(encodeSlugToId(slug)); return r && r !== '0x' ? r : null; }
export const isZeroId = (id) => !id || /^0x0{64}$/.test(id);
export async function getEpisodeBySlug(slug) {
  const id = await slugToId(slug);
  if (isZeroId(id)) return null;
  return decodeEpisode(await call(encodeGetEpisodeBySlug(slug)));
}
export async function owner() { const r = await call('0x' + SEL.owner); return '0x' + r.slice(-40); }
export const receipt = (hash) => rpc('eth_getTransactionReceipt', [hash]);

// ---- Denver wall-clock → unix seconds (DST-correct) ----
export function denverToUnix(dt, tz = process.env.SLOP_TZ || 'America/Denver') {
  const m = String(dt).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) throw new Error('datetime must be YYYY-MM-DDTHH:MM (Denver wall clock)');
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asUTC = Date.UTC(y, mo - 1, d, h, mi);
  const offAt = (ms) => { // minutes that tz is ahead of UTC at instant ms
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
    return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - ms) / 60000;
  };
  let guess = asUTC - offAt(asUTC) * 60000; guess = asUTC - offAt(guess) * 60000; // second pass fixes DST edges
  return Math.floor(guess / 1000);
}
export const fmtDenver = (unix, tz = process.env.SLOP_TZ || 'America/Denver') =>
  new Date(unix * 1000).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

// Optional cross-check against foundry's cast when it is installed (probe only).
export function castCalldata(sig, ...args) {
  try { return execFileSync('/opt/homebrew/bin/cast', ['calldata', sig, ...args], { encoding: 'utf8' }).trim(); } catch { return null; }
}
