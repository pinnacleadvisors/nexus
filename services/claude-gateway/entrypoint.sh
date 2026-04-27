#!/usr/bin/env bash
# Boot script for the Claude Code gateway.
#
# 1. Refresh the Nexus repo at $NEXUS_REPO_PATH so .claude/agents/<slug>.md
#    specs are current. Skips cloning if a path was bind-mounted in.
# 2. Sanity-check the claude CLI is authenticated.
# 3. Hand off to the Node HTTP server.
set -euo pipefail

REPO_PATH="${NEXUS_REPO_PATH:-/repo}"
REPO_URL="${NEXUS_REPO_URL:-}"
REPO_REF="${CLAUDE_GATEWAY_REPO_REF:-main}"

if [ -d "$REPO_PATH/.git" ]; then
  echo "[gateway] refreshing repo at $REPO_PATH ($REPO_REF)"
  git -C "$REPO_PATH" fetch --depth 1 origin "$REPO_REF" || true
  git -C "$REPO_PATH" checkout -q "$REPO_REF" || true
  git -C "$REPO_PATH" reset --hard "origin/$REPO_REF" || true
elif [ -n "$REPO_URL" ]; then
  echo "[gateway] cloning $REPO_URL ($REPO_REF) into $REPO_PATH"
  git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$REPO_PATH"
else
  echo "[gateway] no NEXUS_REPO_URL set and $REPO_PATH is empty — agent specs will be unavailable"
  mkdir -p "$REPO_PATH/.claude/agents"
fi

if [ ! -d "/root/.claude" ] || [ -z "$(ls -A /root/.claude 2>/dev/null || true)" ]; then
  echo "[gateway] WARNING: /root/.claude is empty — claude CLI is not logged in."
  echo "[gateway] Run 'claude login' once with this volume mounted, then restart."
fi

exec node /app/dist/index.js
