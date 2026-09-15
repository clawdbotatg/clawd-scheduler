// Headless end-to-end probe of the signer page with a FAKE wallet (no real
// wallet, no real tx, isolated queue + port). Run: node signer-probe.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { REGISTRY, encodeAddEpisode, denverToUnix, owner, castCalldata, ZERO_ADDR } from './lib/slop-registry.mjs';

const PORT = 8799, URL_ = `http://127.0.0.1:${PORT}/`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'signer-probe-'));
const env = { ...process.env, SIGNER_PORT: String(PORT), SIGNER_QUEUE: path.join(tmp, 'queue.json') };
const fails = []; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails.push(m); };
const sh = (args) => new Promise((r) => { const p = spawn(process.execPath, args, { env }); let out = ''; p.stdout.on('data', (d) => out += d); p.stderr.on('data', (d) => out += d); p.on('exit', (code) => r({ code, out })); });
const api = async (p, opt) => (await fetch(URL_ + 'api/' + p, opt)).json();

const OWNER = await owner();
const server = spawn(process.execPath, ['signer-server.mjs'], { env, stdio: 'ignore' });
try {
  for (let i = 0; i < 50 && !(await fetch(URL_ + 'api/health').then((r) => r.ok).catch(() => false)); i++) await new Promise((r) => setTimeout(r, 100));
  ok(true, 'server up on ' + URL_);

  // 1) encoder vs cast (skipped when cast is missing)
  const unix = denverToUnix('2026-09-16T17:00');
  const cd = castCalldata('addEpisode(string,string,string,string,address,uint256)', 'probe-slug', 'probe-slug', '', '', ZERO_ADDR, String(unix));
  if (cd) ok(cd === encodeAddEpisode({ name: 'probe-slug', slug: 'probe-slug', unix }), 'encoder matches cast calldata');

  // 2) enqueue is idempotent
  let r = await sh(['signer-add.mjs', '--slug', 'probe-slug-zz', '--datetime', '2026-09-16T17:00']);
  ok(r.code === 0 && /queued add/.test(r.out), 'signer-add queues a fresh slug');
  r = await sh(['signer-add.mjs', '--slug', 'probe-slug-zz', '--datetime', '2026-09-16T18:00']);
  let q = await api('queue');
  ok(q.items.filter((i) => i.slug === 'probe-slug-zz' && i.status === 'pending').length === 1, 're-queue replaces the pending item (no duplicate)');
  ok(q.items[0].unix === denverToUnix('2026-09-16T18:00'), 'replacement carries the new time');
  r = await sh(['signer-add.mjs', '--slug', 'austingriffith', '--datetime', '2026-09-14T12:00']);
  ok(r.code === 0 && /already on-chain/.test(r.out), 'already-on-chain episode queues nothing');
  r = await sh(['signer-add.mjs', '--slug', 'austingriffith', '--datetime', '2026-09-14T13:00']);
  ok(r.code === 2, 'taken slug at another time is refused without --reschedule');
  r = await sh(['signer-add.mjs', '--reschedule', 'austingriffith', '--datetime', '2026-09-14T13:00']);
  q = await api('queue?force=1');
  const del = q.items.find((i) => i.op === 'delete' && i.slug === 'austingriffith'); const add = q.items.find((i) => i.op === 'add' && i.slug === 'austingriffith');
  ok(del && add, '--reschedule queues delete + add');
  ok(add && add.conflict, 'the re-add is marked conflicting until the delete lands');

  // 3) the page with a fake Rainbow provider
  const browser = await chromium.launch({ channel: 'chrome' }); // the installed Google Chrome, not playwright's download
  const ctx = await browser.newContext();
  await ctx.addInitScript(({ OWNER }) => {
    window.__sent = []; window.__acct = OWNER;
    const L = {}; const provider = { isRainbow: true, on(ev, fn) { (L[ev] ||= []).push(fn); }, emit(ev, a) { (L[ev] || []).forEach((f) => f(a)); }, request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [window.__acct];
      if (method === 'eth_chainId') return '0x1';
      if (method === 'wallet_switchEthereumChain') return null;
      if (method === 'eth_sendTransaction') { window.__sent.push(params[0]); return '0x' + 'ab'.repeat(32); }
      throw new Error('unexpected ' + method);
    } };
    window.__fake = provider; const detail = Object.freeze({ info: { uuid: 'fake-rainbow', name: 'Rainbow', icon: 'data:image/svg+xml,', rdns: 'me.rainbow' }, provider });
    const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
    window.addEventListener('eip6963:requestProvider', announce); announce();
  }, { OWNER });
  const page = await ctx.newPage();
  await page.goto(URL_); await page.waitForTimeout(800);
  ok(await page.locator('.item').count() >= 3, 'page lists the queued items');
  ok(await page.locator('button.sign').first().isDisabled(), 'SIGN disabled before connect');
  await page.click('#connect'); await page.waitForTimeout(500);
  ok((await page.locator('#wallet').innerText()).includes('slop.atg.eth ✓'), 'connected as the owner');
  const probeItem = page.locator('.item', { hasText: 'probe-slug-zz' });
  ok(await probeItem.locator('button.sign').isEnabled(), 'SIGN enabled for the plain add');
  ok(await page.locator('.item', { hasText: 'schedule "austingriffith"' }).locator('button.sign').isDisabled(), 'conflicting re-add stays disabled');
  await probeItem.locator('button.sign').click(); await page.waitForTimeout(800);
  const sent = await page.evaluate(() => window.__sent);
  ok(sent.length === 1 && sent[0].to === REGISTRY && sent[0].from === OWNER, 'wallet got one tx to the registry from the owner');
  ok(sent[0].data === encodeAddEpisode({ name: 'probe-slug-zz', slug: 'probe-slug-zz', unix: denverToUnix('2026-09-16T18:00') }), 'tx calldata is the exact addEpisode encoding');
  q = await api('queue');
  const it = q.items.find((i) => i.slug === 'probe-slug-zz');
  ok(it.status === 'sent' && it.txHash === '0x' + 'ab'.repeat(32), 'server recorded the tx hash as sent');
  ok((await probeItem.innerText()).includes('waiting for the block'), 'page shows the sent state');
  // wrong account → cannot sign
  await page.evaluate(() => { window.__fake.emit('accountsChanged', ['0x000000000000000000000000000000000000dEaD']); }); await page.waitForTimeout(300);
  ok((await page.locator('#wallet').innerText()).includes('NOT the registry owner'), 'non-owner account is flagged');
  ok(await page.locator('.item', { hasText: 'delete old' }).locator('button.sign').isDisabled(), 'SIGN disabled for a non-owner');
  await browser.close();
} finally {
  server.kill('SIGTERM'); fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(fails.length ? `\n✗ ${fails.length} failure(s)` : '\n✓ signer probe green');
process.exit(fails.length ? 1 : 0);
