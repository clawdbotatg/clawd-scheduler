// Step 3: check live.slop.computer/admin for a room matching the guest's handle.
// READ-ONLY. If found -> report. If not -> emit the exact ask for Austin (no create).
//   node find-room.js <handle>
import { connectCDP } from './lib/connect.js';
import { handleToSlug } from './lib/slugify.js';

const rawHandle = (process.argv[2] || '').replace(/^@/, '');
if (!rawHandle) { console.error('usage: node find-room.js <handle>'); process.exit(1); }
// Room slug = contract-valid slugified handle (underscores -> hyphens).
const handle = handleToSlug(rawHandle);
if (handle !== rawHandle.toLowerCase()) console.log(`handle @${rawHandle} -> room slug "${handle}" (contract rule [a-z0-9-])`);

const { browser, page } = await connectCDP(9223);
try {
  await page.goto('https://live.slop.computer/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  const auth = await page.evaluate(() => {
    const m = (document.body.innerText || '').match(/Authenticated as\s*\n?\s*([^\n]+)/i);
    return m ? m[1].trim() : '(unknown)';
  });

  // Collect room slugs (lines like "/adrianleb").
  const slugs = await page.evaluate(() => {
    const set = new Set();
    for (const line of (document.body.innerText || '').split('\n')) {
      const m = line.trim().match(/^\/([a-z0-9_-]{1,30})$/i);
      if (m) set.add(m[1].toLowerCase());
    }
    return [...set];
  });

  console.log(`admin authenticated as: ${auth}`);
  console.log(`existing rooms (${slugs.length}): ${slugs.map((s) => '/' + s).join('  ')}`);
  console.log(`looking for room: /${handle}\n`);

  const exact = slugs.includes(handle);
  const near = slugs.filter((s) => s.includes(handle) || handle.includes(s));

  if (exact) {
    console.log(`==> FOUND: https://live.slop.computer/${handle}  ✅  (room already exists — proceed to next step)`);
  } else {
    if (near.length) console.log(`(no exact room; similar slugs present: ${near.map((s) => '/' + s).join(', ')})`);
    console.log(`==> NOT FOUND.`);
    console.log(`\nASK AUSTIN:`);
    console.log(`  "I can't find a room with the name ${handle} — would you like me to create it, or use a different name?"`);
  }
} finally {
  await browser.close();
}
