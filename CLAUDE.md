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
- **Headless only.** Driving a headed clone steals the user's keyboard focus the
  moment it navigates. Always launch clones `headless` (UA-spoof is baked in).
- **The relay token is PER-ROOM and SECRET.** Get each room's token via `copy-skill.js`.
  It lives only in the gitignored `.env` (`SLOP_TOKEN`) — never hardcode/commit it.
- **On-chain = the USER signs the wallet tx.** `schedule-onchain.mjs` fills the date
  and clicks SCHEDULE EPISODE to *bring up* the tx; it NEVER signs and never touches
  the wallet password. It has a guard that refuses to click unless the datetime reads
  back exactly right (it once fired an empty-time tx — never again).
- **Telegram notify is a MANUAL send.** `notify-guest.mjs` copies the welcome message
  + room invite to the clipboard; the USER pastes & sends. NEVER auto-send a private
  link to a guessed Telegram contact (handles ≠ Twitter; misID risk).
- **Calendar edits save SILENTLY.** Always click "Don't send" — never email the guest.
- **Never serve `/tmp` (or any shared dir) on `0.0.0.0`.** Local servers bind
  `127.0.0.1`, write a PID file, and tear down. (Exposed `/tmp` tokens on the LAN once.)
- **Secrets never get committed.** `.env`, `profiles/` (live cookies), `data/` (guest
  emails) are gitignored. This repo is PUBLIC. Commit as `clawdbotatg` /
  `clawd@buidlguidl.com` over HTTPS (see global ~/.claude/CLAUDE.md).

## Canonical scripts (ignore the `recon-*`, `explore-*`, `diagnose-*`, `inspect-*`,
## `test-*`, `find-slop-*`, `*-tmp` files — those are debug one-offs)

`workflows/find-next-slop.js` · `resolve-guest.js` · `find-room.js`/`create-room.js` ·
`copy-skill.js` · `kick-research.mjs` · `get-pfp.js` · `card-from-pfp.mjs` ·
`publish-card.mjs` · `update-calendar-event.mjs` · `fill-yt-schedule.js` ·
`x-schedule.mjs` · `schedule-onchain.mjs` · `notify-guest.mjs` · `check-episode.mjs` ·
orchestrated by **`slop-episode.mjs`**. Config + per-episode derivation: `lib/config.js`.

Full per-step detail, selectors, and the hard-won UI gotchas are in **`SLOP-WORKFLOW.md`**.
