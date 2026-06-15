// Step 11a (deterministic): update a slop.computer episode's calendar event —
// prefix the title, set the location to the real room link, and rewrite the
// description as: SLOP.COMPUTER intro + room link + the host's common questions
// (fetched live from the admin). Bold headers via execCommand (Trusted-Types safe).
//
// ALWAYS saves silently — never emails the guest ("Don't send").
//
//   node update-calendar-event.mjs --day 2026/6/18 --match "port dev" \
//     --link "https://live.slop.computer/port-dev?invite=..." --token <bearer> [--save]
//
// Without --save it's a DRY RUN (fills the editor, screenshots /tmp/event-edited.png,
// does not save). With --save it saves silently.
import { connectCDP } from './lib/connect.js';

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
// Accept either YYYY/M/D or a human "Mon DD, YYYY" (what the rest of the pipeline
// passes via --date) — normalize to the YYYY/M/D the calendar day-view URL needs.
const normDay = (d) => {
  if (!d) return d;
  const M = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const hm = d.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})$/);
  return hm ? `${hm[3]}/${M[hm[1].toLowerCase()]}/${Number(hm[2])}` : d;
};
const DAY = normDay(arg('--day')); // YYYY/M/D (or "Mon DD, YYYY" → normalized)
const MATCH = arg('--match'); // substring of the event title to open
const LINK = arg('--link'); // real room invite link
const TOKEN = arg('--token'); // bearer for /v1/admin/questions
const SAVE = args.includes('--save');
const TITLE_PREFIX = 'Slop.Computer: ';
const INTRO =
  '**SLOP.COMPUTER**\n' +
  'an onchain podcast for technical humans building with ai.\n' +
  '\n' +
  'when you connect it will ask you to start a video (or just audio) stream to chat in a live interactive "slop computer".';

if (!DAY || !MATCH || !LINK || !TOKEN) {
  console.error('usage: --day YYYY/M/D --match "<title substr>" --link <roomLink> --token <bearer> [--save]');
  process.exit(1);
}

const q = (await (await fetch('https://live.slop.computer/v1/admin/questions', { headers: { Authorization: `Bearer ${TOKEN}` } })).json()).text || '';
const content = `${INTRO}\n\n${LINK}\n\n${q}`;
const boldTexts = [...content.matchAll(/\*\*(.*?)\*\*/g)].map((m) => m[1]);

const { browser, page } = await connectCDP(9223);
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
try {
  await page.goto(`https://calendar.google.com/calendar/u/0/r/day/${DAY}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2800);

  // Open the matching event → Edit.
  const ids = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-eventid]')].map((e) => e.getAttribute('data-eventid')))]);
  let opened = false;
  for (const id of ids) {
    await page.locator(`[data-eventid="${id}"]`).first().click({ timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const t = (await page.locator('[role="dialog"]').first().innerText().catch(() => '')) || '';
    if (t.toLowerCase().includes(MATCH.toLowerCase())) { opened = true; break; }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  if (!opened) throw new Error(`no event matching "${MATCH}" on ${DAY}`);

  // IDEMPOTENCY: if the event already shows the real room link (not TODO), it's
  // already been updated — skip (safe to re-run, no duplicate edits/emails).
  {
    const dlg = (await page.locator('[role="dialog"]').first().innerText().catch(() => '')) || '';
    const linkCore = (LINK.match(/live\.slop\.computer\/[a-z0-9-]+/i) || [])[0];
    if (linkCore && dlg.includes(linkCore)) {
      console.log(`✓ Calendar: event "${MATCH}" already has ${linkCore} — SKIP (already updated).`);
      await browser.close();
      process.exit(0);
    }
  }

  await page.getByRole('button', { name: /edit event/i }).first().click({ timeout: 8000 });
  await page.waitForTimeout(3500);

  // Title prefix (idempotent).
  const titleInput = page.locator('input[aria-label="Title"]');
  const curTitle = (await titleInput.inputValue().catch(() => '')) || '';
  if (curTitle && !curTitle.startsWith(TITLE_PREFIX)) {
    await titleInput.click();
    await page.keyboard.press(`${MOD}+a`); await page.keyboard.press('Backspace');
    await titleInput.type(TITLE_PREFIX + curTitle, { delay: 3 });
  }

  // Location → room link.
  const loc = page.locator('input[aria-label="Add location"]');
  await loc.click();
  await page.keyboard.press(`${MOD}+a`); await page.keyboard.press('Backspace');
  await loc.type(LINK, { delay: 5 });

  // Description → clear, type plain (strip ** markers), then bold each header.
  const desc = page.locator('div[contenteditable="true"][aria-label="Description"]');
  await desc.click();
  await page.keyboard.press(`${MOD}+a`); await page.keyboard.press('Backspace');
  const lines = content.replace(/\t/g, '  ').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].replace(/\*\*(.*?)\*\*/g, '$1');
    if (text) await page.keyboard.type(text);
    if (i < lines.length - 1) await page.keyboard.press('Enter');
  }
  await page.evaluate((texts) => {
    const d = document.querySelector('div[contenteditable="true"][aria-label="Description"]');
    if (!d) return;
    d.focus();
    for (const h of texts) {
      const walker = document.createTreeWalker(d, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const idx = n.textContent.indexOf(h);
        if (idx !== -1) {
          const r = document.createRange();
          r.setStart(n, idx); r.setEnd(n, idx + h.length);
          const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
          document.execCommand('bold');
          break;
        }
      }
    }
  }, boldTexts);
  await page.waitForTimeout(600);
  await page.screenshot({ path: '/tmp/event-edited.png' });
  console.log(`filled: title prefixed, location set, description (bold: ${JSON.stringify(boldTexts)})`);

  if (SAVE) {
    await page.getByRole('button', { name: /^save$/i }).first().click({ timeout: 8000 });
    await page.waitForTimeout(2000);
    // ALWAYS silent — never notify the guest.
    const dontSend = page.getByRole('button', { name: /don'?t send/i });
    if (await dontSend.count()) { await dontSend.first().click(); }
    await page.waitForTimeout(2500);
    console.log('SAVED silently (no guest notification)');
  } else {
    console.log('DRY RUN — not saved. Review /tmp/event-edited.png');
  }
} finally {
  await browser.close();
}
