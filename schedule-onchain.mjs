// FINAL pipeline step: register the episode on-chain via slop.computer/admin.
// IDEMPOTENT — checks slop.computer/ first; if the slug already shows there
// (scheduled), it SKIPS (never double-schedules). Otherwise it fills the
// SCHEDULE form's datetime and, with --submit, clicks "SCHEDULE EPISODE" which
// pops a WALLET TRANSACTION that the USER signs. This script NEVER signs and
// never touches the wallet password — it stops at the tx prompt.
//   X_HANDLE=adrianleb ONCHAIN_DATE='Jun 15, 2026' ONCHAIN_TIME='9:00 AM' \
//     node schedule-onchain.mjs [--submit]
// Runs against the 9223 clone (Chrome with austingriffith.eth wallet connected).
import { chromium } from 'playwright';
import { episode } from './lib/config.js';

const ep = episode(process.env.X_HANDLE || process.env.ONCHAIN_HANDLE || 'adrianleb');
const DATE = process.env.ONCHAIN_DATE || process.env.X_DATE || 'Jun 15, 2026';
const TIME = process.env.ONCHAIN_TIME || process.env.X_TIME || '9:00 AM';
const PORT = Number(process.env.SLOP_PORT_SOCIAL || 9223);
const SUBMIT = process.argv.includes('--submit');

// "Jun 15, 2026" + "9:00 AM" -> "2026-06-15T09:00" (datetime-local value)
const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const dm = DATE.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s+(\d{4})$/);
const tm = TIME.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
if (!dm || !tm) { console.error('bad date/time'); process.exit(1); }
const h24 = (Number(tm[1]) % 12) + (/pm/i.test(tm[3]) ? 12 : 0);
const DTLOCAL = `${dm[3]}-${MONTHS[dm[1]]}-${String(dm[2]).padStart(2, '0')}T${String(h24).padStart(2, '0')}:${tm[2]}`;
console.log(`on-chain schedule: ${ep.slug} @ ${DTLOCAL}  submit=${SUBMIT}`);

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx = browser.contexts()[0];
// Open a fresh page (reliable; shares the wallet session in this context) —
// reusing a stale tab from manual admin actions caused "Frame detached".
const pg = await ctx.newPage();

// 1) IDEMPOTENCY: is the slug already scheduled (shows on slop.computer/)?
await pg.goto('https://slop.computer/', { waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(6000);
const home = (await pg.locator('body').innerText().catch(() => '')) || '';
const already = new RegExp(ep.slug.replace(/-/g, '[- ]?'), 'i').test(home);
if (already) {
  console.log(`✓ ${ep.slug} ALREADY scheduled on slop.computer — SKIP (no duplicate).`);
  await pg.screenshot({ path: '/tmp/onchain.png' });
  await browser.close();
  process.exit(0);
}

// 2) Not scheduled — open the schedule form and fill the SCHEDULE-section datetime.
await pg.goto(`https://slop.computer/admin?liveSlugToSchedule=${ep.slug}`, { waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(7000);
// Mark the SCHEDULE-section datetime-local (the one near the SCHEDULE EPISODE
// button), then fill it with Playwright — reliable on React inputs (the raw
// value-setter did NOT stick, and was also missing its arg).
const marked = await pg.evaluate(() => {
  const btn = [...document.querySelectorAll('button,[role=button]')].find((b) => /SCHEDULE EPISODE/i.test(b.innerText || ''));
  if (!btn) return false;
  let s = btn;
  for (let i = 0; i < 6 && s; i++) { const dtl = s.querySelector?.('input[type="datetime-local"]'); if (dtl) { dtl.setAttribute('data-sched-dt', '1'); return true; } s = s.parentElement; }
  return false;
});
if (!marked) { console.log('✗ no datetime-local in the SCHEDULE section.'); await browser.close(); process.exit(2); }
await pg.locator('[data-sched-dt]').fill(DTLOCAL).catch(() => {});
await pg.waitForTimeout(600);
const val = await pg.locator('[data-sched-dt]').inputValue().catch(() => '');
console.log('datetime field value:', JSON.stringify(val), '(want', DTLOCAL + ')');
await pg.screenshot({ path: '/tmp/onchain.png' });

if (!SUBMIT) { console.log('\nstopped before SCHEDULE EPISODE (pass --submit). Review the form.'); await browser.close(); process.exit(0); }
// HARD GUARD: never trigger the wallet tx unless the datetime actually took.
if (val !== DTLOCAL) { console.log(`✗ datetime did NOT set (got "${val}", want "${DTLOCAL}") — NOT clicking SCHEDULE EPISODE (no tx).`); await browser.close(); process.exit(3); }

// 3) Click SCHEDULE EPISODE → wallet tx pops up for the USER to sign. We DO NOT sign.
await pg.getByRole('button', { name: /SCHEDULE EPISODE/i }).first().click({ timeout: 6000 });
await pg.waitForTimeout(3000);
await pg.screenshot({ path: '/tmp/onchain.png' });
console.log('\n🖊️  Clicked SCHEDULE EPISODE — a wallet transaction should now be up in your browser. SIGN IT to finish (I do not sign). Then it will appear on slop.computer/.');
await browser.close();
