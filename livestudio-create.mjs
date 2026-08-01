#!/usr/bin/env node
// Create a livestream NATIVELY in Live Studio (studio.x.com/live) — the tool X
// says replaces Producer ("Scheduled livestreams require a source created in
// Live Studio"). Producer-created broadcasts stopped auto-starting 2026-07-31.
//
// Flow (recon 2026-08-01): New Livestream → modal "Create Livestream" with tabs
// Details / Thumbnail / (Date & Time when "Later") / Audience. Details = title +
// source combobox (green dot = feed connected). Date & Time = date + time text
// fields + MDT tz + an Auto-start TOGGLE (default ON). Footer button = Schedule.
//
//   X_TITLE='LIVESTUDIO TEST 1:20 PM' X_TIME='1:20 PM' X_DATE='Aug 1, 2026' \
//     node livestudio-create.mjs --submit
//
// Without --submit: fills everything, screenshots, does NOT click Schedule.
import { chromium } from 'playwright';

const TITLE = process.env.X_TITLE;
const TIME = process.env.X_TIME;   // "H:MM AM"
const DATE = process.env.X_DATE;   // "Mon DD, YYYY" — must match the field format "Aug 1, 2026"
const SOURCE = process.env.X_SOURCE || 'Slop.Computer(NEW)';
const PORT = Number(process.env.SLOP_PORT_SOCIAL || 9223);
const SUBMIT = process.argv.includes('--submit');
if (!TITLE || !TIME || !DATE) { console.error('set X_TITLE, X_TIME ("H:MM AM"), X_DATE ("Mon DD, YYYY")'); process.exit(1); }
// the form renders time as zero-padded "01:20 PM"
const tm = TIME.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
if (!tm) { console.error(`bad X_TIME "${TIME}"`); process.exit(1); }
const TIME_FMT = `${String(tm[1]).padStart(2, '0')}:${tm[2]} ${tm[3].toUpperCase()}`;

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const ctx = browser.contexts()[0];
const pg = await ctx.newPage();
const park = async () => { await pg.goto('about:blank').catch(() => {}); await pg.close().catch(() => {}); await browser.close(); };
const shot = (n) => pg.screenshot({ path: `/tmp/ls-${n}.png` }).catch(() => {});
const die = async (msg, code = 1) => { console.log(msg); await shot('die'); await park(); process.exit(code); };
const until = async (fn, arg, label, tries = 20) => {
  for (let i = 0; i < tries; i++) { if (await pg.evaluate(fn, arg)) return true; await pg.waitForTimeout(1500); }
  await die(`✗ timeout waiting for: ${label}`);
};
const clickText = (txt) => pg.evaluate((txt) => {
  const e = [...document.querySelectorAll('button,a,div[role=button],[role=tab]')].find((e) => e.innerText.trim() === txt && e.getBoundingClientRect().width > 0);
  if (e) { e.click(); return true; } return false;
}, txt);

console.log(`Live Studio create: "${TITLE}"  ${DATE} ${TIME_FMT}  source=${SOURCE}  submit=${SUBMIT}`);
await pg.goto('https://studio.x.com/live', { waitUntil: 'domcontentloaded' });
await until(() => [...document.querySelectorAll('button,a,div[role=button]')].some((e) => /new livestream/i.test(e.innerText) && e.getBoundingClientRect().width > 0), null, 'Live Studio list');
await clickText('New Livestream');
await until(() => document.body.innerText.includes('Create Livestream'), null, 'create modal');
await pg.waitForTimeout(1200);

// -- Details: title (pre-fills with the LAST stream's title — overwrite) + source
const name = pg.getByPlaceholder('Enter a title...').first();
await name.click(); await pg.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a'); await pg.keyboard.press('Delete');
await name.fill(TITLE);
console.log('✓ title');

const srcOk = await pg.evaluate((want) => {
  const cb = [...document.querySelectorAll('[role=combobox]')].find((e) => e.getBoundingClientRect().width > 0);
  return cb ? cb.innerText.replace(/\s+/g, '') === want.replace(/\s+/g, '') : false;
}, SOURCE);
if (!srcOk) {
  // open the combobox and pick the source by exact label
  await pg.evaluate(() => [...document.querySelectorAll('[role=combobox]')].find((e) => e.getBoundingClientRect().width > 0)?.click());
  await pg.waitForTimeout(1200);
  const picked = await pg.evaluate((want) => {
    const o = [...document.querySelectorAll('[role=option],li,div')].find((e) => e.children.length <= 2 && e.textContent.replace(/\s+/g, '') === want.replace(/\s+/g, '') && e.getBoundingClientRect().width > 0);
    if (o) { o.click(); return true; } return false;
  }, SOURCE);
  if (!picked) await die(`✗ source "${SOURCE}" not selectable`);
}
console.log(`✓ source (${SOURCE})`);

// -- Later → Date & Time tab
await clickText('Later');
await until(() => [...document.querySelectorAll('[role=tab],button,div')].some((e) => e.innerText.trim() === 'Date & Time' && e.getBoundingClientRect().width > 0), null, 'Date & Time tab');
await clickText('Date & Time');
await pg.waitForTimeout(1500);

// DOM reality (probed 2026-08-01): the date is a styled DIV showing "Aug 1, 2026"
// (picked via the year calendar); the time is TWO inline text inputs (hour "01",
// minute "15") plus an AM/PM segment. Defaults = today + now-rounded, PM as apt.
// Date: verify-only for now — same-day is the test case; a future date needs a
// calendar-cell click (the panel shows the full year; day cells are clickable).
const dateShown = await pg.evaluate(() => {
  const e = [...document.querySelectorAll('div,span,button')].find((e) => e.children.length <= 1 && /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test((e.textContent || '').trim()) && e.getBoundingClientRect().width > 0);
  return e ? e.textContent.trim() : null;
});
if (dateShown !== DATE) {
  // click the target day in the year calendar (month header + day cell)
  const picked = await pg.evaluate((DATE) => {
    const [mon, dayRaw] = DATE.replace(',', '').split(' ');
    const day = String(Number(dayRaw));
    const months = { Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June', Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December' };
    const hdr = [...document.querySelectorAll('div,span,h3,h4')].find((e) => e.children.length === 0 && e.textContent.trim() === months[mon] && e.getBoundingClientRect().width > 0);
    if (!hdr) return 'no-month';
    const grid = hdr.closest('div')?.parentElement || hdr.parentElement;
    const cell = [...grid.querySelectorAll('button,div,span')].filter((e) => e.children.length === 0 && e.textContent.trim() === day).map((e) => ({ e, r: e.getBoundingClientRect() })).filter((x) => x.r.width > 0).sort((a, b) => a.r.top - b.r.top)[0];
    if (!cell) return 'no-day';
    cell.e.click(); return 'ok';
  }, DATE);
  if (picked !== 'ok') await die(`✗ date: shown "${dateShown}", wanted "${DATE}" — calendar pick failed (${picked})`);
  await pg.waitForTimeout(1000);
  const now = await pg.evaluate(() => [...document.querySelectorAll('div,span,button')].find((e) => e.children.length <= 1 && /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test((e.textContent || '').trim()) && e.getBoundingClientRect().width > 0)?.textContent.trim());
  if (now !== DATE) await die(`✗ date readback "${now}" ≠ "${DATE}"`);
}
console.log(`✓ date = ${DATE}`);

// time: hour + minute inputs
const [, hh, mm, ap] = TIME_FMT.match(/^(\d{2}):(\d{2}) (AM|PM)$/);
const timeOk = await pg.evaluate(() => [...document.querySelectorAll('input[type=text]')].filter((i) => i.getBoundingClientRect().width > 0 && /^\d{1,2}$/.test(i.value)).length >= 2);
if (!timeOk) await die('✗ hour/minute inputs not found');
const setSeg = async (idx, val, label) => {
  const seg = pg.locator('input[type=text]').filter({ has: pg.locator(':scope') });
  const el = await pg.evaluateHandle((idx) => [...document.querySelectorAll('input[type=text]')].filter((i) => i.getBoundingClientRect().width > 0 && /^\d{1,2}$/.test(i.value))[idx], idx);
  await el.asElement().click({ clickCount: 3 });
  await pg.keyboard.type(val, { delay: 80 });
  await pg.waitForTimeout(400);
  const got = await pg.evaluate((idx) => [...document.querySelectorAll('input[type=text]')].filter((i) => i.getBoundingClientRect().width > 0 && /^\d{1,2}$/.test(i.value))[idx]?.value, idx);
  if (got !== val) await die(`✗ ${label} readback "${got}" ≠ "${val}"`);
  console.log(`✓ ${label} = ${val}`);
};
await setSeg(0, hh, 'hour');
await setSeg(1, mm, 'minute');
// AM/PM: verify the segment shows what we want; toggle by clicking it if not
const apShown = await pg.evaluate(() => {
  const e = [...document.querySelectorAll('button,div,span,select')].find((e) => e.children.length <= 1 && /^(AM|PM)$/.test((e.textContent || e.value || '').trim()) && e.getBoundingClientRect().width > 0);
  return e ? (e.textContent || e.value).trim() : null;
});
if (apShown !== ap) {
  await pg.evaluate(() => [...document.querySelectorAll('button,div,span')].find((e) => e.children.length <= 1 && /^(AM|PM)$/.test((e.textContent || '').trim()) && e.getBoundingClientRect().width > 0)?.click());
  await pg.waitForTimeout(800);
  const now = await pg.evaluate(() => [...document.querySelectorAll('button,div,span,select')].find((e) => e.children.length <= 1 && /^(AM|PM)$/.test((e.textContent || e.value || '').trim()) && e.getBoundingClientRect().width > 0)?.textContent.trim());
  if (now !== ap) await die(`✗ AM/PM stuck at "${now}", wanted "${ap}"`);
}
console.log(`✓ ${ap}`);

// Auto-start toggle must be ON
const auto = await pg.evaluate(() => {
  const row = [...document.querySelectorAll('div,label')].find((e) => /auto-?start/i.test(e.innerText) && e.innerText.trim().length < 30 && e.getBoundingClientRect().width > 0);
  const sw = row?.querySelector('[role=switch],input[type=checkbox]') || [...document.querySelectorAll('[role=switch]')].find((s) => s.getBoundingClientRect().width > 0);
  if (!sw) return 'missing';
  const on = (sw.getAttribute('aria-checked') ?? String(sw.checked)) === 'true';
  if (!on) { sw.click(); return 'turned-on'; }
  return 'on';
});
if (auto === 'missing') await die('✗ Auto-start toggle not found');
console.log(`✓ Auto-start: ${auto}`);

// -- final readback gate before Schedule (never fire with wrong datetime)
const readback = await pg.evaluate(() => {
  const dateEl = [...document.querySelectorAll('div,span,button')].find((e) => e.children.length <= 1 && /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test((e.textContent || '').trim()) && e.getBoundingClientRect().width > 0);
  const segs = [...document.querySelectorAll('input[type=text]')].filter((i) => i.getBoundingClientRect().width > 0 && /^\d{1,2}$/.test(i.value)).map((i) => i.value);
  const apEl = [...document.querySelectorAll('button,div,span')].find((e) => e.children.length <= 1 && /^(AM|PM)$/.test((e.textContent || '').trim()) && e.getBoundingClientRect().width > 0);
  return { date: dateEl?.textContent.trim(), time: segs.join(':') + ' ' + (apEl?.textContent.trim() || '?') };
});
console.log(`readback: ${JSON.stringify(readback)}`);
if (readback.date !== DATE || readback.time !== `${hh}:${mm} ${ap}`) await die(`✗ readback gate failed — refusing to Schedule`);
await shot('pre-schedule');

if (!SUBMIT) { console.log('(dry run — NOT clicking Schedule; see /tmp/ls-pre-schedule.png)'); await park(); process.exit(0); }

// the red Schedule button isn't a plain <button> — match ANY visible element with
// that exact text and click the innermost/smallest one
const scheduled = await pg.evaluate(() => {
  const cands = [...document.querySelectorAll('*')]
    .filter((e) => (e.textContent || '').trim() === 'Schedule')
    .map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter((x) => x.r.width > 0 && x.r.height > 0)
    .sort((a, b) => a.r.width * a.r.height - b.r.width * b.r.height);
  if (!cands.length) return false;
  const t = cands[0];
  const clickable = t.e.closest('button,[role=button],a') || t.e;
  clickable.click();
  return true;
});
if (!scheduled) await die('✗ Schedule button not found');
await pg.waitForTimeout(4000);
await shot('post-schedule');
const post = await pg.evaluate(() => {
  const modal = document.body.innerText.includes('Create Livestream');
  const err = (document.body.innerText.match(/[^\n]*(error|invalid|failed|cannot|unable|conflict)[^\n]*/i) || [])[0] || '';
  return { modalStillOpen: modal, err: err.slice(0, 200) };
});
console.log('post-click:', JSON.stringify(post));

// verify it landed in the list
await pg.goto('https://studio.x.com/live', { waitUntil: 'domcontentloaded' });
await until((t) => document.body.innerText.includes(t), TITLE, 'new livestream in list', 15);
console.log(`CREATED ✅ — "${TITLE}" is in the Live Studio list`);
await shot('list-after');
await park();
