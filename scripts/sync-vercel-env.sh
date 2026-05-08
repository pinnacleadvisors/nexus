#!/usr/bin/env bash
# Push selected Doppler secrets into Vercel's production env.
#
# Vercel serverless functions read process.env from the Vercel project's
# stored env vars — NOT from Doppler at runtime. The Doppler-Vercel
# integration usually syncs them automatically; when it isn't set up (or
# is in manual mode), this script bridges the gap from the CLI.
#
# Usage:
#   doppler run -- bash scripts/sync-vercel-env.sh           # push the curated list
#   doppler run -- bash scripts/sync-vercel-env.sh COOLIFY_BASE_URL FOO  # push specific names
#
# Required env (from Doppler):
#   VERCEL_TOKEN          — vercel.com/account/tokens (full-scope)
#   VERCEL_TEAM_ID        — optional, when the project lives under a team
#   VERCEL_PROJECT        — project name as in the Vercel dashboard, e.g. "nexus"
#
# Required tools:
#   vercel CLI (npx fallback used if not on PATH)
#   doppler   (you're already running this through doppler)

set -euo pipefail

if [ -t 1 ]; then
  G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; X=$'\033[0m'
else
  G= R= Y= X=
fi
ok()   { printf '%s✓%s %s\n' "$G" "$X" "$1"; }
warn() { printf '%s⚠%s %s\n' "$Y" "$X" "$1"; }
err()  { printf '%s✘%s %s\n' "$R" "$X" "$1" >&2; }

# Curated default list — secrets that the platform code reads at runtime
# but that aren't part of the original Vercel-project env. Add to this list
# as new env vars are introduced.
DEFAULT_NAMES=(
  COOLIFY_BASE_URL
  COOLIFY_API_TOKEN
  COOLIFY_PROJECT_ID_NEXUS_BUSINESSES
  COOLIFY_KVM4_SERVER_UUID
  NEXUS_OPS_TOKEN
  NEXUS_BUSINESS_IMAGE_REPO
  COMPOSIO_API_KEY
  DISABLE_PER_BUSINESS_GATEWAY
  BUSINESS_GATEWAY_BYPASS_SLUGS
)

# Names: CLI args win over the curated list.
if [ "$#" -gt 0 ]; then
  NAMES=("$@")
else
  NAMES=("${DEFAULT_NAMES[@]}")
fi

: "${VERCEL_TOKEN:?VERCEL_TOKEN missing — set via Doppler or shell env}"
project="${VERCEL_PROJECT:-nexus}"
team_arg=()
if [ -n "${VERCEL_TEAM_ID:-}" ]; then team_arg=(--scope "$VERCEL_TEAM_ID"); fi

if command -v vercel >/dev/null 2>&1; then
  vercel_cmd=(vercel)
else
  vercel_cmd=(npx --yes vercel@latest)
fi

push_one() {
  local name="$1"
  local value="${!name:-}"
  if [ -z "$value" ]; then
    warn "$name not in env — skipping"
    return 0
  fi

  # Vercel CLI: `env rm` then `env add`. `env add` rejects duplicates.
  # Pipe the value via stdin so it never appears in argv (process listings).
  "${vercel_cmd[@]}" env rm "$name" production --token "$VERCEL_TOKEN" "${team_arg[@]}" --yes >/dev/null 2>&1 || true
  if printf '%s' "$value" | "${vercel_cmd[@]}" env add "$name" production --token "$VERCEL_TOKEN" "${team_arg[@]}" >/dev/null 2>&1; then
    ok "$name ($(printf '%s' "$value" | wc -c | tr -d ' ') bytes)"
  else
    err "$name push failed — re-run with manual: vercel env add $name production"
    return 1
  fi
}

failures=0
for n in "${NAMES[@]}"; do
  push_one "$n" || failures=$((failures + 1))
done

printf '\n'
if [ $failures -eq 0 ]; then
  ok "synced ${#NAMES[@]} secrets to Vercel ($project, production)"
  warn "redeploy required for Vercel functions to pick up the new values:"
  printf '   npm run deploy -- --vercel\n'
else
  err "$failures secret(s) failed to push — see above"
  exit 1
fi
