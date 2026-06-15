// FINAL step (manual send): prep the guest's Telegram welcome message.
// Prints the blurb + room invite link and copies the blurb (single line, no hard
// newlines — terminal word-wrap otherwise injects fake line breaks) to the
// clipboard. Re-run with --link to copy the invite link for the follow-up paste.
//
// We DO NOT send: a private room link toward a guessed Telegram contact is a real
// misidentification risk — the user knows the real contact and sends it themselves.
//   NOTIFY_HANDLE=port_dev NOTIFY_INVITE='https://live.slop.computer/port-dev?invite=…' \
//     node notify-guest.mjs [--link]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { episode } from './lib/config.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const HANDLE_IN = process.env.NOTIFY_HANDLE || arg('handle');
if (!HANDLE_IN) { console.error('set NOTIFY_HANDLE (or --handle <h>)'); process.exit(1); }
const ep = episode(HANDLE_IN);
const INVITE = process.env.NOTIFY_INVITE || arg('invite') || '';
const wantLink = process.argv.includes('--link');

// The blurb is ONE line on purpose (Telegram soft-wraps it). Keep it verbatim.
const BLURB = "updated the cal invite with the link to slop.computer, you will jump in and share your camera — it's a weird live interactive site, not zoom or google meets or anything — you share your video, there is a green room before we start, and then we will go live — you can get in and test any time, there is a computer room built just for you — welcome to the sloppiest of slop computers :)";

const copy = (s) => { try { execFileSync('pbcopy', [], { input: s }); return true; } catch { return false; } };

console.log(`\n=== notify @${ep.handle} on Telegram (you send it) ===\n`);
console.log('MESSAGE:\n' + BLURB + '\n');
console.log('LINK:\n' + (INVITE || '(no invite link — pass NOTIFY_INVITE / --invite)') + '\n');

// Default clipboard = the full message ready for ONE paste: blurb (single line)
// + blank line + invite link. Only the newlines before the link are real.
const FULL = INVITE ? `${BLURB}\n\n${INVITE}` : BLURB;
// Also drop it to a file — the clipboard is easily clobbered before you paste;
// `pbcopy < <file>` re-copies it without re-running the whole step.
const NOTIFY_FILE = `/tmp/${ep.slug}-notify.txt`;
try { fs.writeFileSync(NOTIFY_FILE, FULL + '\n'); } catch { /* non-fatal */ }
if (wantLink) {
  if (!INVITE) { console.log('✗ no invite link to copy.'); process.exit(1); }
  console.log(copy(INVITE) ? '📋 just the LINK copied.' : '(could not copy — copy the LINK above manually)');
} else {
  console.log(copy(FULL)
    ? '📋 MESSAGE + link copied — paste ONCE into Telegram (blurb is one line; the only newlines are before the link). `--link` copies just the link.'
    : '(could not copy — copy the text above manually)');
}
console.log(`\n💾 also saved to ${NOTIFY_FILE} — re-copy anytime with: pbcopy < ${NOTIFY_FILE}`);
console.log('\n⚠ You send this — never auto-sent to a guessed Telegram account.');
