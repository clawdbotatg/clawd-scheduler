// Schedule the X (Twitter) Media Studio livestream for a slop episode — the X
// counterpart of fill-yt-schedule.js. Fills the "Create broadcast" form and,
// with --submit, creates it. Per-episode inputs come from env so the orchestrator
// can drive it; sensible defaults = adrianleb.
//   X_HANDLE=adrianleb X_DATE='Jun 15, 2026' X_TIME='9:00 AM' X_DURATION_MIN=70 \
//     node x-schedule.mjs [--submit]
//
// CRITICAL X gotcha: clicking "Create broadcast" creates+persists the broadcast
// immediately; the panel that opens after is for OPTIONAL extra settings and its
// Cancel/Escape DELETES the broadcast. To finish we NAVIGATE AWAY (reload), never
// Cancel. Verified by re-reading the Scheduled list after reload.
//
// Runs against the 9223 clone (Chrome: ethereum.org Google + the user's X login).
// Tested headed; for unattended runs launch 9223 headless (UA-spoofed) first.
import { chromium } from 'playwright';
import { episode } from './lib/config.js';

const ep = episode(process.env.X_HANDLE || 'adrianleb');
const TITLE = process.env.X_TITLE || ep.title;
const POSTER = process.env.X_POSTER || ep.card;          // /tmp/<slug>card.png
const SOURCE = process.env.X_SOURCE || 'Slop.Computer';   // X media-studio source name
const CATEGORY = process.env.X_CATEGORY || 'Technology';
const DATE = process.env.X_DATE || 'Jun 15, 2026';        // "Mon DD, YYYY"
const TIME = process.env.X_TIME || '9:00 AM';
const DURATION_MIN = Number(process.env.X_DURATION_MIN || 70);
const PORT = Number(process.env.SLOP_PORT_SOCIAL || 9223);
const SUBMIT = process.argv.includes('--submit');

const dm = DATE.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s+(\d{4})$/);
if (!dm) { console.error(`bad X_DATE "${DATE}" — want "Mon DD, YYYY"`); process.exit(1); }
const [, MON, DAY, YEAR] = dm;
const addMinutes = (t, mins) => {
  const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  let total = ((Number(m[1]) % 12) + (/pm/i.test(m[3]) ? 12 : 0)) * 60 + Number(m[2]) + mins;
  total = ((total % 1440) + 1440) % 1440;
  let hh = Math.floor(total / 60); const mm = total % 60;
  const ap = hh >= 12 ? 'PM' : 'AM'; let h12 = hh % 12; if (h12 === 0) h12 = 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ap}`;
};
const END_TIME = addMinutes(TIME, DURATION_MIN);
console.log(`X broadcast: ${TITLE}\n  ${MON} ${DAY}, ${YEAR}  ${TIME}–${END_TIME} (${DURATION_MIN}min)  source=${SOURCE} cat=${CATEGORY}\n  poster=${POSTER}  submit=${SUBMIT}`);

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx = browser.contexts()[0];
let pg = ctx.pages().find((p) => /studio\.x\.com/.test(p.url())) || ctx.pages()[0] || (await ctx.newPage());
await pg.goto('https://studio.x.com/producer', { waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(6000);
await pg.bringToFront();
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

// IDEMPOTENCY: skip if this episode is already in the scheduled list (same @handle + date).
{
  const list = (await pg.locator('body').innerText().catch(() => '')) || '';
  const monthDay = DATE.replace(/,\s*\d{4}$/, ''); // "Jun 15, 2026" -> "Jun 15"
  if (new RegExp(`@${ep.handle}\\b`, 'i').test(list) && list.includes(monthDay)) {
    console.log(`✓ X/Twitter: "@${ep.handle}" broadcast already scheduled on ${monthDay} — SKIP (no duplicate).`);
    await browser.close();
    process.exit(0);
  }
}

// open a fresh Create broadcast form
await pg.getByText('Create broadcast', { exact: true }).first().click({ timeout: 8000 });
await pg.waitForTimeout(3000);

// name
const name = pg.getByPlaceholder('Untitled').first();
await name.click(); await name.fill(TITLE); console.log('✓ name');

// category (typeahead; keyboard fallback)
const cat = pg.getByPlaceholder('Add Category').first();
await cat.click(); await pg.keyboard.press(`${MOD}+a`); await pg.keyboard.press('Delete');
await pg.keyboard.type(CATEGORY, { delay: 55 });
await pg.waitForTimeout(1800);
let catClicked = false;
const catOpt = pg.locator('[role=option],li,[role=menuitem]').filter({ hasText: new RegExp('^' + CATEGORY) }).first();
if (await catOpt.count().catch(() => 0)) await catOpt.click({ timeout: 4000 }).then(() => (catClicked = true)).catch(() => {});
if (!catClicked) { await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('Enter'); }
await pg.waitForTimeout(700); console.log('✓ category');

// source via the underlying native <select>
for (const sel of await pg.$$('select')) {
  const labels = await sel.$$eval('option', (os) => os.map((o) => o.textContent.trim()));
  if (labels.includes(SOURCE)) { await sel.selectOption({ label: SOURCE }); break; }
}
await pg.waitForTimeout(700); console.log('✓ source');

// schedule → Start later
await pg.getByText('Start later', { exact: true }).first().click({ timeout: 5000 });
await pg.waitForTimeout(1500);

const dt = () => pg.locator('button').filter({ hasText: /\d{1,2}\/\d{1,2}\/\d{2},\s*\d{1,2}:\d{2}/ });
async function setDateTime(idx, label, time) {
  await dt().nth(idx).click({ timeout: 5000 }); await pg.waitForTimeout(1000);
  // best-effort month/year via the picker's selects (robust across months), then click the day
  for (const sel of await pg.$$('select')) {
    const opts = await sel.$$eval('option', (os) => os.map((o) => o.textContent.trim()));
    if (opts.includes(MON) && opts.some((o) => /^[A-Z][a-z]{2}$/.test(o))) await sel.selectOption({ label: MON }).catch(() => {});
    else if (opts.includes(YEAR) && opts.every((o) => /^\d{4}$/.test(o))) await sel.selectOption({ label: YEAR }).catch(() => {});
  }
  await pg.waitForTimeout(500);
  await pg.locator('.Calendar-day.is-selectable').filter({ hasText: new RegExp('^' + Number(DAY) + '$') }).first().click({ timeout: 5000 });
  await pg.waitForTimeout(500);
  const tp = pg.locator('input.TimePicker').first();
  await tp.click(); await tp.fill(time); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(800); console.log(`✓ ${label}`);
}
await setDateTime(0, 'starts', TIME);
await setDateTime(1, 'ends', END_TIME);

// poster image
const fi = pg.locator('input[type=file]').first();
if (await fi.count()) { await fi.setInputFiles(POSTER); await pg.waitForTimeout(4000); console.log('✓ poster'); }

// readback
const state = await pg.evaluate(() => {
  const nm = document.querySelector('input[placeholder="Untitled"]')?.value || '';
  const c = [...document.querySelectorAll('*')].some((e) => (e.innerText || '').replace(/[​\s]/g, '') !== '' && /^Technology$/.test((e.innerText || '').replace(/[​\s]/g, '')) && e.children.length <= 1);
  const src = [...document.querySelectorAll('button')].some((e) => /Slop\.Computer/.test(e.innerText || ''));
  const times = [...new Set([...document.querySelectorAll('button')].map((e) => (e.innerText || '').trim()).filter((t) => /\d\/\d{1,2}\/\d{2},/.test(t)))];
  const poster = [...document.querySelectorAll('img')].some((i) => /blob:|amplify|pbs\.twimg/.test(i.src));
  return { nm, c, src, times, poster };
});
console.log('FILLED:', JSON.stringify(state));
await pg.screenshot({ path: '/tmp/x-state.png' });

if (!SUBMIT) { console.log('\nstopped before create (pass --submit). Navigate away or Cancel to discard this draft form.'); await browser.close(); process.exit(0); }

// --- SUBMIT: click footer "Create broadcast", then NAVIGATE AWAY to persist ---
const created = await pg.evaluate(() => {
  const cancel = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Cancel');
  let s = cancel?.parentElement;
  for (let i = 0; i < 4 && s; i++) {
    const c = [...s.querySelectorAll('button')].find((b) => /^Create broadcast$/i.test(b.innerText.trim()));
    if (c && c !== cancel) { c.click(); return true; }
    s = s.parentElement;
  }
  return false;
});
console.log('clicked Create broadcast:', created);
await pg.waitForTimeout(6000);
// persist by navigating away (NOT Cancel/Escape — those delete the broadcast)
await pg.goto('https://studio.x.com/producer', { waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(7000);
const body = (await pg.locator('body').innerText().catch(() => '')) || '';
const persisted = new RegExp(TITLE.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(body) && body.includes(`${MON} ${Number(DAY)}`);
console.log(persisted ? `\nSCHEDULED ✅ — ${TITLE} on ${MON} ${DAY} ${TIME}–${END_TIME}` : '\n⚠ could not confirm in Scheduled list — check manually');
await pg.screenshot({ path: '/tmp/x-state.png' });
await browser.close();
