#!/bin/bash
# Managed Paperclip launch for the Mac mini (the /workforce engine).
# Invoked by the LaunchAgent com.workforce.paperclip. Serves the embedded-PG-backed
# paperclip on 127.0.0.1:3100 (loopback). ALL state (DB + config + companies/agents/
# skills + any provider keys paperclip stores) lives inside the single data dir, so
# the install is just `npx paperclipai@latest run -d <data>` — no separate DB.
#
# Nexus reaches it from inside the OrbStack container via host.docker.internal:3100
# (the /workforce proxy default PAPERCLIP_API_BASE), so no Nexus env change is needed.
#
# Account-agnostic on purpose: everything is $HOME-relative and `node` is resolved
# dynamically. Do NOT hardcode a node version path — that is exactly what crash-looped
# the claudecodeui agent across accounts (dylan_mini had node v24.8.0, nexus-host
# v24.16.0, the hardcoded path exited 127). See docs/runbooks/paperclip-cutover.md.
set -uo pipefail

# Resolve node/npx + the `claude` CLI dynamically. Prefer the newest installed nvm
# node, then homebrew, then system. paperclip drives the host `claude` CLI for agents,
# so its bin dir must be on PATH too (npm-global lives in the node bin dir / ~/.local/bin).
NODE_BIN=""
if [ -d "$HOME/.nvm/versions/node" ]; then
  NODE_BIN="$(/bin/ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
fi
export PATH="${NODE_BIN:+$NODE_BIN:}/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin"

DATA="$HOME/Dev/workforce-lab/paperclip-data"
LOG="$HOME/Dev/workforce-lab/paperclip.log"

if ! command -v npx >/dev/null 2>&1; then
  echo "$(date '+%Y-%m-%dT%H:%M:%S') [run-paperclip] FATAL: npx not found. PATH=$PATH" >> "$LOG"
  exit 127
fi
if [ ! -d "$DATA" ]; then
  echo "$(date '+%Y-%m-%dT%H:%M:%S') [run-paperclip] FATAL: data dir missing: $DATA (rsync it from dylan_mini first)" >> "$LOG"
  exit 1
fi

cd "$HOME/Dev/workforce-lab" || exit 1
echo "$(date '+%Y-%m-%dT%H:%M:%S') [run-paperclip] starting on :3100 (data=$DATA, node=${NODE_BIN:-system})" >> "$LOG"
exec npx --yes paperclipai@latest run -d "$DATA" >> "$LOG" 2>&1
