#!/usr/bin/env node
// keep-warm.mjs — keep the clone profiles' logged-in sessions ALIVE forever.
//
// Why: a cloned Google session dies when it sits idle for days — Google's
// rotating tokens (__Secure-*PSIDTS) go stale past the grace window and the
// whole session fork is killed (looks like cookie theft). The fix is simply to
// USE the session regularly: every visit rotates the clone's own tokens and
// persists the fresh ones to its cookie DB. This script touches every
// session every few hours (launchd) and raises an early alarm the moment one
// dies — days BEFORE scheduling day needs it.
//
//   node keep-warm.mjs            # warm + check all clones
//   node keep-warm.mjs --quiet    # suppress the macOS dead-session notification
//
// Install the 4-hourly launchd job:  bash keep-warm-install.sh
// Status: data/session-status.json   Log: data/keep-warm.log
//
// SAFETY: a clone with a HEADED window on its port is skipped entirely —
// headed means a human moment (wallet signature) may be in flight; never
// touch it (and launch-clone.sh would kill it to relaunch).
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectCDP } from './lib/connect.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const QUIET = process.argv.includes('--quiet');

const CLONES = [
  {
    name: 'chrome-ethereum', port: 9223, profile: 'profiles/chrome-ethereum', app: 'chrome',
    checks: [
      { name: 'google', url: 'https://calendar.google.com/calendar/u/0/r' },
      { name: 'x', url: 'https://x.com/home' },
    ],
  },
  {
    name: 'canary-concurrence', port: 9224, profile: 'profiles/canary-concurrence', app: 'canary',
    checks: [
      { name: 'youtube', url: 'https://studio.youtube.com/' },
    ],
  },
];

const STATUS_FILE = join(HERE, 'data', 'session-status.json');
const LOG_FILE = join(HERE, 'data', 'keep-warm.log');
mkdirSync(join(HERE, 'data'), { recursive: true });
const log = (m) => { const line = `${new Date().toISOString()} ${m}`; console.log(line); appendFileSync(LOG_FILE, line + '\n'); };

// A headed clone = possible pending wallet signature. Hands off.
const headedOnPort = (port) => {
  try {
    const ps = execSync('ps -axo command', { encoding: 'utf8' })
      .split('\n').filter((l) => l.includes(`--remote-debugging-port=${port}`));
    return ps.length > 0 && !ps.some((l) => l.includes('--headless'));
  } catch { return false; }
};

const portUp = (port) => {
  try { execSync(`curl -fs http://127.0.0.1:${port}/json/version`, { stdio: 'pipe' }); return true; } catch { return false; }
};

// Classify a landed page as signed-in or dead.
const classify = (name, url, text) => {
  if (/accounts\.google\.com|ServiceLogin|signin/i.test(url)) return 'DEAD';
  if (name === 'x' && (/\/i\/flow\/login|\/login/.test(url) || /Sign in to X/i.test(text))) return 'DEAD';
  if (/Signed out/i.test(text) && /Choose an account/i.test(text)) return 'DEAD';
  return 'alive';
};

const prev = existsSync(STATUS_FILE) ? JSON.parse(readFileSync(STATUS_FILE, 'utf8')) : {};
const status = {};

for (const clone of CLONES) {
  if (headedOnPort(clone.port)) { log(`⏭  ${clone.name} (${clone.port}) is HEADED — skipping (signature may be pending)`); continue; }
  if (!portUp(clone.port)) {
    log(`▶ launching ${clone.name} headless on ${clone.port}`);
    try {
      execFileSync('bash', ['launch-clone.sh', join(HERE, clone.profile), String(clone.port), 'headless', clone.app], { cwd: HERE, stdio: 'pipe' });
    } catch (e) { log(`✗ ${clone.name} failed to launch: ${e.message.split('\n')[0]}`); continue; }
  }
  const { browser, page } = await connectCDP(clone.port);
  try {
    for (const check of clone.checks) {
      const key = `${clone.name}:${check.name}`;
      try {
        await page.goto(check.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(5000); // let redirects settle + Set-Cookie rotations persist
        const text = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => '');
        const state = classify(check.name, page.url(), text);
        status[key] = { state, at: new Date().toISOString(), url: page.url().slice(0, 120) };
        log(`${state === 'alive' ? '✓' : '💀'} ${key}: ${state}`);
        if (state === 'DEAD' && prev[key]?.state !== 'DEAD' && !QUIET) {
          execSync(`osascript -e 'display notification "${key} session DIED — refresh cookies before next episode" with title "clawd keep-warm" sound name "Basso"'`);
        }
      } catch (e) {
        status[key] = { state: 'ERROR', at: new Date().toISOString(), err: e.message.split('\n')[0] };
        log(`⚠ ${key}: ${e.message.split('\n')[0]}`);
      }
    }
  } finally { await browser.close(); }
}

writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
const dead = Object.entries(status).filter(([, v]) => v.state !== 'alive');
log(dead.length ? `DONE — ${dead.length} problem(s): ${dead.map(([k]) => k).join(', ')}` : 'DONE — all sessions warm ✓');
process.exit(0);
