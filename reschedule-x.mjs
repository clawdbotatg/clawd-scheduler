// Reschedule an ALREADY-scheduled X/Twitter livestream — counterpart to
// reschedule-youtube.mjs, for when a guest moves the call after it was scheduled.
//
// x-schedule.mjs CREATES a broadcast and is idempotent (skips if already scheduled)
// — so it can NOT move an existing one. This edits the existing broadcast in place.
//
//   X_HANDLE=0xzak X_DATE='Jun 26, 2026' X_TIME='10:30 AM' X_DURATION_MIN=60 \
//     node reschedule-x.mjs [--submit]
// Without --submit: fills + reads back + screenshots, does NOT Save.
//
// ☠️ X gotchas baked in (learned the hard way):
//  1. The END datetime is LOCKED to the START's day — you must move the START first,
//     otherwise the end calendar won't offer the new day.
//  2. After editing a datetime, a picker popup stays open and X shows a transient
//     "End time must be after start time" error; you MUST close the popup (click a
//     neutral heading) so validation re-runs before Save.
//  3. NEVER click Cancel / press Escape on an X broadcast form — it DELETES the
//     broadcast. We only ever click Save (and bail without saving on any mismatch).
// Runs against the 9223 Chrome clone (the user's X login).
import { connectCDP } from './lib/connect.js';
import { episode, PORTS } from './lib/config.js';

const HANDLE = (process.env.X_HANDLE || '').replace(/^@/, '');
const DATE = process.env.X_DATE, TIME = process.env.X_TIME;
if (!HANDLE || !DATE || !TIME) { console.error('set X_HANDLE, X_DATE ("Mon DD, YYYY"), X_TIME ("H:MM AM")'); process.exit(1); }
const ep = episode(HANDLE);
const DURATION_MIN = Number(process.env.X_DURATION_MIN || 60);
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
// X's TimePicker wants the widget's own lowercase, no-space format ("10:30am").
const xtime = (t) => t.replace(/\s+/g, '').toLowerCase();
const START = xtime(TIME), END = xtime(addMinutes(TIME, DURATION_MIN));
// expected button text, e.g. "6/26/26, 10:30 AM"
const btnTime = (t) => t.replace(/(am|pm)/i, (x) => ' ' + x.toUpperCase());

const { browser, page: pg } = await connectCDP(PORTS.social);
const shot = (n) => pg.screenshot({ path: `/tmp/x-resched-${n}.png` }).catch(() => {});

// 1) Find the broadcast in the producer list by @handle and open it.
await pg.goto('https://studio.x.com/producer', { waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(8000);
const opened = await pg.evaluate((h) => {
  const cand = [...document.querySelectorAll('div,span,a,td,tr')].find((e) => new RegExp('@' + h + '\\b', 'i').test(e.innerText || '') && (e.innerText || '').length < 160);
  if (!cand) return false;
  let s = cand;
  for (let i = 0; i < 6 && s; i++) { if (s.getAttribute && (s.getAttribute('role') === 'row' || s.tagName === 'TR' || s.getAttribute('role') === 'button' || s.tagName === 'A')) break; s = s.parentElement; }
  (s || cand).click();
  return true;
}, HANDLE);
if (!opened) { console.error(`✗ no scheduled X broadcast found for @${HANDLE}.`); await browser.close(); process.exit(2); }
await pg.waitForTimeout(5000);
const bid = pg.url().match(/broadcasts\/([^/?]+)/)?.[1];
if (!bid) { console.error('✗ did not land on a broadcast edit page.'); await browser.close(); process.exit(2); }
console.log(`broadcast: @${HANDLE} → ${bid}  → ${MON} ${DAY}, ${YEAR} ${TIME}–${addMinutes(TIME, DURATION_MIN)} (${DURATION_MIN}min)  submit=${SUBMIT}`);
await shot('1-open');

const dt = () => pg.locator('button').filter({ hasText: /\d{1,2}\/\d{1,2}\/\d{2},\s*\d{1,2}:\d{2}/ });
async function curMonthYear() {
  return await pg.evaluate(() => {
    const sels = [...document.querySelectorAll('select')];
    const mSel = sels.find((s) => [...s.options].some((o) => /^[A-Z][a-z]{2}$/.test(o.textContent.trim())));
    const ySel = sels.find((s) => [...s.options].every((o) => /^\d{4}$/.test(o.textContent.trim())) && s.options.length);
    return { m: mSel?.value || mSel?.selectedOptions?.[0]?.textContent?.trim() || '', y: ySel?.value || ySel?.selectedOptions?.[0]?.textContent?.trim() || '' };
  });
}
async function setDateTime(idx, label, time) {
  await dt().nth(idx).click({ timeout: 5000 });
  await pg.waitForTimeout(1200);
  // Month/year nav via the picker's next/prev chevrons (changing the <select>s
  // closes the popup on this edit page). Best-effort; the pre-Save guard is the
  // real safety net, so a missed month aborts rather than mis-saves.
  for (let i = 0; i < 24; i++) {
    const cur = await curMonthYear();
    if ((cur.m === MON || cur.m === '') && (String(cur.y) === YEAR || cur.y === '')) break;
    const goNext = (Number(cur.y) < Number(YEAR)) || (Number(cur.y) === Number(YEAR) && monthIdx(cur.m) < monthIdx(MON));
    const moved = await pg.evaluate((next) => {
      const chevs = [...document.querySelectorAll('button,[role="button"],a,span,svg')].filter((e) => {
        const t = (e.getAttribute('aria-label') || e.textContent || '').toLowerCase();
        return /(next|previous|prev)\s*month/.test(t) || (e.children.length === 0 && /^[‹›◀▶<>]$/.test((e.textContent || '').trim()));
      });
      const pick = chevs.find((e) => next ? /next|›|▶|>/.test((e.getAttribute('aria-label') || e.textContent || '').toLowerCase()) : /prev|‹|◀|</.test((e.getAttribute('aria-label') || e.textContent || '').toLowerCase()));
      if (pick) { pick.click(); return true; }
      return false;
    }, goNext);
    if (!moved) break;
    await pg.waitForTimeout(500);
  }
  await pg.locator('.Calendar-day.is-selectable').filter({ hasText: new RegExp('^' + Number(DAY) + '$') }).first().click({ timeout: 5000 });
  await pg.waitForTimeout(600);
  const tp = pg.locator('input.TimePicker').first();
  await tp.click(); await pg.keyboard.press('Meta+a'); await tp.fill(time); await pg.keyboard.press('Enter');
  await pg.waitForTimeout(1000);
  console.log(`set ${label} -> ${MON} ${DAY} ${time}`);
}
function monthIdx(m) { return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m); }

// START first (END is locked to start's day), then END.
await setDateTime(0, 'start', START);
await setDateTime(1, 'end', END);

// Close the picker popup via a SAFE neutral heading (never Cancel/Escape) so the
// "End time must be after start time" transient clears and validation re-runs.
await pg.locator('text=Poster image').first().click({ timeout: 4000 }).catch(() => {});
await pg.waitForTimeout(1500);
await shot('2-settled');

const diag = await pg.evaluate(() => {
  const flat = document.body.innerText.replace(/\s+/g, ' ');
  const err = /End time must be after start time/i.test(flat);
  const dtBtns = [...document.querySelectorAll('button')].map((b) => (b.innerText || '').replace(/\s+/g, ' ').trim()).filter((t) => /\d{1,2}\/\d{1,2}\/\d{2},\s*\d{1,2}:\d{2}/.test(t));
  const save = [...document.querySelectorAll('button')].find((x) => /^Save$/i.test((x.innerText || '').trim()));
  return { err, dtBtns, saveDisabled: save ? !!save.disabled : null };
});
console.log('DIAG:', JSON.stringify(diag));

// GUARD: both datetime buttons must show the target day+time and there must be no error.
const okStart = diag.dtBtns.some((t) => new RegExp(`/${Number(DAY)}/${YEAR.slice(2)},\\s*${btnTime(START).trim()}`, 'i').test(t));
const okEnd = diag.dtBtns.some((t) => new RegExp(`/${Number(DAY)}/${YEAR.slice(2)},\\s*${btnTime(END).trim()}`, 'i').test(t));
if (!okStart || !okEnd || diag.err) { console.error(`✗ not saving — start=${okStart} end=${okEnd} err=${diag.err}. (No Cancel/Escape — leaving as-is.)`); await browser.close(); process.exit(3); }

if (!SUBMIT) { console.log('\nDRY RUN — filled + validated but NOT saved (pass --submit to commit).'); await browser.close(); process.exit(0); }

const saved = await pg.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /^Save$/i.test((x.innerText || '').trim()) && !x.disabled);
  if (b) { b.click(); return true; }
  return false;
});
await pg.waitForTimeout(6000);
await shot('3-saved');

await pg.goto('https://studio.x.com/producer', { waitUntil: 'domcontentloaded' });
await pg.waitForTimeout(8000);
const flat = ((await pg.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
const onTarget = new RegExp(`@${HANDLE}[\\s\\S]{0,90}${MON} ${Number(DAY)}, ${YEAR}`, 'i').test(flat);
console.log('clicked Save:', saved, '| list shows', `${MON} ${Number(DAY)}, ${YEAR}`, 'near @' + HANDLE + ':', onTarget);
await shot('4-verify');
console.log(saved && onTarget ? 'RESCHEDULED ✅' : 'CHECK MANUALLY ⚠');
await browser.close();
