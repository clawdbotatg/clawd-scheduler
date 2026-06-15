import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/**
 * Launch a persistent browser profile.
 *
 * A "profile" is a folder under profiles/<name> that holds cookies + login
 * state for ONE account. Log in once (manually) and every future run reuses it.
 * One profile per account = your "multiple browsers" isolation, for free.
 *
 * @param {string} profileName  e.g. "google-personal", "google-work", "x"
 * @param {{headless?: boolean, slowMo?: number}} [opts]
 * @returns {Promise<import('playwright').BrowserContext>}
 */
export async function launchProfile(profileName, opts = {}) {
  const userDataDir = path.join(ROOT, 'profiles', profileName);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: opts.headless ?? false,
    slowMo: opts.slowMo ?? 0,
    viewport: null,            // use the real window size
    args: ['--start-maximized'],
  });
  return context;
}

export { ROOT };
