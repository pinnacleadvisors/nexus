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

# Claude CLI auth — three accepted modes, in order of preference:
#   1. CLAUDE_CODE_OAUTH_TOKEN      → Max plan billing, non-interactive.
#                                      Generate once on a dev machine with
#                                      `claude setup-token` and paste into
#                                      Doppler. This is the recommended path
#                                      for headless containers (no terminal
#                                      access needed for `claude login`).
#   2. ANTHROPIC_API_KEY            → API-key billing fallback. Pay-per-token.
#   3. /root/.claude/.credentials.json → Persistent volume, populated by
#                                      `claude login` exec'd into the
#                                      container. Legacy approach — required
#                                      a working terminal.
if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  echo "[gateway] Using CLAUDE_CODE_OAUTH_TOKEN (Max plan, non-interactive)."
elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo "[gateway] Using ANTHROPIC_API_KEY (API billing)."
elif [ -d "/root/.claude" ] && [ -n "$(ls -A /root/.claude 2>/dev/null || true)" ]; then
  echo "[gateway] Using credentials from /root/.claude (persistent volume)."
else
  echo "[gateway] WARNING: claude CLI is not authenticated."
  echo "[gateway] Best fix: set CLAUDE_CODE_OAUTH_TOKEN in env. Generate with 'claude setup-token' on a dev machine."
  echo "[gateway] Alternative: set ANTHROPIC_API_KEY for API-billing fallback."
  echo "[gateway] Legacy: 'claude login' inside this container with /root/.claude mounted as a persistent volume."
fi

exec node /app/dist/index.js
