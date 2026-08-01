#!/bin/bash
# Install/refresh the showtime auto-arm launchd job (com.clawd.slop-showtime).
# Runs showtime-arm.mjs every 5 minutes; it exits instantly unless an episode
# starts within the lead window, in which case it stays alive through go-live
# and auto-stop. Logs: ~/clawd/clawd-scheduler/.showtime-state/launchd.log
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL=com.clawd.slop-showtime
PLIST=~/Library/LaunchAgents/$LABEL.plist
NODE="$(command -v node)"
mkdir -p "$HERE/.showtime-state"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$NODE</string>
    <string>$HERE/showtime-arm.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$HERE</string>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HERE/.showtime-state/launchd.log</string>
  <key>StandardErrorPath</key><string>$HERE/.showtime-state/launchd.log</string>
</dict></plist>
PLIST
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "installed $LABEL (every 5 min). log: $HERE/.showtime-state/launchd.log"
