import { connectCDP } from './lib/connect.js';

const { browser, page } = await connectCDP(9223);
const TITLE = 'ROBOT-WRITE-TEST-DELETE-ME';
const log = (...a) => console.log('[write-proof]', ...a);

// 1) CREATE via Calendar's template URL (title + exact time), then Save.
const url =
  'https://calendar.google.com/calendar/render?action=TEMPLATE' +
  `&text=${encodeURIComponent(TITLE)}` +
  '&dates=20260614T100000%2F20260614T103000';
log('opening prefilled event editor...');
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
await page.screenshot({ path: '/tmp/wp-1-editor.png' });

log('clicking Save...');
await page.getByRole('button', { name: /^save$/i }).first().click({ timeout: 10000 });
await page.waitForTimeout(4000);
await page.screenshot({ path: '/tmp/wp-2-after-save.png' });

// 2) VERIFY it exists on June 14.
log('verifying it exists on June 14...');
await page.goto('https://calendar.google.com/calendar/u/0/r/day/2026/6/14', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2800);
let existsBefore = await page.getByText(TITLE, { exact: false }).count();
log(`found ${existsBefore} chip(s) matching title`);
await page.screenshot({ path: '/tmp/wp-3-exists.png' });

if (!existsBefore) {
  log('CREATE FAILED — event not found. Stopping before delete.');
  await browser.close();
  process.exit(1);
}

// 3) DELETE it: open the event, click the trash/Delete control.
log('opening the event to delete it...');
await page.getByText(TITLE, { exact: false }).first().click({ timeout: 8000 });
await page.waitForTimeout(1800);
await page.screenshot({ path: '/tmp/wp-4-opened.png' });

log('clicking Delete...');
await page.getByRole('button', { name: /delete event/i }).first().click({ timeout: 8000 });
await page.waitForTimeout(3000);

// 4) VERIFY it's gone.
await page.goto('https://calendar.google.com/calendar/u/0/r/day/2026/6/14', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2800);
const existsAfter = await page.getByText(TITLE, { exact: false }).count();
await page.screenshot({ path: '/tmp/wp-5-after-delete.png' });

log('\n=========== RESULT ===========');
log('created & found:', existsBefore > 0 ? 'YES' : 'NO');
log('deleted & gone :', existsAfter === 0 ? 'YES' : `NO (still ${existsAfter} present)`);
log('round-trip write proof:', existsBefore > 0 && existsAfter === 0 ? '✅ PASS' : '❌ CHECK');

await browser.close();
