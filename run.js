/**
 * Workflow runner — the "play back" + "chain" engine.
 *
 * Usage:
 *   node run.js --profile google-personal gmail-filter
 *   node run.js --profile google-personal gmail-filter youtube-broadcast
 *
 * Every workflow file in workflows/<name>.js exports a default async function
 * that receives { context, page, log }. List several names to run them in
 * sequence on the SAME logged-in browser — that's how you stitch workflows.
 */
import { launchProfile } from './lib/browser.js';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const argv = process.argv.slice(2);
let profile = 'default';
const workflows = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--profile') profile = argv[++i];
  else workflows.push(argv[i]);
}

if (workflows.length === 0) {
  console.error('Usage: node run.js [--profile <name>] <workflow> [<workflow> ...]');
  process.exit(1);
}

const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);

const context = await launchProfile(profile);
const page = context.pages()[0] ?? (await context.newPage());

try {
  for (const name of workflows) {
    const file = pathToFileURL(path.resolve('workflows', `${name}.js`)).href;
    log(`▶ running workflow: ${name}`);
    const mod = await import(file);
    await mod.default({ context, page, log });
    log(`✓ finished: ${name}`);
  }
  log('all workflows complete');
} catch (err) {
  log('✗ workflow failed:', err.message);
  process.exitCode = 1;
} finally {
  // Leave the browser open briefly so you can see the result, then close.
  await page.waitForTimeout(2000);
  await context.close();
}
