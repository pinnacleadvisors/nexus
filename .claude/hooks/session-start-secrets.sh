#!/usr/bin/env bash
# session-start-secrets.sh
#
# Fetches a fixed allowlist of secrets from the Nexus Composio→Doppler broker
# and emits `export NAME=value` lines to stdout. Designed to be eval'd at the
# start of a Claude Code web cloud session so the agent has the secrets it
# needs without ever holding a Doppler/Composio credential itself.
#
# Usage in a Claude Code web sandbox SessionStart hook (or any cloud-init):
#   eval "$(.claude/hooks/session-start-secrets.sh)"
#
# Required env (set once per sandbox via the cloud provider's secret UI):
#   NEXUS_BROKER_URL              e.g. https://nexus-xxx.vercel.app
#   CLAUDE_SESSION_BROKER_TOKEN   shared secret matching the server-side value
#
# Optional:
#   NEXUS_BROKER_SECRETS          comma-separated names to fetch.
#                                 Defaults to a sensible set (see below).
#
# Behaviour:
#   * No-ops cleanly (exit 0, empty stdout) when broker config is missing —
#     local sessions where Doppler is already loaded won't get redundant calls.
#   * Writes one `export NAME='value'` per secret returned. Values are single-
#     quoted with embedded single-quotes escaped.
#   * Errors and diagnostics go to stderr only — never stdout — so an `eval`
#     can't be poisoned.

set -u

emit_err() { printf '[session-start-secrets] %s\n' "$*" >&2; }

if [ -z "${NEXUS_BROKER_URL:-}" ] || [ -z "${CLAUDE_SESSION_BROKER_TOKEN:-}" ]; then
  emit_err "broker not configured (NEXUS_BROKER_URL / CLAUDE_SESSION_BROKER_TOKEN unset) — skipping"
  exit 0
fi

# Default secret list — tune via NEXUS_BROKER_SECRETS env var or
# COMPOSIO_BROKER_ALLOWED_SECRETS server-side.
DEFAULT_SECRETS="ANTHROPIC_API_KEY,OPENAI_API_KEY,TAVILY_API_KEY,FIRECRAWL_API_KEY,SUPABASE_SERVICE_ROLE_KEY,NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY"
SECRETS="${NEXUS_BROKER_SECRETS:-$DEFAULT_SECRETS}"

# Build JSON array from comma-separated list using python3 (always present in
# Claude Code sandboxes; jq is not guaranteed).
NAMES_JSON="$(SECRETS="$SECRETS" python3 -c '
import json, os
names = [n.strip() for n in os.environ["SECRETS"].split(",") if n.strip()]
print(json.dumps(names))
')"

if [ -z "$NAMES_JSON" ] || [ "$NAMES_JSON" = "[]" ]; then
  emit_err "no secrets requested — skipping"
  exit 0
fi

URL="${NEXUS_BROKER_URL%/}/api/composio/doppler"

RESPONSE="$(curl -sS --max-time 15 \
  -H "authorization: Bearer ${CLAUDE_SESSION_BROKER_TOKEN}" \
  -H 'content-type: application/json' \
  -d "{\"names\":${NAMES_JSON}}" \
  -w '\n__HTTP__:%{http_code}' \
  "$URL" 2>&1)" || {
    emit_err "broker request failed: $RESPONSE"
    exit 0
  }

HTTP_CODE="$(printf '%s\n' "$RESPONSE" | sed -n 's/^__HTTP__://p' | tail -n1)"
BODY="$(printf '%s\n' "$RESPONSE" | sed '/^__HTTP__:/d')"

if [ "$HTTP_CODE" != "200" ]; then
  emit_err "broker returned HTTP ${HTTP_CODE}: ${BODY}"
  exit 0
fi

# Parse JSON and emit shell exports. Values single-quoted; embedded ' becomes '\''
printf '%s' "$BODY" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception as e:
    sys.stderr.write(f"[session-start-secrets] invalid JSON from broker: {e}\n")
    sys.exit(0)

secrets = data.get("secrets") or {}
missing = data.get("missing") or []
rejected = data.get("rejected") or []

for name, value in secrets.items():
    if not isinstance(name, str) or not isinstance(value, str):
        continue
    escaped = value.replace("'\''", "'\''\\'\'''\''")
    print(f"export {name}='\''{escaped}'\''")

if missing:
    sys.stderr.write(f"[session-start-secrets] missing from Doppler: {','.join(missing)}\n")
if rejected:
    sys.stderr.write(f"[session-start-secrets] rejected by allowlist: {','.join(rejected)}\n")
'
