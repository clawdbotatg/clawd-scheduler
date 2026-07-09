import { chromium } from 'playwright';

/**
 * Attach to an already-running Chrome/Canary that was started with
 * --remote-debugging-port=<port>. Returns the live browser + first real page.
 * Closing the returned browser only DISCONNECTS; the real Chrome keeps running —
 * so close() below also closes the page we opened, or every script run would
 * leave its tab parked in the clone forever (ghost room participants, stale
 * calendar/admin tabs). Pass { keepPage: true } when the tab MUST outlive the
 * script (review gates, a pending wallet signature).
 */
export async function connectCDP(port = 9222, { keepPage = false } = {}) {
  const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  // Always open a fresh page — reusing the launcher's about:blank tab proved flaky.
  const page = await context.newPage();
  const disconnect = browser.close.bind(browser);
  browser.close = async () => {
    if (!keepPage) await page.close().catch(() => {});
    await disconnect();
  };
  return { browser, context, page };
}
