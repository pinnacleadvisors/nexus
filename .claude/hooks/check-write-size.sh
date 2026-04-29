#!/usr/bin/env bash
# PreToolUse hook for Write / Edit / Bash.
# Blocks tool calls whose payload is large enough to risk an Opus stream timeout.
# Exit codes: 0 = allow, 2 = block (stderr is shown to the model).
#
# Tunables (override via env in .claude/settings.json or shell):
#   MAX_LINES      hard line cap on new content                (default 300)
#   MAX_BYTES      hard byte cap on new content                (default 10240)
#   MAX_HEREDOC    threshold for Bash heredocs (lines)         (default 300)
#
# Why: a single Write/Edit emits its full content as streamed model output. Past
# ~300 lines / 10 KB the stream often drops on Opus, losing the chunk. Splitting
# is cheap; recovery from a half-written file is not.

set -euo pipefail

MAX_LINES="${WRITE_HOOK_MAX_LINES:-300}"
MAX_BYTES="${WRITE_HOOK_MAX_BYTES:-10240}"
MAX_HEREDOC="${WRITE_HOOK_MAX_HEREDOC:-300}"

input="$(cat)"
tool="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null || echo '')"

[ -z "$tool" ] && exit 0

payload=""
case "$tool" in
  Write)
    payload="$(printf '%s' "$input" | jq -r '.tool_input.content // ""')"
    ;;
  Edit)
    payload="$(printf '%s' "$input" | jq -r '.tool_input.new_string // ""')"
    ;;
  Bash)
    cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"
    # Only inspect heredocs that write/append to a file (cat > / cat >>).
    if printf '%s' "$cmd" | grep -qE 'cat[[:space:]]+>>?[[:space:]]+[^[:space:]]+[[:space:]]+<<'; then
      heredoc_lines="$(printf '%s' "$cmd" | wc -l)"
      if (( heredoc_lines > MAX_HEREDOC )); then
        cat >&2 <<MSG
BLOCKED: Bash heredoc is $heredoc_lines lines (limit $MAX_HEREDOC).
Large heredoc writes hit the same Opus stream-timeout risk as Write/Edit.
Split the content:
  1. Create the file with a small Write call (skeleton + section markers).
  2. Append each section with a separate cat >> ... <<EOF call (each <$MAX_HEREDOC lines).
  3. Read between chunks to verify the file state.
For bulk generated data, emit a Node/Python script and run it once instead.
MSG
        exit 2
      fi
    fi
    exit 0
    ;;
  *)
    exit 0
    ;;
esac

lines="$(printf '%s' "$payload" | wc -l)"
bytes="$(printf '%s' "$payload" | wc -c)"

if (( lines > MAX_LINES || bytes > MAX_BYTES )); then
  cat >&2 <<MSG
BLOCKED: $tool payload is $lines lines / $bytes bytes (limit $MAX_LINES lines / $MAX_BYTES bytes).
Long single-shot tool calls cause Opus stream timeouts. Split this write:
  1. New file -> Write skeleton (section headers + empty bodies) in this call.
  2. Existing section -> Edit each section in its own call (use unique anchor strings).
  3. Pure additive content -> Bash 'cat >> path <<'\''EOF'\''' (each chunk <$MAX_HEREDOC lines).
  4. Bulk generated data -> emit a Node/Python script and run it once.
After each chunk lands, Read the file to verify before continuing.
Override (rare): WRITE_HOOK_MAX_LINES=N WRITE_HOOK_MAX_BYTES=N (set in env, not in committed config).
MSG
  exit 2
fi

exit 0
