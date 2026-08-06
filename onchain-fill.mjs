// clawd-heart's on-chain step: fill the slop.computer/admin SCHEDULE form in
// Austin's REAL browser (via the clawd-browser bridge, http://127.0.0.1:8765)
// and STOP — Austin presses SCHEDULE EPISODE and signs in Rainbow himself.
// His click pops the wallet instantly; automated clicks route through stale
// connectors and hang (the 2026-08-05 MetaMask-void lesson). So: FILL ONLY.
//
//   node onchain-fill.mjs --slug shawmakesmagic --datetime 2026-08-05T16:00
//
// IDEMPOTENT: skips if the slug is already in the admin page's episodes list.
// Pre-req: a slop.computer/admin tab open + Rainbow connected (slop.atg.eth).
// Never navigates or reloads the tab (that disconnects RainbowKit).

const BRIDGE = 'http://127.0.0.1:8765';
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const SLUG = arg('slug');
const DT = arg('datetime');
if (!SLUG || !/^[a-z0-9-]{1,64}$/.test(SLUG)) { console.error('need --slug (lowercase [a-z0-9-])'); process.exit(1); }
if (!DT || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(DT)) { console.error('need --datetime YYYY-MM-DDTHH:MM (local)'); process.exit(1); }

const cmd = async (c, args = {}) => {
  const r = await (await fetch(`${BRIDGE}/cmd`, { method: 'POST', body: JSON.stringify({ cmd: c, args }) })).json();
  if (!r.ok) throw new Error(`${c}: ${r.error}`);
  return r.result;
};

// 1) Find the admin tab (never open/navigate one — wallet connect is manual).
const tabs = await cmd('tabs');
const list = Array.isArray(tabs) ? tabs : tabs.tabs || [];
const tab = list.find((t) => /slop\.computer\/admin/.test(t.url || ''));
if (!tab) { console.error('✗ no slop.computer/admin tab open. Ask Austin to open it and connect Rainbow (slop.atg.eth), then re-run.'); process.exit(2); }
const tab_id = tab.tab_id;
console.log(`admin tab: ${tab_id} (${tab.url})`);

// 2) Gate + idempotency in one read.
const state = await cmd('eval', { tab_id, code: `(()=>{const t=document.body.innerText;
  return { gated:/sign in with the wallet/i.test(t),
           listed:new RegExp('\\\\n'+${JSON.stringify(SLUG)}+'\\\\n').test(t),
           form:/SCHEDULE EPISODE/i.test(t) }})()` });
if (state.value.listed) { console.log(`✓ ${SLUG} already in the episodes list — SKIP (no duplicate).`); process.exit(0); }
if (state.value.gated || !state.value.form) { console.error('✗ wallet gate is up (or form not rendered). Ask Austin to click Connect Wallet → Rainbow, then re-run. (A reload always drops the connection.)'); process.exit(3); }

// 3) Fill NAME / SLUG / DATETIME (React-safe native setter). LIVE SLUG stays
//    empty = reuse slug. Name convention: name === slug (all 37 episodes).
const fill = await cmd('eval', { tab_id, code: `(()=>{
  const btn=[...document.querySelectorAll('button,[role=button]')].find(b=>/SCHEDULE EPISODE/i.test(b.innerText||''));
  let s=btn,sec=null; for(let i=0;i<6&&s;i++){ if(s.querySelector?.('input[type=datetime-local]')){sec=s;break;} s=s.parentElement;}
  if(!sec) return {err:'no datetime-local near SCHEDULE EPISODE'};
  const ins=[...sec.querySelectorAll('input')];
  const set=(el,v)=>{const st=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    st.call(el,v); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));};
  set(ins[0],${JSON.stringify(SLUG)}); set(ins[1],${JSON.stringify(SLUG)}); set(ins[3],${JSON.stringify(DT)});
  return {vals:ins.map(i=>i.value)}})()` });
if (fill.value.err) { console.error(`✗ ${fill.value.err}`); process.exit(4); }

// 4) HARD GUARD: read back and require an exact match before handing to Austin.
const want = [SLUG, SLUG, '', DT].join('|');
const got = (fill.value.vals || []).join('|');
if (got !== want) { console.error(`✗ fill did not stick (got "${got}", want "${want}") — fix before anyone clicks.`); process.exit(5); }
console.log(`✓ form filled + verified: name=${SLUG} slug=${SLUG} liveslug=(reuse) datetime=${DT}`);
console.log('\n👉 Austin: press SCHEDULE EPISODE and sign in Rainbow. (This script never clicks.)');
