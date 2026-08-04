#!/bin/bash
# One-time (or session-refresh) login window for the chrome-x profile.
# Opens a visible Chrome on the X login page using the SAME profile the
# headless clone uses. Log in, close the window, then start the clone.
# NOTE: the headless clone must NOT be running at the same time (one
# profile dir = one Chrome). Stop it first: launchctl bootout gui/$UID/com.clawd.chrome-x-clone 2>/dev/null
PROFILE="$HOME/clawd/clawd-scheduler/profiles/chrome-x"
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$PROFILE" \
  --no-first-run --no-default-browser-check \
  "https://x.com/login"
