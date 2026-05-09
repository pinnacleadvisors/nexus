#!/usr/bin/env bash
# Boot script for the Codex CLI gateway.
#
# 1. Refresh the Nexus repo at $NEXUS_REPO_PATH so .claude/agents/<slug>.md
#    specs are current. Skips cloning if a path was bind-mounted in.
# 2. Sanity-check the codex CLI is authenticated.
# 3. Hand off to the Node HTTP server.
set -euo pipefail

REPO_PATH="${NEXUS_REPO_PATH:-/repo}"
REPO_URL="${NEXUS_REPO_URL:-}"
REPO_REF="${CODEX_GATEWAY_REPO_REF:-main}"

if [ -d "$REPO_PATH/.git" ]; then
  echo "[codex-gw] refreshing repo at $REPO_PATH ($REPO_REF)"
  git -C "$REPO_PATH" fetch --depth 1 origin "$REPO_REF" || true
  git -C "$REPO_PATH" checkout -q "$REPO_REF" || true
  git -C "$REPO_PATH" reset --hard "origin/$REPO_REF" || true
elif [ -n "$REPO_URL" ]; then
  echo "[codex-gw] cloning $REPO_URL ($REPO_REF) into $REPO_PATH"
  git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$REPO_PATH"
else
  echo "[codex-gw] no NEXUS_REPO_URL set and $REPO_PATH is empty — agent specs will be unavailable"
  mkdir -p "$REPO_PATH/.claude/agents"
fi

# Codex CLI auth — three accepted modes, in order of preference:
#   1. CODEX_AUTH_JSON           → Plan-billed (drains ChatGPT Pro/Plus plan),
#                                   non-interactive. Generate once on a dev
#                                   machine with `codex login`, then
#                                   `cat ~/.codex/auth.json` and paste the file
#                                   contents into Doppler/Coolify. This is the
#                                   recommended path for headless containers
#                                   (no `docker exec -it codex login` needed).
#                                   Bootstrap-only: skipped if /root/.codex
#                                   already has an auth.json — codex refreshes
#                                   tokens in-place on the persistent volume,
#                                   so we don't clobber the latest version on
#                                   restart. Set CODEX_AUTH_JSON_FORCE=1 to
#                                   overwrite (use after the env var is updated
#                                   with a fresh `codex login` payload).
#   2. CODEX_API_KEY             → Pay-per-token API billing fallback.
#   3. /root/.codex/auth.json    → Persistent volume populated by
#                                   `docker exec -it ... codex login`. Legacy
#                                   approach — required terminal access.
if [ -n "${CODEX_AUTH_JSON:-}" ]; then
  if [ -f /root/.codex/auth.json ] && [ "${CODEX_AUTH_JSON_FORCE:-0}" != "1" ]; then
    echo "[codex-gw] /root/.codex/auth.json already exists — keeping volume version (set CODEX_AUTH_JSON_FORCE=1 to overwrite)."
  else
    mkdir -p /root/.codex
    printf '%s' "$CODEX_AUTH_JSON" > /root/.codex/auth.json
    chmod 600 /root/.codex/auth.json
    echo "[codex-gw] Hydrated /root/.codex/auth.json from CODEX_AUTH_JSON (plan-billed, non-interactive)."
  fi
  # Force plan-billed: drop API-key vars so the spawned codex CLI doesn't
  # silently route to per-token billing once the OAuth token is in place.
  unset CODEX_API_KEY OPENAI_API_KEY
elif [ -n "${CODEX_API_KEY:-}" ]; then
  echo "[codex-gw] Using CODEX_API_KEY (pay-per-token API billing)."
elif [ -d "/root/.codex" ] && [ -n "$(ls -A /root/.codex 2>/dev/null || true)" ]; then
  echo "[codex-gw] Using credentials from /root/.codex (persistent volume)."
else
  echo "[codex-gw] WARNING: codex CLI is not authenticated."
  echo "[codex-gw] Best fix: set CODEX_AUTH_JSON in env. Generate on a dev machine:"
  echo "[codex-gw]   1. codex login   (browser OAuth)"
  echo "[codex-gw]   2. cat ~/.codex/auth.json   (paste contents into Doppler/Coolify as CODEX_AUTH_JSON)"
  echo "[codex-gw] Alternative: set CODEX_API_KEY for pay-per-token API billing."
  echo "[codex-gw] Legacy: 'docker exec -it <container> codex login' with /root/.codex mounted as a persistent volume."
fi

exec node /app/dist/index.js
