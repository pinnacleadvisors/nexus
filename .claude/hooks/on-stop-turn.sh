#!/usr/bin/env bash
# Stop hook (ADR 013 P2) — when a Claude Code turn finishes, POST the last
# assistant message to Nexus's /api/chat/ingest-turn so its typed blocks
# (manual-task / approval-request / etc.) flow into the Nexus governance views.
# Register it in the claudecodeui workspace's .claude/settings.json (or ~/.claude)
# under "Stop". Needs NEXUS_OPS_TOKEN + NEXUS_BASE_URL in env. Best-effort: never
# blocks the turn (always exit 0).
set -uo pipefail

input="$(cat 2>/dev/null || true)"
command -v jq >/dev/null 2>&1 || exit 0

transcript="$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null || true)"
sid="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)"
[ -z "$transcript" ] && exit 0
[ -f "$transcript" ] || exit 0

# Concatenated text of the LAST assistant message in the transcript.
text="$(jq -rs 'map(select(.type=="assistant")) | last | (.message.content // []) | map(select(.type=="text") | .text) | join("\n")' "$transcript" 2>/dev/null || true)"
[ -z "$text" ] && exit 0

base="${NEXUS_BASE_URL:-https://nexus.coolifycloudtunnel.uk}"
tok="${NEXUS_OPS_TOKEN:-}"
[ -z "$tok" ] && exit 0

curl -s -m 10 -X POST "$base/api/chat/ingest-turn" \
  -H "Authorization: Bearer $tok" -H "Content-Type: application/json" \
  --data "$(jq -nc --arg t "$text" --arg s "$sid" '{gatewayText:$t, jobId:("hook-"+$s), scope:"platform"}')" \
  >/dev/null 2>&1 || true

exit 0
