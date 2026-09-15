#!/bin/bash
# Install/refresh the slop signer page server (com.clawd.slop-signer), KeepAlive
# on http://127.0.0.1:8790/. One machine only (the one Austin opens the page on).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL=com.clawd.slop-signer
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
    <string>$HERE/signer-server.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$HERE</string>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HERE/.showtime-state/signer.log</string>
  <key>StandardErrorPath</key><string>$HERE/.showtime-state/signer.log</string>
</dict></plist>
PLIST
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
sleep 1
curl -sf http://127.0.0.1:8790/api/health >/dev/null && echo "installed $LABEL — http://127.0.0.1:8790/ is up" || echo "installed $LABEL but /api/health not answering yet — check $HERE/.showtime-state/signer.log"
