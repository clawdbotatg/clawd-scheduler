const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0];
  const page = await context.newPage();

  const log = (...a) => console.log('[drive]', ...a);

  // Step 1 — live control room
  log('navigating to live control room...');
  await page.goto('https://studio.youtube.com/channel/UC/livestreaming', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  log('url:', page.url());
  log('title:', await page.title());

  const body = (await page.locator('body').innerText().catch(() => '')) || '';
  if (/request access|may take up to 24 hours/i.test(body)) {
    log('GATE: live streaming NOT enabled on this channel.');
    await page.screenshot({ path: '/tmp/yt-1-gate.png' });
    await browser.close();
    process.exit(2);
  }
  await page.screenshot({ path: '/tmp/yt-1-control-room.png' });

  // Step 2 — open scheduler
  log('clicking "Schedule Stream"...');
  await page.getByText('Schedule Stream', { exact: false }).first().click({ timeout: 12000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/yt-2-schedule-dialog.png' });

  // Step 3 — Create new
  log('clicking "Create new"...');
  await page.getByRole('button', { name: /create new/i }).click({ timeout: 12000 });
  await page.waitForTimeout(4500);
  await page.screenshot({ path: '/tmp/yt-3-create-stream-details.png' });

  // Step 4 — probe Details fields (DO NOT FILL / DO NOT SUBMIT)
  const titleField = page.locator('div[role="textbox"][aria-label^="Add a title"]');
  const descField  = page.locator('div[role="textbox"][aria-label^="Tell viewers"]');
  log('title field present:', await titleField.count());
  log('description field present:', await descField.count());
  log('Made-for-kids radios present:', await page.locator('tp-yt-paper-radio-button').count());
  log('Next button present:', await page.getByRole('button', { name: 'Next' }).count());

  log('STOPPED at Details step. Nothing filled, nothing submitted.');
  // leave the page open in the browser; just detach
  await browser.close();
})().catch(e => { console.error('[drive] ERROR:', e.message); process.exit(1); });
