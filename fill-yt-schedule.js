import { connectCDP } from './lib/connect.js';
import { episode, fetchSocialsDesc, PORTS } from './lib/config.js';

// Fill the YouTube "Create stream" wizard. Per-episode inputs come from env so
// the orchestrator (slop-episode.mjs) can drive it; sensible defaults = port.
//   YT_HANDLE=port_dev YT_DATE='Jun 18, 2026' YT_TIME='9:30 AM' \
//     node fill-yt-schedule.js [--submit]
// Without --submit it fills every field and STOPS before "Done" (review gate).
const SUBMIT = process.argv.includes('--submit');
const DATE = process.env.YT_DATE, TIME = process.env.YT_TIME;
if (!process.env.YT_HANDLE || !DATE || !TIME) { console.error('set YT_HANDLE, YT_DATE ("Mon DD, YYYY"), YT_TIME ("H:MM AM")'); process.exit(1); }
const ep = episode(process.env.YT_HANDLE);
const HANDLE = ep.handle;
const SLUG = ep.slug;
const TITLE = ep.title;
const THUMB = process.env.YT_THUMB || ep.card;
const PLAYLIST = process.env.YT_PLAYLIST || 'Slop.Computer';

const DESC = await fetchSocialsDesc(SLUG);
// Empty desc = wrong/missing SLOP_TOKEN for THIS room (per-room token) — refuse
// rather than schedule a blank-description broadcast (happened 2026-07-09).
if (!DESC.trim()) { console.error('✗ empty description from fetchSocialsDesc — is SLOP_TOKEN the right per-room token?'); process.exit(1); }
console.log('description:', DESC.slice(0, 60), '…');
console.log(`episode: ${TITLE}\n  date=${DATE} time=${TIME} thumb=${THUMB} submit=${SUBMIT}`);

// keepPage on the review path: without --submit the wizard is left open on purpose.
const { browser, page } = await connectCDP(PORTS.youtube, { keepPage: !SUBMIT });
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const step = async (label, fn) => {
  try { await fn(); console.log('✓', label); } catch (e) { console.log('✗', label, '—', e.message.split('\n')[0]); }
  await page.screenshot({ path: '/tmp/slop-live.png' }).catch(() => {}); // live watch feed
};

await page.goto('https://studio.youtube.com/channel/UC/livestreaming', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4500);

// IDEMPOTENCY: skip if this episode is already in the Upcoming list (same @handle + date).
{
  const list = (await page.locator('body').innerText().catch(() => '')) || '';
  const monthDay = DATE.replace(/,\s*\d{4}$/, ''); // "Jun 15, 2026" -> "Jun 15"
  if (new RegExp(`@${HANDLE}\\b`, 'i').test(list) && list.includes(monthDay)) {
    console.log(`✓ YouTube: "@${HANDLE}" broadcast already scheduled on ${monthDay} — SKIP (no duplicate).`);
    await browser.close();
    process.exit(0);
  }
}

await page.getByText('Schedule Stream', { exact: false }).first().click({ timeout: 12000 });
await page.waitForTimeout(3000);
await page.getByRole('button', { name: /create new/i }).click({ timeout: 12000 });
await page.waitForTimeout(4000);

// ---- DETAILS ----
await step('title', async () => {
  const t = page.locator('div[role="textbox"][aria-label^="Add a title"]');
  await t.click();
  await t.fill(TITLE);
  await page.keyboard.press('Escape'); // dismiss @-mention popup
  await page.waitForTimeout(400);
});
await step('description', async () => {
  const d = page.locator('div[role="textbox"][aria-label^="Tell viewers"]');
  await d.click();
  await d.fill(DESC);
  await page.keyboard.press('Escape'); // dismiss @-mention popup
  await page.waitForTimeout(400);
});
await step('made-for-kids = No', async () => {
  await page.locator('tp-yt-paper-radio-button').filter({ hasText: "No, it's not made for kids" }).click({ timeout: 8000 });
});
await step('show more', async () => {
  const sm = page.getByText('Show more', { exact: true }).first();
  await sm.scrollIntoViewIfNeeded();
  await sm.click({ timeout: 6000 });
  await page.waitForTimeout(1500);
});
await step('thumbnail upload', async () => {
  // the thumbnail uploader's own file input (revealed by Show more)
  const input = page.locator('ytcp-thumbnails-compact-editor input[type="file"]').first();
  await input.setInputFiles(THUMB);
  await page.waitForTimeout(4000);
  const ok = await page.locator('ytcp-thumbnails-compact-editor img, ytcp-still-cell img').count();
  if (!ok) throw new Error('no thumbnail preview appeared');
});
await step('playlist', async () => {
  const trig = page.locator('[aria-label="Select playlists"]').first();
  await trig.waitFor({ state: 'visible', timeout: 10000 });
  await trig.scrollIntoViewIfNeeded();
  await trig.click();
  await page.waitForTimeout(2000);
  const opt = page.getByText(/^Slop\.Computer$/).first();
  await opt.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
  await opt.click({ timeout: 4000 }).catch(() => page.getByText(PLAYLIST, { exact: false }).first().click({ timeout: 4000 }));
  await page.waitForTimeout(700);
  await page.getByText('Done', { exact: true }).first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(800);
});
await step('category → Science & Technology', async () => {
  // Dismiss any leftover popup (e.g. the playlist dropdown) that intercepts clicks.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  // Open via coordinate-click (the reliable method), retrying until the menu
  // is confirmed open (the option appears in the DOM).
  let opened = false;
  for (let attempt = 0; attempt < 4 && !opened; attempt++) {
    const box = await page.evaluate(() => {
      for (const el of document.querySelectorAll('ytcp-select, ytcp-text-dropdown-trigger')) {
        if (/People & Blogs/.test(el.textContent || '')) {
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          if (r.width > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
      }
      return null;
    });
    if (!box) break;
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(1800);
    opened = (await page.locator('[role="option"]').filter({ hasText: 'Science & Technology' }).count()) > 0;
  }
  if (!opened) throw new Error('category menu did not open');
  const opt = page.locator('tp-yt-paper-item[role="option"]').filter({ hasText: 'Science & Technology' }).first();
  await opt.scrollIntoViewIfNeeded();
  await opt.click({ force: true, timeout: 5000 });
  await page.waitForTimeout(800);
});
await page.screenshot({ path: '/tmp/yt-fill-details.png' });

// ---- NEXT → CUSTOMIZATION → NEXT → VISIBILITY ----
const clickNext = async () => {
  await page.keyboard.press('Escape').catch(() => {});
  const n = page.getByRole('button', { name: 'Next' });
  try { await n.click({ timeout: 6000 }); }
  catch { await page.getByText('Next', { exact: true }).last().click({ timeout: 6000 }); }
  await page.waitForTimeout(2500);
};
await step('Next → Customization', clickNext);
await step('Next → Visibility', clickNext);
await step('visibility = Public', async () => {
  await page.getByRole('radio', { name: /public/i }).first().click({ timeout: 8000 });
});
await step(`schedule date → ${DATE}`, async () => {
  await page.locator('ytcp-dropdown-trigger').filter({ hasText: /202\d/ }).first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const set = await page.evaluate((DATE) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    for (const inp of document.querySelectorAll('input')) {
      if (/[A-Z][a-z]{2}\s+\d{1,2},\s+202\d/.test(inp.value)) {
        setter.call(inp, DATE);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  }, DATE);
  if (!set) throw new Error('date input not found');
  await page.keyboard.press('Enter').catch(() => {});
  await page.waitForTimeout(800);
});
await step(`schedule time → ${TIME}`, async () => {
  // The time field is a combobox — typing alone reverts on blur, so we must
  // click it, type, then SELECT the matching dropdown option to commit.
  const timeRe = new RegExp('^' + TIME.replace(/\s+/g, '\\s?').replace(/([().])/g, '\\$1') + '$', 'i');
  const box = await page.evaluate(() => {
    for (const inp of document.querySelectorAll('input')) {
      if (/\d{1,2}:\d{2}\s?(AM|PM)/i.test(inp.value)) { const r = inp.getBoundingClientRect(); if (r.width > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    }
    return null;
  });
  if (!box) throw new Error('time input not found');
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(900);
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.type(TIME, { delay: 35 });
  await page.waitForTimeout(1100);
  try {
    await page.locator('tp-yt-paper-item, [role="option"], paper-item, ytcp-text-menu-item').filter({ hasText: timeRe }).first().click({ timeout: 3000 });
  } catch {
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(1000);
  const v = await page.evaluate(() => { for (const inp of document.querySelectorAll('input')) if (/\d{1,2}:\d{2}\s?(AM|PM)/i.test(inp.value)) return inp.value; });
  console.log('  time committed as:', v);
});
await step('inspect schedule controls', async () => {
  const info = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('input, ytcp-dropdown-trigger, tp-yt-paper-input, [aria-label]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const s = (el.getAttribute('aria-label') || el.value || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      if (s && /202\d|AM|PM|\d:\d|date|time/i.test(s)) out.push(`${el.tagName.toLowerCase()}${el.getAttribute('aria-label') ? '[al]' : ''}: "${s}"`);
    }
    return [...new Set(out)].slice(0, 18);
  });
  console.log('SCHEDULE CONTROLS:', JSON.stringify(info, null, 0));
});
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/yt-fill-visibility.png' });

if (SUBMIT) {
  await step('submit (Done)', async () => {
    const done = page.getByRole('button', { name: 'Done' }).first();
    await done.scrollIntoViewIfNeeded().catch(() => {});
    await done.click({ timeout: 10000 });
    await page.waitForTimeout(6000);
  });
  // Verify it landed in the Upcoming list.
  await step('verify scheduled', async () => {
    await page.goto('https://studio.youtube.com/channel/UC/livestreaming', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(7000);
    const t = (await page.locator('body').innerText().catch(() => '')) || '';
    // slice FIRST, then escape — escaping then slicing can cut a backslash
    // escape in half (e.g. a trailing-underscore handle), yielding an invalid regex.
    const ok = new RegExp(TITLE.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(t) || t.includes(HANDLE);
    if (!ok) throw new Error('scheduled stream not found in Upcoming list');
    console.log('  ✓ found in Upcoming:', DATE);
  });
  console.log('\nSCHEDULED ✅ — broadcast is live in the Upcoming list.');
} else {
  console.log('\nDONE filling — STOPPED before "Done" (pass --submit to schedule). Wizard left open for review.');
}
await browser.close();
