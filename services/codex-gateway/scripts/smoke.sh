#!/usr/bin/env bash
# Smoke-test the Codex CLI gateway end-to-end.
#
# Hits GET /health (unauth), then a signed POST /api/sessions/smoke/messages
# that prompts the spawned codex CLI to reply "pong". Exits non-zero on any
# failure, with a friendly diagnosis pointing at the likely cause.
#
# Why this exists: writing the signed POST by hand is error-prone — bearer
# whitespace, BSD-vs-GNU `date` differences, and openssl pipe encoding all
# cause mysterious `401 bad-signature` results. This script handles all of it.
#
# Usage:
#   BEARER=<hex> HOST=https://codex-gw.<your-domain> ./smoke.sh
#   ./smoke.sh <host> <bearer>
#   ./smoke.sh                          # prompts for both
#
# Portable across GNU coreutils (Linux) and BSD userland (macOS).

set -euo pipefail

# ── Args / env ───────────────────────────────────────────────────────────────
HOST="${1:-${HOST:-}}"
BEARER="${2:-${BEARER:-}}"

if [ -z "$HOST" ]; then
  printf 'Gateway host (e.g. https://codex-gw.example.com): '
  read -r HOST
fi
if [ -z "$BEARER" ]; then
  printf 'CODEX_GATEWAY_BEARER: '
  # silent read so the bearer doesn't end up in scrollback
  stty -echo
  read -r BEARER
  stty echo
  printf '\n'
fi

# Strip leading/trailing whitespace, CR, and quotes that often sneak in via
# copy-paste from web pages or password managers.
HOST="$(printf '%s' "$HOST" | tr -d '\r' | sed -E 's/^[[:space:]"\x27]+|[[:space:]"\x27]+$//g')"
BEARER="$(printf '%s' "$BEARER" | tr -d '\r' | sed -E 's/^[[:space:]"\x27]+|[[:space:]"\x27]+$//g')"

# ── Validate ─────────────────────────────────────────────────────────────────
if ! printf '%s' "$HOST" | grep -Eq '^https?://[^/[:space:]]+$|^https?://[^/[:space:]]+/$'; then
  # Allow a trailing path? The endpoint paths are appended below, so no.
  case "$HOST" in
    http://*|https://*) ;;
    *) echo "ERROR: HOST must start with http:// or https://" >&2; exit 2 ;;
  esac
fi
HOST="${HOST%/}"   # strip trailing slash

bearer_len=$(printf '%s' "$BEARER" | wc -c | tr -d ' ')
if [ "$bearer_len" -eq 0 ]; then
  echo "ERROR: BEARER is empty" >&2; exit 2
fi
if ! printf '%s' "$BEARER" | grep -Eq '^[A-Za-z0-9_./+-]+$'; then
  echo "WARN: BEARER contains characters outside the typical hex/base64 set — copy-paste error?" >&2
fi
if [ "$bearer_len" != 64 ]; then
  echo "WARN: BEARER length is $bearer_len (expected 64 for 32-byte hex). Continuing anyway." >&2
fi

for cmd in curl openssl awk; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: required command not found: $cmd" >&2; exit 2
  fi
done

# Portable epoch-ms (BSD `date` lacks %3N).
now_ms() {
  if date +%s%3N 2>/dev/null | grep -Eq '^[0-9]{13}$'; then
    date +%s%3N
  else
    # macOS / BSD: append 000 to seconds
    printf '%s000' "$(date +%s)"
  fi
}

# ── 1. /health ───────────────────────────────────────────────────────────────
echo
echo "▶ GET $HOST/health"
health_body="$(mktemp)"
trap 'rm -f "$health_body"' EXIT
http_code=$(curl -sS -o "$health_body" -w '%{http_code}' "$HOST/health" || true)
echo "  HTTP $http_code"
if [ "$http_code" != "200" ]; then
  echo "  body: $(cat "$health_body")"
  echo "✘ /health failed — gateway not reachable. Common causes:" >&2
  echo "  • Cloudflare 1033: tunnel doesn't have an ingress rule for this hostname." >&2
  echo "  • Wrong HOST." >&2
  echo "  • Coolify deploy isn't healthy." >&2
  exit 1
fi
cat "$health_body"; echo
logged_in=$(grep -o '"loggedIn":[^,}]*' "$health_body" | head -1 | awk -F: '{print $2}')
case "$logged_in" in
  *true*)  echo "✓ /health OK and Codex is logged in" ;;
  *false*) echo "⚠ /health OK but codex CLI is NOT logged in. Run: docker exec -it \$CT codex login" ;;
  *)       echo "⚠ /health returned an unexpected payload (no loggedIn field)" ;;
esac

# ── 2. Unsigned POST should be rejected ──────────────────────────────────────
echo
echo "▶ POST $HOST/api/sessions/test/messages  (unsigned, expecting 401)"
unauth_body="$(mktemp)"
trap 'rm -f "$health_body" "$unauth_body"' EXIT
unauth_code=$(curl -sS -o "$unauth_body" -w '%{http_code}' \
  -X POST "$HOST/api/sessions/test/messages" \
  -H 'Content-Type: application/json' \
  -d '{"role":"user","content":"hi"}' || true)
echo "  HTTP $unauth_code"
echo "  body: $(cat "$unauth_body")"
if [ "$unauth_code" != "401" ]; then
  echo "✘ expected 401 missing-bearer, got $unauth_code — auth path may be misconfigured" >&2
  exit 1
fi
echo "✓ unsigned POST correctly rejected"

# ── 3. Signed POST → real codex reply ────────────────────────────────────────
echo
BODY='{"role":"user","content":"Reply with exactly: pong","agent":null,"env":{}}'
# Use $NF (last field) rather than $2 — macOS LibreSSL `openssl dgst` output
# format differs from GNU/OpenSSL3, sometimes leaving the hash as the only
# field. $NF is robust across both.
SIG_HEX="$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$BEARER" | awk '{print $NF}')"
if ! printf '%s' "$SIG_HEX" | grep -Eq '^[0-9a-fA-F]{64}$'; then
  echo "✘ openssl produced an unexpected signature: '$SIG_HEX'" >&2
  echo "  Try: openssl version; printf 'x' | openssl dgst -sha256 -hmac 'k'" >&2
  echo "  We expected a single line ending in a 64-char hex digest." >&2
  exit 1
fi
SIG="sha256=$SIG_HEX"
TS="$(now_ms)"

echo "▶ POST $HOST/api/sessions/smoke/messages  (signed)"
signed_body="$(mktemp)"
trap 'rm -f "$health_body" "$unauth_body" "$signed_body"' EXIT
signed_code=$(curl -sS -o "$signed_body" -w '%{http_code}' \
  -X POST "$HOST/api/sessions/smoke/messages" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $BEARER" \
  -H "X-Nexus-Signature: $SIG" \
  -H "X-Nexus-Timestamp: $TS" \
  --max-time 60 \
  -d "$BODY" || true)
echo "  HTTP $signed_code"
echo "  body: $(cat "$signed_body")"

case "$signed_code" in
  200)
    echo "✓ signed POST OK — gateway end-to-end is healthy"
    ;;
  401)
    reason=$(grep -o '"reason":"[^"]*"' "$signed_body" | head -1 | awk -F'"' '{print $4}')
    echo "✘ 401 with reason=$reason" >&2
    case "$reason" in
      bad-bearer)
        echo "  Cause: BEARER doesn't match server's CODEX_GATEWAY_BEARER." >&2
        echo "  Fix:   re-copy without trailing whitespace; verify Doppler / Coolify env." >&2 ;;
      bad-signature)
        echo "  Cause: HMAC mismatch — usually trailing whitespace in BEARER." >&2
        echo "  Fix:   re-copy without trailing whitespace; check 'echo -n \$BEARER | wc -c' = 64." >&2 ;;
      stale-timestamp)
        echo "  Cause: clock skew between this machine and the gateway > 5 min." >&2
        echo "  Fix:   sync time (chrony / systemd-timesyncd / sntp)." >&2 ;;
      *)
        echo "  Unexpected 401 reason. Check gateway logs." >&2 ;;
    esac
    exit 1
    ;;
  502)
    echo "✘ 502 — gateway received the request but the codex CLI failed." >&2
    echo "  Common cause: codex CLI not logged in, or sandbox flagged the prompt." >&2
    echo "  Fix:  docker exec -it \$CT codex login   (then redeploy)" >&2
    exit 1
    ;;
  503)
    echo "✘ 503 queue_full — another in-flight request. Retry in a moment." >&2
    exit 1
    ;;
  *)
    echo "✘ unexpected $signed_code — check gateway logs." >&2
    exit 1
    ;;
esac
