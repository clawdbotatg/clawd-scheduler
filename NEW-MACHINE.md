# Running the scheduler on a new machine

Everything scriptable is in the repo. What is NOT in the repo (on purpose —
secrets/PII/size) and must be hand-carried or re-created is listed here, in
order. macOS only (launchd + `/Applications/` Chrome paths).

## 1) Clone + deps

```bash
git clone https://github.com/clawdbotatg/clawd-scheduler.git
cd clawd-scheduler
npm install          # playwright (CDP client only — no bundled browsers needed)
```

Install **Google Chrome** and **Chrome Canary** from google.com/chrome — the
scripts drive real-profile clones over CDP via `launch-clone.sh`, which expects
the stock `/Applications/Google Chrome[ Canary].app` install. `npx playwright
install` is NOT needed.

## 2) Copy the gitignored state from the old machine

From the old machine's repo dir (rsync -a over ssh, or a disk):

| What | Size | Why |
|---|---|---|
| `.env` | 1 KB | `SLOP_TOKEN` (per-room relay token) + `YT_CLIENT_ID/SECRET/REFRESH_TOKEN` (YouTube API OAuth — machine-independent, works anywhere) |
| `profiles/` | ~17 GB | The cloned logged-in browser profiles: `chrome-ethereum` (calendar + Austin's X login + the austingriffith.eth wallet extension) and `canary-concurrence` (YouTube channel, fallback only) |
| `data/` | ~36 KB | Guest caches (`guest-twitter.json` etc. — emails = PII, and the handle-resolution cache the workflow trusts) |
| `.showtime-state/` | tiny | `.armed` markers for already-armed episodes — copy if non-empty, or showtime re-arms (harmless but re-verifies) episodes it already handled |

## 3) Re-point the launchd jobs — ONE machine only

The go-live automation must run on exactly one box or both will fire go-live.

On the NEW machine:
```bash
bash showtime-install.sh     # com.clawd.slop-showtime (auto go-live + auto-stop)
bash keep-warm-install.sh    # com.clawd.keepwarm (X-only session warmer, every 4h)
```

On the OLD machine (immediately after):
```bash
launchctl bootout gui/$(id -u)/com.clawd.slop-showtime
launchctl bootout gui/$(id -u)/com.clawd.keepwarm
rm ~/Library/LaunchAgents/com.clawd.slop-showtime.plist \
   ~/Library/LaunchAgents/com.clawd.keepwarm.plist
```

## 4) Git identity (repo is PUBLIC)

Commit as `clawdbotatg` / `clawd@buidlguidl.com` over HTTPS, and make sure the
gitleaks pre-commit hook is active:
`brew install gitleaks && git config --global core.hooksPath ~/.git-hooks`
(copy `~/.git-hooks/` + `~/.config/gitleaks/gitleaks.toml` from the old machine
if they don't exist).

## Caveats that don't copy

- **Google cookies in the clones rot in days** and are refreshed per-episode by
  HOT-COPYING from a REAL logged-in Chrome/Canary **on the same machine**
  (see CLAUDE.md "Clone Google sessions"). If the new machine has no real
  logged-in Chrome/Canary profiles, that refresh path is gone. In practice this
  mostly doesn't matter anymore — YouTube goes through the Data API (`.env`
  creds) and calendar through the Google Calendar MCP connector — but the 9224
  browser fallback and any Google-surface debugging need a real signed-in
  profile locally.
- **X login lives in `profiles/chrome-ethereum`** and survives via keep-warm.
  If it dies, sign into x.com in a headed 9223 clone once.
- **On-chain scheduling needs a human at THIS machine's screen**: the wallet
  popup appears in a HEADED 9223 clone and Austin must see and sign it. A
  headless/remote box can do every phase except `onchain`.
- **Slop admin SIWE session** (room creation) also expires — needs a headed
  wallet `personal_sign` on the new machine when it does.
- **OBS** is wherever Austin streams from; showtime only watches the feed via
  the relay — it does not need OBS on this machine.
