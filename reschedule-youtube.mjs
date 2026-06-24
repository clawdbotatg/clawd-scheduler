// Reschedule (or re-thumbnail) an ALREADY-scheduled YouTube broadcast — for when
// a guest moves the call (e.g. via Calendly) after it was first scheduled, or when
// a broadcast somehow got created without its episode card.
//
// fill-yt-schedule.js CREATES a new broadcast and is idempotent (skips if the
// @handle is already in Upcoming) — so it can NOT move an existing one. This edits
// the existing broadcast's edit page in place.
//
//   YT_HANDLE=0xzak YT_DATE='Jun 26, 2026' YT_TIME='10:30 AM' \
//     node reschedule-youtube.mjs [--submit] [--set-thumb]
//
// - YT_DATE/YT_TIME (optional): new schedule slot. Omit to only fix the thumbnail.
// - --set-thumb: (re)upload the episode card as the custom thumbnail (YT_THUMB or ep.card).
// - --submit: actually click Save. Without it: fills + reads back + screenshots, no Save.
// Runs against the 9224 Canary clone (YouTube). Find-by-@handle in the Upcoming list.
import { connectCDP } from './lib/connect.js';
import { episode, PORTS } from './lib/config.js';

const HANDLE = (process.env.YT_HANDLE || '').replace(/^@/, '');
if (!HANDLE) { console.error('set YT_HANDLE (and optionally YT_DATE "Mon DD, YYYY" + YT_TIME "H:MM AM")'); process.exit(1); }
const ep = episode(HANDLE);
const DATE = process.env.YT_DATE, TIME = process.env.YT_TIME;
const THUMB = process.env.YT_THUMB || ep.card;
const SUBMIT = process.argv.includes('--submit');
const SET_THUMB = process.argv.includes('--set-thumb');
if (!DATE !== !TIME) { console.error('YT_DATE and YT_TIME must be given together (or neither).'); process.exit(1); }

const { browser, page } = await connectCDP(PORTS.youtube);
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const shot = (n) => page.screenshot({ path: `/tmp/yt-resched-${n}.png` }).catch(() => {});

// 1) Find the broadcast in the Upcoming list by @handle → its video id.
await page.goto('https://studio.youtube.com/channel/UC/livestreaming', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
const href = await page.evaluate((h) => {
  for (const a of document.querySelectorAll('a#video-title, a[href*="/video/"]')) {
    if (new RegExp('@' + h + '\\b', 'i').test(a.textContent || '')) return a.getAttribute('href');
  }
  return null;
}, HANDLE);
const vid = href && href.match(/\/video\/([^/]+)/)?.[1];
if (!vid) { console.error(`✗ no Upcoming broadcast found for @${HANDLE} — nothing to reschedule.`); await browser.close(); process.exit(2); }
console.log(`broadcast: @${HANDLE} → ${vid}  ${DATE ? `→ ${DATE} ${TIME}` : '(no time change)'}  set-thumb=${SET_THUMB} submit=${SUBMIT}`);

await page.goto(`https://studio.youtube.com/video/${vid}/edit`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
await shot('1-open');

// 2) (optional) (re)upload the card as the custom thumbnail.
if (SET_THUMB) {
  const input = page.locator('ytcp-thumbnails-compact-editor input[type="file"]').first();
  await input.setInputFiles(THUMB);
  await page.waitForTimeout(5000);
  const ok = await page.locator('ytcp-thumbnails-compact-editor img, ytcp-still-cell img').count();
  if (!ok) { console.error('✗ thumbnail preview did not appear — NOT saving.'); await browser.close(); process.exit(3); }
  console.log('✓ thumbnail uploaded');
}

// 3) (optional) set the new date + time (same controls as the create wizard).
if (DATE) {
  await page.locator('ytcp-dropdown-trigger').filter({ hasText: /202\d/ }).first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1000);
  await page.evaluate((DATE) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    for (const inp of document.querySelectorAll('input')) {
      if (/[A-Z][a-z]{2}\s+\d{1,2},\s+202\d/.test(inp.value)) {
        setter.call(inp, DATE);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
  }, DATE);
  await page.keyboard.press('Enter').catch(() => {});
  await page.waitForTimeout(800);

  const timeRe = new RegExp('^' + TIME.replace(/\s+/g, '\\s?') + '$', 'i');
  const box = await page.evaluate(() => {
    for (const inp of document.querySelectorAll('input')) {
      if (/\d{1,2}:\d{2}\s?(AM|PM)/i.test(inp.value)) { const r = inp.getBoundingClientRect(); if (r.width > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    }
    return null;
  });
  if (!box) { console.error('✗ time input not found — NOT saving.'); await browser.close(); process.exit(3); }
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(900);
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.type(TIME, { delay: 35 });
  await page.waitForTimeout(1100);
  try { await page.locator('tp-yt-paper-item, [role="option"], paper-item, ytcp-text-menu-item').filter({ hasText: timeRe }).first().click({ timeout: 3000 }); }
  catch { await page.keyboard.press('Enter'); }
  await page.waitForTimeout(1000);
}
await shot('2-filled');

// 4) Read back and GUARD before saving.
const rb = await page.evaluate(() => {
  let d = '', t = '';
  for (const el of document.querySelectorAll('ytcp-dropdown-trigger')) { const s = (el.textContent || '').trim(); if (/202\d/.test(s)) d = s.replace(/\s+/g, ' '); }
  for (const inp of document.querySelectorAll('input')) { if (/\d{1,2}:\d{2}\s?(AM|PM)/i.test(inp.value)) t = inp.value; }
  return { d, t };
});
console.log('readback:', JSON.stringify(rb));
if (DATE) {
  const timeRe = new RegExp('^' + TIME.replace(/\s+/g, '\\s?') + '$', 'i');
  const dOk = new RegExp(DATE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(rb.d);
  const tOk = timeRe.test(rb.t.trim());
  if (!dOk || !tOk) { console.error(`✗ date/time did NOT take (date=${dOk} time=${tOk}) — NOT saving.`); await browser.close(); process.exit(3); }
}

if (!SUBMIT) { console.log('\nDRY RUN — filled but NOT saved (pass --submit to commit).'); await browser.close(); process.exit(0); }

let saved = false;
for (const _ of [0, 1]) {
  try { const s = page.locator('#save, ytcp-button#save').first(); if (await s.count()) { await s.click({ timeout: 8000 }); saved = true; break; } } catch {}
  try { await page.getByRole('button', { name: /^Save$/ }).first().click({ timeout: 8000 }); saved = true; break; } catch {}
  await page.waitForTimeout(1500);
}
await page.waitForTimeout(6000);
await shot('3-saved');

// verify on reload
await page.goto(`https://studio.youtube.com/video/${vid}/edit`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
const v = await page.evaluate(() => {
  let d = '', t = '';
  for (const el of document.querySelectorAll('ytcp-dropdown-trigger')) { const s = (el.textContent || '').trim(); if (/202\d/.test(s)) d = s.replace(/\s+/g, ' '); }
  for (const inp of document.querySelectorAll('input')) { if (/\d{1,2}:\d{2}\s?(AM|PM)/i.test(inp.value)) t = inp.value; }
  return { d, t };
});
console.log('clicked Save:', saved, '| VERIFY after reload:', JSON.stringify(v));
const okFinal = !DATE || (new RegExp(DATE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(v.d) && new RegExp('^' + TIME.replace(/\s+/g, '\\s?') + '$', 'i').test(v.t.trim()));
console.log(saved && okFinal ? 'RESCHEDULED ✅' : 'CHECK MANUALLY ⚠');
await browser.close();
