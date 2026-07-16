# clawd-scheduler — agent runbook

This repo schedules a [slop.computer](https://slop.computer) podcast episode end
to end. **`SLOP-WORKFLOW.md` is the canonical, detailed guide — read it.** This
file is the fast cold-start so a fresh session can execute correctly.

## When the user says "schedule the next TODO slop computer in my schedule"

Run these in order. The orchestrator is **idempotent** — every scheduling surface
checks if it's already done and skips, so re-running is always safe (never
double-books).

```bash
# 0) Bring up the two logged-in browser clones HEADLESS (no focus steal).
#    9223 = Chrome (calendar + the user's X + austingriffith.eth wallet)
#    9224 = Canary (the YouTube channel)
bash launch-clone.sh "$PWD/profiles/chrome-ethereum"    9223 headless chrome
bash launch-clone.sh "$PWD/profiles/canary-concurrence" 9224 headless

# 1) Find the next episode whose calendar location is still a `TODO` placeholder.
node workflows/find-next-slop.js          # → {title, date e.g. "Jun 18, 2026", time e.g. "9:30 AM"}

# 2) Resolve the guest's X handle (verifies bio/identity; STOPS & asks if unsure).
node resolve-guest.js                     # → @handle  (e.g. @port_dev). If it stops, ASK the user.

# 3) Get THIS room's per-room relay token (NOT global) from its invite link.
node find-room.js <handle>                # confirm/locate the room (live.slop.computer/<slug>)
node copy-skill.js 'https://live.slop.computer/<slug>?invite=...'
#    → prints .../v1/skill?token=<ROOM_TOKEN>&slug=…  ← copy the 64-hex ROOM_TOKEN

# 4) See the plan (touches nothing), then execute, opting past each gate as you review.
node slop-episode.mjs --handle <h> --token <ROOM_TOKEN> --date '<Mon DD, YYYY>' \
    --time '<H:MM AM>' --invite 'https://live.slop.computer/<slug>?invite=...'
node slop-episode.mjs --handle <h> --token <ROOM_TOKEN> --date '..' --time '..' \
    --invite '..' --go [--create-room] [--pfp-ok] [--save-calendar] \
    [--submit-youtube] [--submit-twitter] [--submit-onchain]
```

To just **check status** of any episode (what's done vs missing), without changing
anything: `CHK_HANDLE=<h> CHK_DATE='<Mon DD, YYYY>' node check-episode.mjs`.

Phases (in order): `room research pfp card publish calendar youtube twitter onchain notify`.
For an episode that's partly done, the idempotent phases skip what exists — so you
can run the whole thing and it only creates what's missing.

## Hard rules (each was an expensive lesson — do not relearn them)

- **Idempotent / no duplicates.** Every scheduling surface skips if already done
  (calendar link present · YouTube Upcoming · X Producer · slop.computer/). Re-run freely.
- **Headless only — EXCEPT the on-chain step.** Driving a headed clone steals the
  user's keyboard focus the moment it navigates, so launch clones `headless` (UA-spoof
  is baked in) for every phase *except* `onchain`. The on-chain step needs a **visible**
  9223 because the user must SEE and SIGN the wallet popup — a headless window has no
  popup to approve and the tx just hangs. So before `onchain`, relaunch 9223 headed:
  `bash launch-clone.sh "$PWD/profiles/chrome-ethereum" 9223 headed chrome` — then put
  it **back to headless the instant they've signed**. Principle: stay headless by
  default; go headed ONLY for the exact moment the user must sign (or you need them to
  debug/see something), then revert. A lingering headed window keeps stealing focus.
- **The relay token is PER-ROOM and SECRET.** Get each room's token via `copy-skill.js`.
  It lives only in the gitignored `.env` (`SLOP_TOKEN`) — never hardcode/commit it.
- **On-chain = the USER signs the wallet tx.** `schedule-onchain.mjs` fills the date
  and clicks SCHEDULE EPISODE to *bring up* the tx; it NEVER signs and never touches
  the wallet password. It has a guard that refuses to click unless the datetime reads
  back exactly right (it once fired an empty-time tx — never again). Run it against a
  **headed** 9223 (see "Headless only" above), then **relaunch 9223 headless the moment
  the user has signed** — a lingering headed window keeps stealing their foreground.
  **While a signature is pending, do NOT drive 9223 for anything else** — connecting
  another automation to that clone can drop the CDP session and disrupt signing.
- **Telegram notify is a MANUAL send.** `notify-guest.mjs` copies the welcome message
  + room invite to the clipboard; the USER pastes & sends. NEVER auto-send a private
  link to a guessed Telegram contact (handles ≠ Twitter; misID risk).
- **Calendar edits save SILENTLY.** Always click "Don't send" — never email the guest.
- **Scripts tear down their tabs.** CDP `browser.close()` only disconnects — a
  navigated tab lingers in the clone forever (a parked room tab makes the user a
  ghost "participant"). `lib/connect.js` auto-closes the page it opened on
  `browser.close()`; pass `{ keepPage: true }` ONLY for tabs that must outlive the
  script (review gates, the pending wallet-signature tab). Never drive `pages()[0]`
  — it might BE the signing tab.
- **Never serve `/tmp` (or any shared dir) on `0.0.0.0`.** Local servers bind
  `127.0.0.1`, write a PID file, and tear down. (Exposed `/tmp` tokens on the LAN once.)
- **Secrets never get committed.** `.env`, `profiles/` (live cookies), `data/` (guest
  emails) are gitignored. This repo is PUBLIC. Commit as `clawdbotatg` /
  `clawd@buidlguidl.com` over HTTPS (see global ~/.claude/CLAUDE.md).

## Keeping the clone logins alive (don't relearn the cookie-rot lesson)

A cloned Google session dies when it sits IDLE for days — the rotating
`__Secure-*PSIDTS` tokens go stale and Google kills the fork (looks like cookie
theft). Two defenses, both in place:

- **`keep-warm.mjs`** (launchd `com.clawd.keepwarm`, every 4h + at login;
  install/update via `bash keep-warm-install.sh`) touches every clone's
  sessions headless so their tokens keep rotating, logs to `data/keep-warm.log`
  + `data/session-status.json`, and fires a macOS notification the moment a
  session dies. It SKIPS any clone with a headed window (pending wallet
  signature — never drive it). If a session IS dead: the fix is the cookie
  copy from the real profile (see memory: quit the real browser ~5s — ALWAYS
  ask Austin first), then keep-warm holds the new session alive.
- **Prefer APIs over cookies where possible.** The calendar phase no longer
  needs a browser at all in claude.ai-connected sessions: the Google Calendar
  MCP connector edits the event directly — set `notificationLevel: "NONE"`
  (the API's "Don't send") or it WILL email the guest. YouTube is the last
  cookie-dependent Google surface; the eventual fix is the YouTube Data API
  with a one-time OAuth refresh token.

## Canonical scripts (ignore the `recon-*`, `explore-*`, `diagnose-*`, `inspect-*`,
## `test-*`, `find-slop-*`, `*-tmp` files — those are debug one-offs)

`workflows/find-next-slop.js` · `resolve-guest.js` · `find-room.js`/`create-room.js` ·
`copy-skill.js` · `kick-research.mjs` · `get-pfp.js` · `card-from-pfp.mjs` ·
`publish-card.mjs` · `update-calendar-event.mjs` · `fill-yt-schedule.js` ·
`x-schedule.mjs` · `schedule-onchain.mjs` · `notify-guest.mjs` · `check-episode.mjs` ·
orchestrated by **`slop-episode.mjs`**. Config + per-episode derivation: `lib/config.js`.

Full per-step detail, selectors, and the hard-won UI gotchas are in **`SLOP-WORKFLOW.md`**.
