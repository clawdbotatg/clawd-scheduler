#!/usr/bin/env bash
# Launch a Canary clone for CDP automation, WITHOUT stealing focus.
#   launch-clone.sh <profile-dir> <port> [headed|headless]
# - headless: no window at all (best for unattended background runs)
# - headed:   a real window, but launched in the macOS background (open -n -g)
#             so it never comes to the foreground or grabs your keyboard.
set -uo pipefail
PROFILE="${1:?profile dir}"; PORT="${2:?port}"; MODE="${3:-headed}"
# 4th arg picks the browser binary: "canary" (default) or "chrome".
APP="Google Chrome Canary"; [ "${4:-canary}" = "chrome" ] && APP="Google Chrome"
BIN="/Applications/$APP.app/Contents/MacOS/$APP"

lsof -ti:"$PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 2

if [ "$MODE" = "headless" ]; then
  # Spoof a normal Chrome UA + desktop window — else YouTube Studio rejects
  # "HeadlessChrome" as an unsupported browser.
  UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
  nohup "$BIN" --headless=new --user-agent="$UA" --window-size=1366,900 \
    --user-data-dir="$PROFILE" --remote-debugging-port="$PORT" \
    --no-first-run --no-default-browser-check >"/tmp/clone-$PORT.log" 2>&1 &
else
  # Headed = a REAL visible window (this is where the user signs wallet popups).
  # Launch the binary DIRECTLY, NOT via `open -g`: an `open`-launched Chrome exposes
  # a CDP browser endpoint that rejects Playwright context management
  # (Browser.setDownloadBehavior -> "Browser context management is not supported"),
  # which breaks chromium.connectOverCDP() in schedule-onchain.mjs. A direct-binary
  # launch gives a clean endpoint Playwright can drive. UA spoof kept for parity.
  UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
  nohup "$BIN" --user-agent="$UA" --window-size=1366,900 \
    --user-data-dir="$PROFILE" --remote-debugging-port="$PORT" \
    --no-first-run --no-default-browser-check --hide-crash-restore-bubble about:blank \
    >"/tmp/clone-$PORT.log" 2>&1 &
fi

for i in $(seq 1 40); do
  curl -fs "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 && { echo "✓ $PORT up ($MODE)"; exit 0; }
  sleep 0.5
done
echo "✗ $PORT did not come up ($MODE) — see /tmp/clone-$PORT.log"; exit 1
