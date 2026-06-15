import { chromium } from 'playwright';

/**
 * Attach to an already-running Chrome/Canary that was started with
 * --remote-debugging-port=<port>. Returns the live browser + first real page.
 * Closing the returned browser only DISCONNECTS; the real Chrome keeps running.
 */
export async function connectCDP(port = 9222) {
  const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  // Always open a fresh page — reusing the launcher's about:blank tab proved flaky.
  const page = await context.newPage();
  return { browser, context, page };
}
