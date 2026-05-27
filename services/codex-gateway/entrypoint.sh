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

# Self-heal /repo: if a previous boot wrote .claude/agents/ via the "no
# NEXUS_REPO_URL" branch (or anything left non-git contents in the volume),
# git clone refuses with "destination path already exists and is not empty".
# Wipe the volume contents so clone can proceed.
if [ ! -d "$REPO_PATH/.git" ] && [ -d "$REPO_PATH" ] && [ -n "$(ls -A "$REPO_PATH" 2>/dev/null || true)" ]; then
  echo "[codex-gw] $REPO_PATH is non-empty but not a git repo — wiping for fresh clone"
  find "$REPO_PATH" -mindepth 1 -delete 2>/dev/null || true
fi

if [ -d "$REPO_PATH/.git" ]; then
  echo "[codex-gw] refreshing repo at $REPO_PATH ($REPO_REF)"
  git -C "$REPO_PATH" fetch --depth 1 origin "$REPO_REF" || true
  git -C "$REPO_PATH" checkout -q "$REPO_REF" || true
  git -C "$REPO_PATH" reset --hard "origin/$REPO_REF" || true
elif [ -n "$REPO_URL" ]; then
  echo "[codex-gw] cloning $REPO_URL ($REPO_REF) into $REPO_PATH"
  # Clone needs the destination to be missing or empty. Mounted volumes
  # start as empty directories — git clone is fine writing into them.
  git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$REPO_PATH" || {
    echo "[codex-gw] WARNING: git clone failed — continuing without agent specs"
    mkdir -p "$REPO_PATH/.claude/agents"
  }
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
  # ── CODEX_AUTH_JSON corruption guard ────────────────────────────────────
  # Validate the env var IS valid JSON before writing. The 2026-05-27 incident
  # had two concatenated objects (}{ in the middle) — the file wrote fine,
  # but every codex CLI invocation failed with "trailing characters at line N
  # column 2". The synchronous chat endpoint returns 502 to clients; Cloudflare
  # often wraps it in its own error page, hiding the actual CLI error.
  #
  # Best-effort recovery: if the env var contains two concatenated objects
  # (a single `}{` separator with whitespace optional), keep only the first
  # complete object. The first one is almost always the freshest paste — the
  # second is a remnant from a prior auth.json that wasn't cleared. Log loud
  # so the operator can rotate the Doppler secret to match.
  #
  # If the env var fails to parse as JSON at all, refuse to overwrite the
  # volume version — better to keep the old creds working than poison the
  # gateway with garbage.
  AUTH_VALID=1
  if ! printf '%s' "$CODEX_AUTH_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{JSON.parse(s);process.exit(0)}catch{process.exit(1)}})' 2>/dev/null; then
    AUTH_VALID=0
    DOUBLE_OBJ=$(printf '%s' "$CODEX_AUTH_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const m=s.match(/\}\s*\{/);process.stdout.write(m?String(m.index):"")})' 2>/dev/null || true)
    if [ -n "$DOUBLE_OBJ" ]; then
      RECOVERED=$(printf '%s' "$CODEX_AUTH_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{let d=0,end=-1;for(let i=0;i<s.length;i++){if(s[i]==="{")d++;else if(s[i]==="}"){d--;if(d===0){end=i;break}}}if(end<0){process.exit(2)}const cand=s.slice(0,end+1);try{JSON.parse(cand);process.stdout.write(cand);process.exit(0)}catch{process.exit(3)}})' 2>/dev/null || true)
      if [ -n "$RECOVERED" ]; then
        echo "[codex-gw] WARNING: CODEX_AUTH_JSON contained TWO concatenated objects (}{ at byte $DOUBLE_OBJ). Auto-recovered the first one. Rotate the Doppler secret with the output of \`cat ~/.codex/auth.json\` from a fresh \`codex login\` to silence this warning."
        CODEX_AUTH_JSON="$RECOVERED"
        AUTH_VALID=1
      fi
    fi
  fi
  if [ "$AUTH_VALID" != "1" ]; then
    echo "[codex-gw] WARNING: CODEX_AUTH_JSON is not valid JSON. NOT writing /root/.codex/auth.json. Run \`codex login\` on a dev machine and paste \`cat ~/.codex/auth.json\` into Doppler as CODEX_AUTH_JSON, then redeploy with CODEX_AUTH_JSON_FORCE=1."
  elif [ -f /root/.codex/auth.json ] && [ "${CODEX_AUTH_JSON_FORCE:-0}" != "1" ]; then
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

  # ── /root/.codex/auth.json validation guard ─────────────────────────────
  # Even when the env var was clean, the persistent volume's file might be
  # corrupt from a prior boot. Validate it now so a /health probe AFTER boot
  # surfaces the real cause instead of every chat-route call quietly 502ing.
  if [ -f /root/.codex/auth.json ]; then
    if ! node -e 'const fs=require("fs");try{JSON.parse(fs.readFileSync("/root/.codex/auth.json","utf8"));process.exit(0)}catch(e){console.error(e.message);process.exit(1)}' 2>&1; then
      echo "[codex-gw] FATAL: /root/.codex/auth.json on the volume is malformed JSON. Every dispatch will return 502 until rotated. Delete the volume + redeploy with CODEX_AUTH_JSON_FORCE=1, OR set CODEX_AUTH_JSON_FORCE=1 + redeploy to overwrite from env."
    fi
  fi
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
