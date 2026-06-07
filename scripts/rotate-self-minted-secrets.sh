#!/usr/bin/env bash
# rotate-self-minted-secrets.sh — P0 security closeout, task 1a/1c.
#
# Rotates ONLY the self-minted (non-vendor) secrets in Doppler nexus/prd:
# random strings WE own, with no provider on the other end, so they are safe to
# regenerate locally. Each new value is `openssl rand -hex 32` (256-bit).
#
# ⚠️ DUAL-NAME PAIR (verified 2026-06-07 from the gateway source — DO NOT split):
#   The claude gateway SERVER validates only `CLAUDE_GATEWAY_BEARER`
#     (services/claude-gateway/src/index.ts:16 — `process.env.CLAUDE_GATEWAY_BEARER`, no fallback),
#   while every nexus-app CLIENT SENDS `CLAUDE_CODE_BEARER_TOKEN`
#     (lib/adapters/claude-gateway.ts, lib/ai/providers.ts, app/api/platform-chat, …).
#   The gateway README is explicit: set CLAUDE_GATEWAY_BEARER and "copy this SAME
#   value into Doppler as CLAUDE_CODE_BEARER_TOKEN". So the two MUST hold the SAME
#   value — this script rotates them together to one fresh value. Rotating only one
#   (as a naive list would) breaks gateway auth platform-wide.
#
# Verified key NAMES (from services/*/src/index.ts, docker-compose.yaml, app/api/**):
#   CLAUDE_GATEWAY_BEARER + CLAUDE_CODE_BEARER_TOKEN  (PAIR — same value)
#   CODEX_GATEWAY_BEARER_TOKEN   codex gateway canonical (src reads *_TOKEN ?? CODEX_GATEWAY_BEARER fallback)
#   CRON_SECRET                  app/api/cron/* + services/local-os/cron
#   NEXUS_OPS_TOKEN              ops bearer (app/api/businesses|experiments|sandbox|qa…)
#   NEXUS_SANDBOX_TOKEN          services/nexus-sandbox + app/api/sandbox/exec
#
# ⛔ INTENTIONALLY EXCLUDED — never blind-rotate (guide §1b):
#   ENCRYPTION_KEY     — AES-256-GCM data-at-rest key (lib/crypto.ts). Rotating it
#                        makes every existing Supabase ciphertext row (connected
#                        accounts / stored API keys) undecryptable. Needs a
#                        decrypt-old/encrypt-new migration with both keys live.
#   N8N_ENCRYPTION_KEY — n8n credential-store key (KVM4). Rotating it makes every
#                        saved n8n credential undecryptable (manual re-entry).
#
# Vendor keys (SUPABASE_SERVICE_ROLE_KEY, CLERK_SECRET_KEY, COMPOSIO_API_KEY,
# COOLIFY_KVM4_API_TOKEN, INNGEST_*, MEMORY_HQ_TOKEN) + CODEX_AUTH_JSON rotate via
# their dashboards / `codex login` — NOT here. See p0-security-remediation.md §1c-vendor/§1d.
#
# Usage:
#   bash scripts/rotate-self-minted-secrets.sh            # DRY RUN (default) — writes nothing
#   bash scripts/rotate-self-minted-secrets.sh --apply    # actually rotate
# Never prints a secret VALUE — only key NAMES + a success/fail marker.
set -euo pipefail

PROJECT="nexus"
CONFIG="prd"

# Groups that must share ONE value (pipe-separated). See DUAL-NAME note above.
PAIRS=( "CLAUDE_GATEWAY_BEARER|CLAUDE_CODE_BEARER_TOKEN" )
# Independent singletons — each gets its own fresh value.
SINGLES=( CODEX_GATEWAY_BEARER_TOKEN CRON_SECRET NEXUS_OPS_TOKEN NEXUS_SANDBOX_TOKEN )

APPLY=0
for arg in "${@:-}"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    -h|--help) grep -E '^# ' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    "") ;;
    *) echo "unknown arg: $arg (use --apply or --help)" >&2; exit 2 ;;
  esac
done

command -v doppler >/dev/null 2>&1 || { echo "FATAL: doppler CLI not found" >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "FATAL: openssl not found" >&2; exit 1; }

# Read target config (names only — never a value); also proves the token works.
# `doppler secrets --only-names` prints a bordered TABLE, so strip everything but
# the identifier on each line -> one bare KEY_NAME per line for exact matching.
if ! RAW_NAMES="$(doppler secrets --project "$PROJECT" --config "$CONFIG" --only-names 2>/dev/null)"; then
  echo "FATAL: cannot read Doppler ${PROJECT}/${CONFIG}. Is DOPPLER_TOKEN set/valid?" >&2
  exit 1
fi
NAMES="$(printf '%s\n' "$RAW_NAMES" | sed -E 's/[^A-Za-z0-9_]+//g' | grep -E '^[A-Za-z0-9_]+$' || true)"

# Hard guard: refuse if an at-rest encryption key ever sneaks into the lists.
for k in "${PAIRS[@]//|/ }" "${SINGLES[@]}"; do
  for n in $k; do
    case "$n" in ENCRYPTION_KEY|N8N_ENCRYPTION_KEY)
      echo "FATAL: refusing — $n is an at-rest data key, never blind-rotate." >&2; exit 1 ;;
    esac
  done
done

echo "Doppler target : ${PROJECT}/${CONFIG}"
echo "Mode           : $([ "$APPLY" -eq 1 ] && echo 'APPLY (writes new values)' || echo 'DRY RUN (no writes)')"
echo "Excluded       : ENCRYPTION_KEY, N8N_ENCRYPTION_KEY"
echo "-----------------------------------------------------------------------"

# Deprecated codex fallback: if present, the OLD value still authenticates via the
# gateway's `?? CODEX_GATEWAY_BEARER` fallback — flag it for deletion post-rotation.
if printf '%s\n' "$NAMES" | grep -qx "CODEX_GATEWAY_BEARER"; then
  echo "NOTE: deprecated 'CODEX_GATEWAY_BEARER' present — it's a read-fallback, so the"
  echo "      old value keeps working until you DELETE it after rotating:"
  echo "      doppler secrets delete --project ${PROJECT} --config ${CONFIG} CODEX_GATEWAY_BEARER --yes"
  echo "-----------------------------------------------------------------------"
fi

set_one() { # $1=name $2=value
  if doppler secrets set "$1=$2" --project "$PROJECT" --config "$CONFIG" \
       --no-interactive --silent >/dev/null 2>&1; then echo "  rotated  $1"; else echo "  FAILED   $1" >&2; return 1; fi
}

rc=0
for pair in "${PAIRS[@]}"; do
  val="$(openssl rand -hex 32)"
  echo "PAIR (shared value): ${pair//|/ + }"
  IFS='|' read -ra names <<< "$pair"
  for n in "${names[@]}"; do
    printf '%s\n' "$NAMES" | grep -qx "$n" || echo "  WARN  $n not present — will CREATE"
    if [ "$APPLY" -eq 1 ]; then set_one "$n" "$val" || rc=1; else echo "  would rotate  $n"; fi
  done
  unset val
done
for n in "${SINGLES[@]}"; do
  printf '%s\n' "$NAMES" | grep -qx "$n" || echo "WARN  $n not present — will CREATE"
  if [ "$APPLY" -eq 1 ]; then val="$(openssl rand -hex 32)"; set_one "$n" "$val" || rc=1; unset val; else echo "would rotate  $n"; fi
done

echo "-----------------------------------------------------------------------"
if [ "$APPLY" -eq 1 ]; then
  [ "$rc" -eq 0 ] || { echo "DONE WITH ERRORS (see FAILED lines)." >&2; exit "$rc"; }
  echo "Done. Then (operator): rotate CODEX_AUTH_JSON (codex login, §1d), vendor keys (§1c),"
  echo "the Doppler service token (§1e), and redeploy so containers re-pull:"
  echo "  docker compose -f services/local-os/docker-compose.yaml restart claude-gateway codex-gateway cron-runner nexus-app nexus-sandbox"
else
  echo "Dry run complete — nothing changed. Re-run with --apply to rotate."
fi
