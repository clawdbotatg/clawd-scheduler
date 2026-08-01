#!/usr/bin/env node
// EXPERIMENT: does X Producer auto-start a scheduled broadcast at its start time?
// Creates a PRIVATE scheduled broadcast (invisible to the public, not postable) on a
// source, then optionally watches the Producer list across the start time and logs
// every state transition. Zero public footprint.
//
//   X_DATE='Aug 1, 2026' X_TIME='11:35 AM' X_SOURCE='Slop.Computer(NEW)' \
//     node private-autostart-test.mjs --submit --watch
//
// Context: 2026-08-01 — scheduled public broadcast sat SCHEDULED 12+ min past start
// with a healthy feed. History: Jul 28/29 fired on time, Jul 30 fired 11 min late,
// Jul 31 never fired (stuck entry still in the list). This script measures today.
import { chromium } from 'playwright';

const DATE = process.env.X_DATE, TIME = process.env.X_TIME;
const SOURCE = process.env.X_SOURCE || 'Slop.Computer(NEW)';
const CATEGORY = process.env.X_CATEGORY || 'Technology';
const DURATION_MIN = Number(process.env.X_DURATION_MIN || 10);
const TITLE = process.env.X_TITLE || `AUTOSTART TEST (private) ${TIME}`;
const PORT = Number(process.env.SLOP_PORT_SOCIAL || 9223);
const SUBMIT = process.argv.includes('--submit');
const WATCH = process.argv.includes('--watch');
const WATCH_PAST_MIN = Number(process.env.WATCH_PAST_MIN || 6);
if (!DATE || !TIME) { console.error(`set X_DATE ("Mon DD, YYYY") and X_TIME ("H:MM AM")`); process.exit(1); }

const dm = DATE.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s+(\d{4})$/);
if (!dm) { console.error(`bad X_DATE "${DATE}"`); process.exit(1); }
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
const toMin = (t) => { const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i); return ((Number(m[1]) % 12) + (/pm/i.test(m[3]) ? 12 : 0)) * 60 + Number(m[2]); };
console.log(`PRIVATE autostart test: ${TITLE}\n  ${MON} ${DAY}, ${YEAR}  ${TIME}–${END_TIME}  source=${SOURCE}  submit=${SUBMIT} watch=${WATCH}`);

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx = browser.contexts()[0];
const pg = await ctx.newPage();
const park = async () => { await pg.goto('about:blank').catch(() => {}); await pg.close().catch(() => {}); };
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
await pg.goto('https://studio.x.com/producer', { waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(6000);

if (SUBMIT) {
  await pg.getByText('Create broadcast', { exact: true }).first().click({ timeout: 8000 });
  await pg.waitForTimeout(3000);

  const name = pg.getByPlaceholder('Untitled').first();
  await name.click(); await name.fill(TITLE); console.log('✓ name');

  const cat = pg.getByPlaceholder('Add Category').first();
  await cat.click(); await pg.keyboard.press(`${MOD}+a`); await pg.keyboard.press('Delete');
  await pg.keyboard.type(CATEGORY, { delay: 55 });
  await pg.waitForTimeout(1800);
  const catOpt = pg.locator('[role=option],li,[role=menuitem]').filter({ hasText: new RegExp('^' + CATEGORY) }).first();
  if (await catOpt.count().catch(() => 0)) await catOpt.click({ timeout: 4000 }).catch(() => {});
  else { await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('Enter'); }
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

  // PRIVATE audience — the whole point: no public footprint.
  const priv = pg.locator('label,div').filter({ hasText: /^Private \(Only I can see this broadcast\)$/ }).locator('input[type=radio]').first();
  if (await priv.count().catch(() => 0)) await priv.click({ force: true }).catch(() => {});
  else await pg.getByText('Private (Only I can see this broadcast)', { exact: true }).first().click({ timeout: 4000 });
  await pg.waitForTimeout(500);
  const privChecked = await pg.evaluate(() => [...document.querySelectorAll('input[type=radio]')].some((r) => r.checked && /Private/.test(r.closest('label')?.innerText || r.parentElement?.innerText || '')));
  if (!privChecked) { console.error('✗ could not select Private audience — refusing to create a public test'); await park(); await browser.close(); process.exit(1); }
  console.log('✓ audience: PRIVATE');

  await pg.getByText('Start later', { exact: true }).first().click({ timeout: 5000 });
  await pg.waitForTimeout(1500);
  const dt = () => pg.locator('button').filter({ hasText: /\d{1,2}\/\d{1,2}\/\d{2},\s*\d{1,2}:\d{2}/ });
  async function setDateTime(idx, label, time) {
    await dt().nth(idx).click({ timeout: 5000 }); await pg.waitForTimeout(1000);
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

  // dismiss the date/time picker popup — left open it overlays the footer and
  // swallows the Create click (that's what silently ate the first two attempts).
  // NO Escape here — Escape can cancel the whole create dialog; click a neutral
  // field instead.
  await pg.getByPlaceholder('Untitled').first().click().catch(() => {});
  await pg.waitForTimeout(800);
  const pickerOpen = await pg.locator('.Calendar-day').count().catch(() => 0);
  console.log(`picker dismissed: ${pickerOpen === 0}`);

  // is the rig actually pushing? the form preview shows the source feed
  await pg.waitForTimeout(3000);
  const feed = await pg.evaluate(() => ({
    video: !!document.querySelector('video'),
    waiting: /waiting for stream/i.test(document.body.innerText),
  }));
  console.log(`feed check: video=${feed.video} waitingForStream=${feed.waiting}`);
  await pg.screenshot({ path: '/tmp/x-autostart-form.png' });

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
  await pg.screenshot({ path: '/tmp/x-after-create.png' });
  const postClick = await pg.evaluate(() => {
    const dlgOpen = !!document.querySelector('input[placeholder="Untitled"]');
    const err = (document.body.innerText.match(/[^\n]*(error|invalid|failed|cannot|unable|required)[^\n]*/i) || [])[0] || '';
    return { dlgOpen, err: err.slice(0, 200) };
  });
  console.log('post-click:', JSON.stringify(postClick));
  await pg.goto('https://studio.x.com/producer', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(7000);
  const body = (await pg.locator('body').innerText().catch(() => '')) || '';
  console.log(body.includes(TITLE) ? `CREATED ✅ — in the Producer list` : '⚠ not found in Producer list after create');
}

if (WATCH) {
  const deadline = toMin(TIME) + WATCH_PAST_MIN;
  let last = '';
  console.log(`watching until ${WATCH_PAST_MIN} min past ${TIME} (poll ~20s)…`);
  for (;;) {
    const nowM = (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })();
    await pg.goto('https://studio.x.com/producer', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await pg.waitForTimeout(6000);
    const t = (await pg.locator('body').innerText().catch(() => '')) || '';
    const row = (() => {
      const i = t.indexOf(TITLE); if (i < 0) return 'GONE from list';
      const before = t.slice(Math.max(0, i - 260), i);
      const m = before.match(/(LIVE|SCHEDULED|ENDED|TIMED OUT)(?![\s\S]*(LIVE|SCHEDULED|ENDED|TIMED OUT))/);
      return m ? m[1] : 'status?';
    })();
    const stamp = new Date().toLocaleTimeString();
    if (row !== last) { console.log(`[${stamp}] ${row}`); last = row; }
    if (/LIVE|TIMED OUT|ENDED/.test(row)) { console.log(`RESULT: ${row} at ${stamp}`); break; }
    if (nowM > deadline) { console.log(`RESULT: still "${row}" at ${stamp} — ${WATCH_PAST_MIN} min past scheduled start. AUTO-START DID NOT FIRE.`); break; }
    await pg.waitForTimeout(14000);
  }
}

await park();
await browser.close();
