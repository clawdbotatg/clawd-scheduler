#!/usr/bin/env node
// EMERGENCY one-off: create a START IMMEDIATELY broadcast on a source, because a
// scheduled broadcast failed to auto-start (2026-08-01 test: stuck SCHEDULED 12+ min
// past its start while the source was receiving). Reuses x-schedule.mjs field logic.
// Usage: X_TITLE='..' X_SOURCE='Slop.Computer(NEW)' X_POSTER=/tmp/x.png node go-live-now.mjs --submit
import { chromium } from 'playwright';

const TITLE = process.env.X_TITLE;
const SOURCE = process.env.X_SOURCE || 'Slop.Computer(NEW)';
const POSTER = process.env.X_POSTER || '';
const CATEGORY = process.env.X_CATEGORY || 'Technology';
const PORT = Number(process.env.SLOP_PORT_SOCIAL || 9223);
const SUBMIT = process.argv.includes('--submit');
if (!TITLE) { console.error('set X_TITLE'); process.exit(1); }
console.log(`GO LIVE NOW: ${TITLE}\n  source=${SOURCE} cat=${CATEGORY} poster=${POSTER || '(none)'} submit=${SUBMIT}`);

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx = browser.contexts()[0];
const pg = await ctx.newPage();
const park = async () => { await pg.goto('about:blank').catch(() => {}); await pg.close().catch(() => {}); };
await pg.goto('https://studio.x.com/producer', { waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(6000);
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

await pg.getByText('Create broadcast', { exact: true }).first().click({ timeout: 8000 });
await pg.waitForTimeout(3000);

const name = pg.getByPlaceholder('Untitled').first();
await name.click(); await name.fill(TITLE); console.log('✓ name');

const cat = pg.getByPlaceholder('Add Category').first();
await cat.click(); await pg.keyboard.press(`${MOD}+a`); await pg.keyboard.press('Delete');
await pg.keyboard.type(CATEGORY, { delay: 55 });
await pg.waitForTimeout(1800);
let catClicked = false;
const catOpt = pg.locator('[role=option],li,[role=menuitem]').filter({ hasText: new RegExp('^' + CATEGORY) }).first();
if (await catOpt.count().catch(() => 0)) await catOpt.click({ timeout: 4000 }).then(() => (catClicked = true)).catch(() => {});
if (!catClicked) { await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('Enter'); }
await pg.waitForTimeout(700); console.log('✓ category');

{
  const want = SOURCE.replace(/\s+/g, '').toLowerCase();
  let picked = null;
  for (const sel of await pg.$$('select')) {
    const labels = await sel.$$eval('option', (os) => os.map((o) => o.textContent.trim()));
    const hit = labels.find((l) => l.replace(/\s+/g, '').toLowerCase() === want);
    if (hit) { await sel.selectOption({ label: hit }); picked = hit; break; }
  }
  if (!picked) { console.error(`✗ source "${SOURCE}" not found`); await park(); await browser.close(); process.exit(1); }
  await pg.waitForTimeout(700); console.log(`✓ source (${picked})`);
}

// Schedule: leave the default "Start immediately" — do NOT click Start later.

if (POSTER) {
  const fi = pg.locator('input[type=file]').first();
  if (await fi.count()) { await fi.setInputFiles(POSTER); await pg.waitForTimeout(4000); console.log('✓ poster'); }
}

const state = await pg.evaluate(() => {
  const nm = document.querySelector('input')?.value;
  const src = [...document.querySelectorAll('select option:checked')].map((o) => o.textContent.trim());
  const imm = [...document.querySelectorAll('input[type=radio]')].filter((r) => r.checked).length;
  return { nm, src, imm, warn: /already in use|will be in use|overlap/i.test(document.body.innerText) };
});
console.log('FILLED:', JSON.stringify(state));
if (state.warn) console.log('⚠ overlap warning present on the form');

if (!SUBMIT) { console.log('\nstopped before create (pass --submit).'); await browser.close(); process.exit(0); }

await pg.getByText('Create broadcast', { exact: true }).last().click({ timeout: 8000 });
await pg.waitForTimeout(6000);
const after = await pg.locator('body').innerText().catch(() => '');
const err = after.match(/(error|invalid|in use|failed)[^\n]*/i);
console.log(err ? `⚠ page says: ${err[0]}` : '✓ clicked Create broadcast — check Producer list/details for LIVE state');
await park();
await browser.close();
