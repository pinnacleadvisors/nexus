#!/bin/bash
# Managed claudecodeui launch for the Mac mini (the /code chat engine, ADR 013).
# Invoked by the LaunchAgent com.workforce.claudecodeui. Serves the PREBUILT
# bundle on :3010 (loopback) — config comes from ~/Dev/claudecodeui/.env
# (SERVER_PORT=3010, HOST=127.0.0.1). cloudflared reaches it via
# host.docker.internal:3010 and publishes it at code.coolifycloudtunnel.uk.
#
# After pulling a new claudecodeui version, rebuild manually before the next
# launch:  cd ~/Dev/claudecodeui && npm install && npm run build
set -uo pipefail

# PATH must include node/npm AND the `claude` CLI (nvm bin) — claudecodeui
# drives the host `claude` CLI for chats.
export PATH="/Users/dylan_mini/.nvm/versions/node/v24.8.0/bin:/usr/local/bin:/opt/homebrew/bin:/Users/dylan_mini/.local/bin:/usr/bin:/bin"

LOG="/Users/dylan_mini/Dev/claudecodeui/claudecodeui.log"
cd /Users/dylan_mini/Dev/claudecodeui || exit 1

echo "$(date '+%Y-%m-%dT%H:%M:%S') [run-claudecodeui] starting on :3010" >> "$LOG"
exec npm run server >> "$LOG" 2>&1
