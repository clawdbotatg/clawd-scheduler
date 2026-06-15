# Workflow blueprint: YouTube — schedule a live broadcast

Exact, verified mechanics for driving the YouTube Studio "Schedule Stream →
Create new" flow on a cloned, logged-in Canary profile via Playwright/CDP.

- **Account verified on:** `@austingriffith3550` (Canary `Profile 3`,
  host@example.com) — has live streaming enabled.
- **Status:** verified through the **Details** step of the Create-stream wizard.
  Customization / Visibility / final submit are **not yet mapped** (see frontier
  at bottom). Nothing has been created on the channel.

---

## 0. Prerequisites — get a driveable browser on port 9222

The clone profile lives at `profiles/canary-concurrence/` and persists even when
Chrome Canary is fully closed. Steady-state pattern is **clone once, relaunch
many** — you do NOT re-clone each run.

**Cold start (Canary closed, or clone on 9222 is down) — relaunch the existing clone:**
```bash
nohup "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary" \
  --user-data-dir="$HOME/clawd/clawd-scheduler/profiles/canary-concurrence" \
  --remote-debugging-port=9222 \
  --no-first-run --no-default-browser-check --hide-crash-restore-bubble \
  about:blank >/tmp/canary-clone.log 2>&1 &
# wait for the port:
until curl -fs http://localhost:9222/json/version >/dev/null 2>&1; do sleep 0.5; done
```
Verified fact: fully quitting the user's real Canary also kills this clone (same
app binary). The relaunch above brings it back from disk with the login intact —
no re-clone, no re-login. To rebuild the clone from scratch instead, use the
skill's `clone-and-launch.sh`.

**Attach:** `connectCDP(9222)` from `lib/connect.js` → returns `{browser, context, page}`
with a FRESH page (do not reuse the launcher's about:blank).

---

## 1. Navigate to the live control room
```js
await page.goto('https://studio.youtube.com/channel/UC/livestreaming',
                { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4500); // Studio is a heavy SPA; needs settle time
```
`/channel/UC/...` auto-redirects to the real channel id
(`UC_HI2i2peo1A-STdG22GFsA`). Page title settles to "Live streaming - YouTube Studio".

Gate check (do once per account): if body text matches
`/request access|may take up to 24 hours/i`, live streaming is NOT enabled on
this channel — stop, it needs manual enablement + up to 24h.

## 2. Open the scheduler
```js
await page.getByText('Schedule Stream', { exact: false }).first().click({ timeout: 12000 });
await page.waitForTimeout(3000);
```
Opens dialog titled **"Schedule with previous settings"**, listing the most
recent stream to optionally clone, with two buttons:
- **Create new** — fresh stream, fill everything (this blueprint)
- **Reuse settings** — copy a prior stream's settings, only change the time

## 3. Choose "Create new"
```js
await page.getByRole('button', { name: /create new/i }).click({ timeout: 12000 });
await page.waitForTimeout(4500);
```
Opens the **"Create stream"** wizard — a 3-step flow:
`Details → Customization → Visibility`, with a **Next** button bottom-right.

## 4. Step 1 — Details  (VERIFIED selectors)
Both text fields are **contenteditable `div[role=textbox]`**, NOT `<input>`.
Address them by aria-label:

| Field | Selector | Notes |
|---|---|---|
| Title (required) | `div[role=textbox][aria-label^="Add a title"]` | contenteditable |
| Description | `div[role=textbox][aria-label^="Tell viewers"]` | contenteditable |
| Made for kids = Yes | `tp-yt-paper-radio-button` with text `Yes, it's made for kids` | radio |
| Made for kids = No | `tp-yt-paper-radio-button` with text `No, it's not made for kids` | radio |
| Advance | `page.getByRole('button', { name: 'Next' })` | |

Filling a contenteditable (don't use `.type()` on the page; target the element):
```js
const title = page.locator('div[role="textbox"][aria-label^="Add a title"]');
await title.click();
await title.fill('My Stream Title');   // .fill() works on contenteditable in modern Playwright
// "Made for kids" is required to proceed:
await page.locator('tp-yt-paper-radio-button', { hasText: "No, it's not made for kids" }).click();
await page.getByRole('button', { name: 'Next' }).click();
```

---

## Frontier — NOT yet mapped (explore without submitting, then fill in)
- **Step 2 — Customization:** fields unknown (likely category, thumbnail,
  chat/monetization toggles). Click Next from Details to capture.
- **Step 3 — Visibility:** expected to hold Public/Unlisted/Private AND the
  **schedule date/time pickers** — the core of "schedule for a certain time".
  This is the most important step to map exactly (date control, time control,
  timezone).
- **Final submit:** the button that actually creates the scheduled broadcast
  (likely "Done"/"Schedule"/"Create"). IRREVERSIBLE-ish — creates a real event.
  Confirm title/time/visibility with the user before clicking. For first tests
  use Private.

## Parameters this workflow should accept (for calendar triggering)
`{ title, description?, madeForKids: boolean, visibility: 'private'|'unlisted'|'public', scheduledAt: Date/ISO, timezone? }`

## Files
- `lib/connect.js` — CDP attach helper
- `goto-create-new.js` — reproduces steps 1–3 and dumps Details fields (used to
  author this doc)
- `workflows/youtube-schedule-broadcast.js` — TODO: the executable workflow,
  built once steps 2–3 are mapped
