---
description: Run the full slop.computer episode-scheduling playbook for the next un-booked call
---

okay there is a call tomorrow that isn't scheduled yet and we need to run through the full playbook -- please do it headless when possible so you don't steal my browser away and ask questions as you need :)

---

Reference: this repo's `CLAUDE.md` + `SLOP-WORKFLOW.md` are the canonical playbook.
Always run from `~/clawd/clawd-scheduler` (the live working copy with `profiles/`,
`data/`, `.env`), NOT the harness clone. Stay headless for every phase except the
on-chain signing step (the user must see + sign the wallet popup), then revert to
headless immediately. Idempotent — re-running never double-books.
