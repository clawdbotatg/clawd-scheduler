# SLOP.COMPUTER episode-setup pipeline

Automates setting up the next slop.computer podcast episode from the calendar.
Runs against the logged-in profile clones (see `~/.claude/skills/browser-automation`).
Two browsers in play:
- **9223** — Chrome clone, `ethereum.org` Google login (calendar) **and** the user's
  X/Twitter session (the profile clone carried BOTH — that's how we read X as the user).
- **9224** — Canary clone (`profiles/canary-concurrence`), YouTube channel, for the
  broadcast step. Launch headless (no focus steal): `bash launch-clone.sh
  "$PWD/profiles/canary-concurrence" 9224 headless`. (Older docs say 9222 — it's 9224 now.)

## ONE COMMAND — `slop-episode.mjs` (the main workflow)

Everything below is wired into a single orchestrator. It derives every per-episode
value from the guest @handle (`lib/config.js` → slug/title/card/pfp), runs each
phase in order, and **gates every write/judgment step**. Default is PLAN (prints
the exact command for each phase, runs nothing):

```
# 0) discover + confirm the guest handle (has its own stop-and-ask gate)
node resolve-guest.js                      # next TODO episode → @handle

# 0b) get THIS room's token (the token is PER-ROOM, not global):
node copy-skill.js 'https://live.slop.computer/<slug>?invite=...'
#   → prints .../v1/skill?token=<ROOM_TOKEN>&slug=…   ← copy the 64-hex token

# 1) see the whole plan (safe, no side effects)
node slop-episode.mjs --handle <x> --token <ROOM_TOKEN> --date 'Jun 18, 2026' \
    --time '9:30 AM' --invite 'https://live.slop.computer/<slug>?invite=...'

# 2) execute, passing each gate explicitly as you review:
node slop-episode.mjs --handle <x> --token <ROOM_TOKEN> --date '..' --time '..' \
    --invite '..' --go [--create-room] [--pfp-ok] [--save-calendar] \
    [--submit-youtube] [--submit-twitter]
```

Gates (each opts past ONE human checkpoint): `--create-room` (room missing →
create, WRITE), `--pfp-ok` (verified it's the right face → bake card),
`--save-calendar` (else dry-run, never emails the guest), `--submit-youtube`
(else fills the YouTube wizard and STOPS before Done), `--submit-twitter` (else
fills the X form and STOPS before create), `--submit-onchain` (else fills the
slop.computer schedule form and STOPS; WITH it, clicks SCHEDULE EPISODE → **a
wallet tx pops up for YOU to sign** — the script never signs). Scope: `--from
<phase>` / `--only <phase>` (phases: room research pfp card publish calendar
youtube twitter onchain). `--duration <min>` sets the X broadcast length
(default 70). On any failure it prints the exact `--from <phase> --go` resume.

**Every scheduling phase is IDEMPOTENT** — it checks whether the episode is
already booked on that surface and SKIPS if so, so re-running "the full stack for
adrianleb" never double-books. The checks: calendar event already shows the real
`live.slop.computer/<slug>` link · YouTube Upcoming has `@handle` on that date ·
X Producer scheduled list has `@handle` on that date · slop.computer/ lists the
slug. This makes discovery-driven runs safe: find the episode(s) for a day from
the calendar (`node workflows/find-next-slop.js`) and run the orchestrator per
guest @handle — already-done surfaces skip, not-yet-started ones get created.

**The relay token is PER-ROOM and a SECRET** — never hardcoded or committed. Get
it from the room's invite link via `copy-skill.js` (step 0b) and pass it as
`--token` (the orchestrator forwards it to every child as `SLOP_TOKEN`); the
orchestrator refuses `--go` without one. For local convenience you can put
`export const TOKEN='…'` in `lib/secret.local.js` (gitignored). Tokens, the
`profiles/` session cookies, and the `data/` guest cache are all gitignored —
keep them out of version control.

**Browsers / headless:** `launch-clone.sh <profile> <port> headless [chrome|canary]`.
9223 = profile `chrome-ethereum`, **Google Chrome** (calendar + X); 9224 = profile
`canary-concurrence`, **Canary** (YouTube). Always relaunch headless before driving
(no focus steal); headless needs the Chrome-UA spoof (baked into the launcher).

The individual step scripts below are still directly invokable for debugging.

## The steps (sequential — one action each, with a result to check)

Do them in order. Each step is ONE thing; if its result isn't met, stop there.
Read-only unless marked **WRITE** (those have a confirm/ask gate). `<slug>` and
`<handle>` carry forward between steps.

1. **Find the next episode needing a link**
   - do: search Calendar for `slop.computer`; take the next upcoming event whose
     location is the `TODO` placeholder (not a real `live.slop.computer/…?invite=`).
   - result: `{title, date, time}` → e.g. *port dev, Thu Jun 18 9:30am*
   - `node workflows/find-next-slop.js`

2. **Get the guest's email**
   - do: open that event, read the guest (non-Austin) email.
   - result: an email → *port@example.com*
   - `node get-event-details.js "<title>" <Y/M/D>`

3. **Resolve the guest's X handle**
   - do: search + verify (I-follow / email=handle / name / org); auto-accept if
     score ≥ 5 & clear, else STOP & ask.
   - result: a verified `@handle` (or an explicit ask) → *@port_dev*
   - `node resolve-guest.js [todoIndex|title]`  (cached in `data/guest-twitter.json`)

4. **Slugify the handle → room slug**
   - do: map `@handle` → contract-valid `[a-z0-9-]` slug (underscore→hyphen).
   - result: a slug → *port-dev*
   - `lib/slugify.js` (used by steps 5)

5. **Find or create the room**  ·  WRITE (create is gated)
   - do: open admin, look for `/<slug>`; if missing, ASK Austin, then create.
   - result: room exists → *live.slop.computer/port-dev*
   - `node find-room.js <handle>` → if missing → `node create-room.js <handle>`

6. **Copy the room skill (get the API token)**
   - do: open room → `SLOP.COMPUTER` menu → "copy skill".
   - result: a `Bearer` token + skill URL → `/tmp/<slug>-skill.txt`
   - `node copy-skill.js <roomUrl>`

7. **Kick off guest research**  ·  WRITE (AI compute)
   - do: lookup `@handle` → research; poll until `phase:"done"`.
   - result: dossier = preview blurb + ~10 questions, live in the room.
   - `node kick-research.mjs <slug> @<handle>`

8. **Download the guest's PFP**
   - do: grab their X **profile-header** avatar; confirm the page name is the
     guest (NOT Austin's logged-in nav avatar).
   - result: an image → `/tmp/<handle>-pfp.jpg`
   - `node get-pfp.js <handle>`

9. **Generate the card from the PFP**  ·  WRITE (AI compute)
   - do: POST the pfp bytes → AI card gen; poll until done.
   - result: `card.png` exists → `/v1/cards/<slug>/card.png`
   - `node card-from-pfp.mjs <slug> /tmp/<handle>-pfp.jpg`

10. **Save & publish the unfurl**  ·  WRITE  ·  **pure API, no browser**
    - do: `POST /v1/card/publish?slug=<slug>` (server-side bake of the title
      overlay — added to slop-computer-live), then download `published.png`.
    - result: `published.png` exists AND `/tmp/<slug>card.png` downloaded; pasting
      `live.slop.computer/<slug>` unfurls with the titled card.
    - `node publish-card.mjs <slug> <bearerToken> /tmp/<slug>card.png`
    - fallback: `node save-card.js <slug> …` clicks the disk icon (client bake)
      only if you need pixel-exact WYSIWYG of a host's screen.

11. **Write room link + intro/questions back to the calendar**  ·  WRITE  ·  silent
    - do: open the event → prefix title `Slop.Computer: ` (idempotent) → set location
      to the real room link → rewrite description = **SLOP.COMPUTER** intro + room
      link + the host's common questions (fetched from the admin). Bold the headers.
      **ALWAYS save silently — never email the guest** ("Don't send").
    - result: title/location/description updated; guest NOT notified.
    - `node update-calendar-event.mjs --day <Y/M/D> --match "<title>" --link <roomLink> --token <bearer> [--save]`
      (no `--save` = dry run → `/tmp/event-edited.png`; add `--save` to commit silently)
    - bold is done by typing plain then selecting each header range + `execCommand('bold')`
      — Google Calendar enforces Trusted Types, so `insertHTML` is blocked.
    - Done for port: title prefixed, location = real invite, description set, no email.

12. **Schedule the YouTube broadcast**  ·  WRITE  ·  ✅  (idempotent)
    - `YT_HANDLE=.. YT_DATE=.. YT_TIME=.. node fill-yt-schedule.js [--submit]`
    - skips if `@handle` is already in the YouTube Upcoming list on that date.

13. **Schedule the X/Twitter livestream**  ·  WRITE  ·  ✅  (idempotent)
    - `X_HANDLE=.. X_DATE=.. X_TIME=.. X_DURATION_MIN=70 node x-schedule.mjs [--submit]`
    - skips if `@handle` is already in the X Producer scheduled list on that date.

14. **Register the episode on-chain**  ·  WRITE  ·  ✅  ·  **YOU sign the tx**  ·  LAST
    - `X_HANDLE=.. ONCHAIN_DATE=.. ONCHAIN_TIME=.. node schedule-onchain.mjs [--submit]`
    - skips if the slug already shows on `slop.computer/`. Else fills the SCHEDULE
      form's datetime and (with `--submit`) clicks **SCHEDULE EPISODE** → a wallet
      transaction pops up that **the user signs** (the script never signs / never
      touches the wallet password).
    - **datetime guard:** the script reads the field back and refuses to click
      SCHEDULE EPISODE unless it equals the target (e.g. `2026-06-18T09:30`) — so it
      can never fire a tx with an empty/wrong time (it did once; now guarded).

15. **Notify the guest on Telegram**  ·  manual send  ·  ✅  ·  LAST
    - `NOTIFY_HANDLE=.. NOTIFY_INVITE=<roomLink> node notify-guest.mjs [--link]`
    - copies the welcome blurb + room invite to the clipboard as ONE paste (blurb
      is a single line so Telegram soft-wraps it; the only newlines are before the
      link). **The user pastes & sends it** — never auto-sent (a private invite to a
      guessed Telegram contact is a misidentification risk).

Below: per-phase detail + the hard-won gotchas (auth, avatar selector, slug rule,
confidence threshold). The numbered list above is the canonical order.

## Detail — step 1: find the next episode  ✅ built, read-only
`node workflows/find-next-slop.js`
- Searches Calendar for `slop.computer`, parses upcoming episodes.
- An episode "needs a link" when its location is the TODO placeholder
  (`slop.computer/?(TODO…)`) rather than a real room (`live.slop.computer/<guest>?invite=…`).
- Returns the next one as JSON: `{title, date, timeRange, startISO, location}`.
- **Current result:** `port dev and Austin Griffith`, **Thu June 18, 9:30–10:30am**.
  (Then `Zak Cole`, same day 12pm.)

## Detail — steps 2–4: guest email, resolve X handle, slugify  ✅ built
**General orchestrator (any guest, fully auto):**
`node resolve-guest.js [todoIndex | titleSubstring]`  (default: next TODO)
- finds the TODO episode → opens the event → extracts the **guest email**
- **auto-derives verify-signals** from the event, all general; scored & ranked:
  - **I follow them** (+5, PRIMARY): the profile's button reads "Following" → you
    already follow them. You curate who you follow, so this is the strongest tell.
  - **email=handle** (+4): email local-part == X handle (`adrianleb@example.com` →
    `@adrianleb`). Works even for gmail where org/name fail.
  - **name-match** (+3): X display name contains the guest name (from the title).
  - **org** (+2): email *domain* → bio mention (`zak@example.com` →
    `numbergroup`; `port@example.com` → `monad`).
  - **>20 mutuals** (+2, BONUS): X profile "Followed by … and N others you follow".
  - **they follow me back** (+1, BONUS).

  **Decision (threshold-based — don't block when confident):**
  - score **≥ 5** with a clear winner → **AUTO-ACCEPT**, proceed & cache (no ask).
    (iFollow alone = 5; email=handle alone = 5; or e.g. name+org = 5.)
  - score **< 5** (low), or top two both ≥5 and within 1 pt (ambiguous), or nothing
    verified → **STOP & ask** Austin. `--force` re-resolves a cached guest.
  Highest score wins when several verify — this is what made **@0xzak** (you follow,
  ~1000 mutuals) beat the namesake **@zak_cole** (name only, you don't follow).
- resolves & verifies, caches to `data/guest-twitter.json`.
- Proven on: **port** (org=monad, beat @tweetsbyport decoy), **Zak Cole** (name;
  corroborated @0xzak via org; rejected @ZacCole_ the baseball coach), **Adrian**
  (email=handle, a generic gmail where name/org failed).
- Note: a guest can have >1 real account (Zak: @zak_cole vs @0xzak) — pick canonical.
- (Earlier I wrongly used "buidlguidl" as a signal — overfit to port; removed.)

**Lower-level pieces:** `get-event-details.js "<title>" <Y/M/D>` (dump one event);
`find-twitter.js "<query>" "<signals>"` (manual handle search); core in
`lib/resolve-twitter.js` (`resolveTwitter`, `deriveOrgSignal`).
- Runs the query in the user's **personalized, logged-in Google** (in the clone) —
  this surfaces the real person; the generic web-search API does NOT.
- Collects candidate X handles, opens each profile, and **verifies the bio against
  expected signals** (org from the email domain, known affiliations, "Follows you").
- Picks the candidate with a verified signal — **robust to namesake traps**.
- If nothing verifies → prints `UNCONFIRMED — STOP and ask Austin` (don't guess).
- Verified guests are cached in `data/guest-twitter.json` so we never re-derive.

**Resolved + cached:** `port@example.com` → **@port_dev** ("port 🦞",
*Developer Advocate @monad | merc @buidlguidl*). NOT `@tweetsbyport` (the Port.io
dev-portal **company** — the decoy that outranks the person on a generic search).

### Hard-won lessons baked into step 2
1. **Personalized Google in the clone >> generic web search.** The generic API never
   surfaced @port_dev; the user's logged-in Google ranked him #1.
2. **The profile clone carries ALL sessions** in that browser profile — Google *and*
   X — so we can read X (bios, "Follows you") as the user without a separate OAuth.
3. **Verify, don't trust rank.** The top "port dev twitter" hit is a different company
   (@tweetsbyport). Bio-verification against signals is what makes it correct.
4. **Stop-and-ask gate.** No verified candidate → halt for Austin, never guess
   (a wrong handle would land in a live podcast room link).

## Detail — step 5: find or create the live.slop.computer room  ✅ built
`node find-room.js <handle>`   (read-only check)
`node create-room.js <handle-or-slug>`   (WRITE — only after Austin confirms)
- **Slug = slugified handle.** `lib/slugify.js` maps `@port_dev` → `port-dev`
  (underscore→hyphen, `[a-z0-9-]`, no leading/trailing hyphen, ≤64).
- **Why not allow underscores?** The mainnet contract `SlopComputer.sol`
  (`0x5b44…76F3`, immutable) enforces `[a-z0-9-]` ON-CHAIN via `_isValidSlug`
  (reverts `SlugInvalid()`), and the contract's `liveSlug` field IS the room
  (`live.slop.computer/<liveSlug>`). A `port_dev` room would create on disk but
  could never be registered as an on-chain episode. So we slugify, not loosen.
- `find-room.js`: opens `live.slop.computer/admin` (clone is already authed as
  `austingriffith.eth`, host), lists rooms, checks for the slug. FOUND → proceed.
  NOT FOUND → emits the exact ask: *"I can't find a room with the name <slug> —
  create it, or a different name?"* and STOPS (no write).
- `create-room.js`: after confirmation, types the slug → fires the CREATE button's
  onClick (a plain Playwright click stalls on the relay overlay), captures the
  `?invite=…` link, verifies the room appears. Defensively slugifies its input.
- Done for **port**: created `https://live.slop.computer/port-dev?invite=…`.

## Detail — steps 6–10: skill, research, pfp, card, unfurl  ✅ built
Auth for all room API calls: `Authorization: Bearer <token>` — host-scoped,
7-day, locked to the slug. Token comes from "copy skill".
- **copy-skill.js** — open room → `SLOP.COMPUTER` menu (top-left) → "copy skill";
  captures the token-scoped skill URL (the room's agent API doc). Saved to
  `/tmp/<slug>-skill.txt`. Fetch it for the full endpoint reference.
- **Research** — `kick-research.mjs <slug> @handle`: `POST /v1/guest-lookup`
  (`{query:"@handle"}`, auto-fills name+socials, even finds GitHub) → `POST
  /v1/guest-research` (`{name, socials, notes}`) → poll `state.researchState`
  until `phase:"done"` → dossier = preview blurb + ~10 interview questions.
- **PFP → card** — `get-pfp.js <handle>`: downloads the guest's X avatar. MUST
  target the profile-header avatar (`a[href="/<handle>/photo"] img`) and confirm
  the page name — else it grabs the logged-in user's (Austin's) nav avatar.
  Then `card-from-pfp.mjs <slug> <img>`: `POST /v1/card` (raw image bytes) →
  AI-generates the room card → `/v1/cards/<slug>/card.png`.
- **Save unfurl** — `publish-card.mjs <slug> <token> <out>`: **pure API** —
  `POST /v1/card/publish` (server-side bake, added to slop-computer-live: the
  relay renders the title overlay with pureimage + Silkscreen, matching the
  client look), then downloads `/v1/cards/<slug>/published.png`. This is the
  **Twitter/OG unfurl image** uploaded to YT/X when scheduling. Done for port:
  `/tmp/portdevcard.png`. (Legacy: `save-card.js` clicks the disk icon for a
  client-side WYSIWYG bake — fallback only.)
  - slop-computer-live change shipped: `packages/relay/src/card-bake.ts` +
    `POST /v1/card/publish` endpoint + skill doc (`28bca89`, deployed).

Related code change (shipped): card title DEFAULT position lives in
`slop-computer-live` `CardWindow.tsx` `DEFAULT_TITLE_POS` — set to `{x:0.525,
y:0.838}` (up-and-right of bottom-center) and deployed (`f2982ce`). Title
position itself is WS-only (`card_title`), not REST.

## Detail — step 11: schedule + write back
- **Calendar write-back** — `update-calendar-event.mjs --day <YYYY-MM-DD>
  --match <text> --link <url> --token <relay-tok> [--save]`. Replaces the
  `TODO` link with the real room link, prepends the SLOP.COMPUTER blurb +
  server-stored common-questions (bold header via type-plain-then-select-
  range-then-`execCommand('bold')`, because Trusted Types blocks insertHTML).
  **ALWAYS clicks "Don't send"** — guests are never emailed.

## Detail — step 12: schedule the YouTube broadcast  ✅
`fill-yt-schedule.js` drives YouTube Studio → Live → **Schedule Stream → Create
new** and fills the whole "Create stream" wizard, then **STOPS before "Done"**
(left up for human review — never auto-submits). Fields, in order:
- title `Slop.Computer with @<handle> (and co-host @clawdbotatg)` (fill + Escape
  to dismiss the @-mention popup)
- description = research dossier `socialsDesc` (pulled live from
  `/v1/state?slug=<slug>`) (fill + Escape)
- made-for-kids = **No**
- **Show more** (`getByText('Show more')` — not a role=button)
- thumbnail = `/tmp/<slug>card.png` via
  `ytcp-thumbnails-compact-editor input[type=file]` `setInputFiles`
- playlist = **Slop.Computer** (`[aria-label="Select playlists"]` → option → Done)
- category = **Science & Technology** — see gotcha below
- Next → Next → visibility = **Public**
- schedule date (native value-setter on the date input) + time
  (click → type → **select the dropdown option** to commit; typing alone reverts)

### Category gotcha (the one that fought back)
The category `ytcp-select` would not open via any Playwright element click
(`.click()`, `force:true`, role/text locators all stalled). What works:
**coordinate-click** the trigger box (compute `getBoundingClientRect` in
`page.evaluate`, then `page.mouse.click`), retry up to 4× until the option
appears in the DOM, then `force`-click `tp-yt-paper-item[role="option"]`
filtered by text. **Critical:** the *playlist* popup from the previous step
stays open and swallows the category click — press **Escape first** to dismiss
it. (Recon: `recon-category.js`.)

## Detail — step 13: schedule the X/Twitter livestream  ✅
`x-schedule.mjs` drives **X Media Studio → Producer → Create broadcast** on the
**9223 clone** (Chrome with the user's X login). Env inputs:
`X_HANDLE X_DATE X_TIME X_DURATION_MIN` (default 70); `--submit` to actually
create. Fields, in order:
- broadcast name = `episode(handle).title` (same as YouTube)
- category = **Technology** (typeahead `Add Category`; keyboard fallback)
- source = **Slop.Computer** — set via the underlying native `<select>`
  (`selectOption({label})`); the visible "Select a source" button is just a skin
- audience = Public (default), chat = Verified accounts (default)
- schedule = **Start later** → Starts/Ends. Each datetime field is a `<button>`
  that opens a calendar popup — **you cannot type raw text into it**; pick the
  day via `.Calendar-day.is-selectable` (best-effort month/year via the picker's
  `<select>`s first), but the **time** sub-field IS a typeable `input.TimePicker`
  (fill `'9:00 AM'`). End = start + duration (computed).
- poster image = `/tmp/<slug>card.png` via the hidden `input[type=file]`

### ☠️ THE BIG X GOTCHA (cost us a deletion)
Clicking **Create broadcast** *immediately creates and persists* the broadcast.
The panel that opens afterward is for OPTIONAL extra settings, and its
**Cancel / Escape DELETES the broadcast** ("Broadcast deleted" toast). To finish,
**navigate away** (reload `/producer`) — never Cancel/Escape. `x-schedule.mjs`
does this and confirms the row survived the reload. (Save is only enabled if you
actually changed something post-create.)

Note: tested **headed** (the user wanted to watch). For unattended runs launch
9223 **headless** (`launch-clone.sh <profile> 9223 headless chrome`) — the UA
spoof should satisfy X Studio like it does YouTube, but verify.

## Detail — step 14: register on-chain (slop.computer)  ✅  · LAST · user signs
`schedule-onchain.mjs` runs on the **9223 clone** (Chrome with **austingriffith.eth
wallet connected**). Env: `X_HANDLE ONCHAIN_DATE ONCHAIN_TIME`; `--submit` to act.
**This is the ONE step that must run against a HEADED 9223** — the user signs the
wallet popup, which a headless window can't show. Relaunch headed first:
`bash launch-clone.sh "$PWD/profiles/chrome-ethereum" 9223 headed chrome`. And while
the signature is pending, don't run any other automation against 9223 (it can drop
the CDP session and disrupt signing).
1. **Idempotency:** load `slop.computer/` — if the slug already appears (scheduled
   episodes are listed there, e.g. "ADRIANLEB · GOING LIVE MON, JUN 15, 9:00 AM
   MT"), **SKIP** (no duplicate, no tx).
2. Else open `slop.computer/admin?liveSlugToSchedule=<slug>` (the `[schedule]`
   link from `live.slop.computer/admin` points here). The **SCHEDULE** section is
   pre-filled with the slug + a `datetime-local` input. Set it to the episode time
   (`"Jun 15, 2026"`+`"9:00 AM"` → `2026-06-15T09:00`) via the native value setter.
3. With `--submit`: click **SCHEDULE EPISODE** → **a wallet transaction pops up that
   the USER signs** in their browser. The script STOPS there — it never signs, never
   enters a wallet password. After signing, the episode appears on `slop.computer/`.

## Running WITHOUT stealing focus  ✅
`launch-clone.sh <profile> <port> [headed|headless]`:
- **headless** (default for prod runs): `--headless=new` — no window exists, so
  nothing can ever grab your keyboard. **Must** spoof a normal Chrome UA
  (`--user-agent=...Chrome/151...`) + `--window-size=1366,900`, else YouTube
  Studio rejects "HeadlessChrome" as an *unsupported browser* and renders a
  warning page instead of the wizard.
- **headed**: `open -n -g` launches in the macOS background — but note that as
  soon as the automation creates a tab / navigates, Chrome **raises that window
  to the foreground** and steals focus. So headed is only safe for a window you
  never drive after launch. For unattended driving, **use headless.**

Watch a headless run live: every `step()` writes `/tmp/slop-live.png`; serve
`/tmp` **bound to loopback only** and open
`http://localhost:8899/slop-watch.html` (auto-refreshing screenshot viewer):

```bash
python3 -m http.server 8899 --bind 127.0.0.1 --directory /tmp >/tmp/slop-httpd.log 2>&1 &
echo $! >/tmp/slop-httpd.pid          # remember the PID so you can stop it
```

⚠️ **Never omit `--bind 127.0.0.1`.** Python's `http.server` defaults to
`0.0.0.0`, which would expose all of `/tmp` (a shared scratch dir where other
tools drop tokens/keys) to **everyone on the LAN**, unauthenticated. Loopback
keeps it local.

**Tear it down when the run ends** — it does not stop itself:
`kill "$(cat /tmp/slop-httpd.pid)" 2>/dev/null` (or `pkill -f 'http.server 8899'`).
