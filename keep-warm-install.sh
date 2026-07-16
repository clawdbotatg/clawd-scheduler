#!/usr/bin/env bash
# Install the launchd job that runs keep-warm.mjs every 4 hours (+ at boot).
#   bash keep-warm-install.sh            # install/update + kickstart
#   bash keep-warm-install.sh uninstall
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL=com.clawd.keepwarm
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$(command -v node || echo /opt/homebrew/bin/node)"

if [ "${1:-}" = "uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✓ $LABEL uninstalled"
  exit 0
fi

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$HERE/keep-warm.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$HERE</string>
  <key>StartInterval</key><integer>14400</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/tmp/keepwarm.log</string>
  <key>StandardErrorPath</key><string>/tmp/keepwarm.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "✓ $LABEL installed — every 4h + at login (log: /tmp/keepwarm.log)"
echo "  run now:  launchctl kickstart gui/$(id -u)/$LABEL"
