#!/bin/bash
# Launch the headless chrome-x clone that read-x.js drives over CDP.
# Matches the relaunch command embedded in clawd-twitter/scripts/read-x.js.
PORT="${1:-9223}"
PROFILE="$HOME/clawd/clawd-scheduler/profiles/chrome-x"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --user-agent="$UA" \
  --window-size=1366,900 --user-data-dir="$PROFILE" \
  --remote-debugging-port="$PORT" \
  --no-first-run --no-default-browser-check
