# clawd-scheduler

Deterministic, local browser automation that sets up a [slop.computer](https://slop.computer)
podcast episode end-to-end — from a calendar entry to a scheduled YouTube broadcast.

Instead of fragile vision/extension "computer use", it **launches Chrome with a
profile you own** (logged in once, manually) and drives it over the DevTools
protocol with Playwright. Runs **headless** so it never steals your keyboard focus.

## What it does

One command walks the whole pipeline, gating every write/judgment step:

```
resolve guest X handle → find/create their live room → kick AI research →
download pfp → generate + publish the episode card → write the room link &
intro back to the calendar (silently) → schedule the YouTube broadcast
```

## Setup

```
npm install
cp .env.example .env        # then fill in SLOP_TOKEN (a per-room relay token)
```

Profiles live in `profiles/<name>/` (gitignored — they hold live session
cookies). Log into each once, manually; the session persists for future runs.
`launch-clone.sh <profile> <port> headless [chrome|canary]` starts a headless
clone for automation.

## Run

```
# see the full plan — safe, runs nothing:
node slop-episode.mjs --handle <x> --token <roomToken> --date 'Jun 18, 2026' --time '9:30 AM'

# execute, opting past each human checkpoint explicitly:
node slop-episode.mjs --handle <x> --token <roomToken> --date '..' --time '..' \
    --invite '..' --go [--create-room] [--pfp-ok] [--save-calendar] [--submit-youtube]
```

Each phase is also directly invokable for debugging. Full step-by-step docs,
gotchas, and the per-room-token explanation are in **[SLOP-WORKFLOW.md](./SLOP-WORKFLOW.md)**.

## Secrets

Nothing sensitive is committed. The relay token, browser session cookies
(`profiles/`), and the guest cache (`data/`) are all gitignored. Secrets go in
`.env` (see `.env.example`); per-room tokens come from `node copy-skill.js '<inviteUrl>'`.
