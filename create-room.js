// Create a live.slop.computer room for a given slug. WRITE action — only run
// after Austin confirms. Captures the shareable invite link and verifies the
// room appears in the admin list.
//   node create-room.js <slug>
import { connectCDP } from './lib/connect.js';
import { handleToSlug } from './lib/slugify.js';

const raw = (process.argv[2] || '').trim();
if (!raw) { console.error('usage: node create-room.js <slug-or-handle>'); process.exit(1); }
// Defensively slugify so an accidental @handle / underscore can't create an
// invalid room that the contract would later reject.
const slug = handleToSlug(raw);
if (slug !== raw.replace(/^@/, '').toLowerCase()) console.log(`(slugified "${raw}" -> "${slug}")`);

const { browser, page } = await connectCDP(9223);
try {
  await page.goto('https://live.slop.computer/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  // Safety: don't double-create.
  const before = await page.evaluate(() => (document.body.innerText || '').split('\n')
    .map((l) => l.trim().match(/^\/([a-z0-9_-]{1,30})$/i)?.[1]?.toLowerCase()).filter(Boolean));
  if (before.includes(slug.toLowerCase())) {
    console.log(`Room /${slug} already exists — nothing to do.`);
    process.exit(0);
  }

  console.log(`typing slug "${slug}" into CREATE A ROOM...`);
  const input = page.getByPlaceholder('slug (e.g. ep0)');
  await input.click();
  await input.fill(slug);
  await page.waitForTimeout(1200);

  // Capture the previewed shareable URL (slug + randomized invite/password).
  const previewUrl = await page.evaluate((s) => {
    const re = new RegExp('https://live\\.slop\\.computer/' + s + '\\?invite=\\S+', 'i');
    return (document.body.innerText.match(re) || [''])[0];
  }, slug);
  console.log('preview link:', previewUrl || '(not captured yet)');

  await page.screenshot({ path: '/tmp/slop-create-before.png' });
  console.log('clicking CREATE...');
  // The button is <button class="slop-button--primary">CREATE</button>. A normal
  // Playwright click stalls on an overlay, so fire its real onClick directly.
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'CREATE');
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log('CREATE clicked:', clicked);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '/tmp/slop-create-after.png' });

  // Verify it now exists.
  const after = await page.evaluate(() => (document.body.innerText || '').split('\n')
    .map((l) => l.trim().match(/^\/([a-z0-9_-]{1,30})$/i)?.[1]?.toLowerCase()).filter(Boolean));
  const created = after.includes(slug.toLowerCase());

  console.log('\n=========== RESULT ===========');
  console.log('room /' + slug + ' created & listed:', created ? 'YES ✅' : 'NO ❌');
  console.log('shareable link:', previewUrl || `https://live.slop.computer/${slug} (invite not captured — use admin Copy)`);
  if (!created) console.log('rooms now:', after.map((s) => '/' + s).join('  '));
} finally {
  await browser.close();
}
