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

# MCP configuration. Two implementations available:
#
#   1. mcp-composio-admin (PREFERRED, hard-isolation, this PR):
#      Custom wrapper at /repo/services/mcp-composio-admin/. Built at runtime
#      from the cloned repo (avoids Dockerfile context complexity). Filters
#      Composio actions to admin-scope (business_slug='_admin') connections
#      only — agent literally cannot reach Shared / per-business tokens.
#      Activates when:
#        - COMPOSIO_API_KEY is set
#        - SUPABASE_SERVICE_ROLE_KEY is set (needed to read connected_accounts)
#        - The wrapper builds successfully (npm install + tsc)
#
#   2. rube-mcp (FALLBACK, soft-isolation, PR #152):
#      The vanilla @composio/rube-mcp. Sees every Composio connection your
#      API key can reach. Relies on agent self-discipline (system prompt +
#      agent spec) for scope correctness. Used when the wrapper build fails
#      or SUPABASE_SERVICE_ROLE_KEY is unset.
#
# Force the fallback by setting MCP_USE_RUBE_FALLBACK=1.
#
# Overwritten every boot so config drift (manual edits via shell) doesn't
# persist. .credentials.json (OAuth) is a separate file in the same dir.

WRAPPER_DIR="${NEXUS_REPO_PATH:-/repo}/services/mcp-composio-admin"
WRAPPER_BUILT=0

if [ -n "${COMPOSIO_API_KEY:-}" ] \
   && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] \
   && [ "${MCP_USE_RUBE_FALLBACK:-0}" != "1" ] \
   && [ -d "$WRAPPER_DIR/src" ]; then
  echo "[gateway] Building mcp-composio-admin wrapper from $WRAPPER_DIR..."
  if (cd "$WRAPPER_DIR" && npm install --no-audit --no-fund --silent && npm run build --silent); then
    WRAPPER_BUILT=1
    echo "[gateway] Wrapper built — registering as hard-isolation MCP."
  else
    echo "[gateway] WARNING: wrapper build FAILED — falling back to rube-mcp."
  fi
fi

# Try to build the memory-hq MCP too (services/mcp-memory/). Gives the
# platform-copilot durable cross-session memory via the memory-hq graph.
# Optional — registration is gated on MEMORY_HQ_TOKEN being set and the
# build succeeding.
MEMORY_MCP_DIR="${NEXUS_REPO_PATH:-/repo}/services/mcp-memory"
MEMORY_MCP_BUILT=0
if [ -n "${MEMORY_HQ_TOKEN:-}" ] && [ -d "$MEMORY_MCP_DIR/src" ]; then
  echo "[gateway] Building memory-hq MCP from $MEMORY_MCP_DIR..."
  if (cd "$MEMORY_MCP_DIR" && npm install --no-audit --no-fund --silent && npm run build --silent); then
    MEMORY_MCP_BUILT=1
    echo "[gateway] memory-hq MCP built — will register."
  else
    echo "[gateway] WARNING: memory-hq MCP build FAILED — skipping registration."
  fi
fi

# Build the codex-delegate MCP (services/mcp-codex-delegate/). Gives the
# platform-copilot a first-class `delegate_to_codex` tool that calls the
# codex-gateway's async-job HTTP API and returns the full transcript inline.
# Optional — registration is gated on CODEX_GATEWAY_URL + CODEX_GATEWAY_BEARER_TOKEN
# being set AND the build succeeding. Phase 2c of task_plan-chat.md.
CODEX_MCP_DIR="${NEXUS_REPO_PATH:-/repo}/services/mcp-codex-delegate"
CODEX_MCP_BUILT=0
if [ -n "${CODEX_GATEWAY_URL:-}" ] && [ -n "${CODEX_GATEWAY_BEARER_TOKEN:-}" ] && [ -d "$CODEX_MCP_DIR/src" ]; then
  echo "[gateway] Building codex-delegate MCP from $CODEX_MCP_DIR..."
  if (cd "$CODEX_MCP_DIR" && npm install --no-audit --no-fund --silent && npm run build --silent); then
    CODEX_MCP_BUILT=1
    echo "[gateway] codex-delegate MCP built — will register."
  else
    echo "[gateway] WARNING: codex-delegate MCP build FAILED — skipping registration."
  fi
fi

# Build the permission-broker MCP (services/mcp-permission-broker/). PR #189.
# Catches CLI tool-permission requests via `--permission-prompt-tool` and
# surfaces them to the operator's chat as Allow/Deny cards. Requires
# SUPABASE_SERVICE_ROLE_KEY (writes pending rows to chat_permission_requests)
# AND NEXUS_OPERATOR_USER_ID (so the broker knows whose decision to wait for).
# Skipped entirely when MCP_PERMISSION_BROKER=skip (revert switch).
BROKER_MCP_DIR="${NEXUS_REPO_PATH:-/repo}/services/mcp-permission-broker"
BROKER_MCP_BUILT=0
if [ "${MCP_PERMISSION_BROKER:-}" != "skip" ] \
   && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] \
   && [ -d "$BROKER_MCP_DIR/src" ]; then
  echo "[gateway] Building permission-broker MCP from $BROKER_MCP_DIR..."
  if (cd "$BROKER_MCP_DIR" && npm install --no-audit --no-fund --silent && npm run build --silent); then
    BROKER_MCP_BUILT=1
    echo "[gateway] permission-broker MCP built — will register."
  else
    echo "[gateway] WARNING: permission-broker MCP build FAILED — skipping registration."
  fi
fi

# Build the Coolify MCP (services/mcp-coolify/). PR #191.
# Gives the platform-copilot read + bounded-write access to Coolify v4.
# Requires SUPABASE_SERVICE_ROLE_KEY (kill-switch + audit log) AND
# COOLIFY_KVM4_URL + COOLIFY_KVM4_API_TOKEN (the Coolify creds already
# in Doppler from the provisioner). Skipped when MCP_COOLIFY=skip.
COOLIFY_MCP_DIR="${NEXUS_REPO_PATH:-/repo}/services/mcp-coolify"
COOLIFY_MCP_BUILT=0
if [ "${MCP_COOLIFY:-}" != "skip" ] \
   && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] \
   && [ -n "${COOLIFY_KVM4_URL:-}" ] \
   && [ -n "${COOLIFY_KVM4_API_TOKEN:-}" ] \
   && [ -d "$COOLIFY_MCP_DIR/src" ]; then
  echo "[gateway] Building coolify MCP from $COOLIFY_MCP_DIR..."
  if (cd "$COOLIFY_MCP_DIR" && npm install --no-audit --no-fund --silent && npm run build --silent); then
    COOLIFY_MCP_BUILT=1
    echo "[gateway] coolify MCP built — will register."
  else
    echo "[gateway] WARNING: coolify MCP build FAILED — skipping registration."
  fi
fi

# Assemble the settings.json. Whichever MCP servers built successfully get
# registered. composio-admin (hard-isolation) is the primary; rube-mcp is
# the soft-isolation fallback used only when the wrapper isn't available.
# memory-hq is additive — registers alongside whichever Composio variant is
# active.
build_mcp_block() {
  local first=1
  if [ -n "${COMPOSIO_API_KEY:-}" ] && [ "$WRAPPER_BUILT" -eq 1 ]; then
    [ $first -eq 0 ] && printf ',\n'
    first=0
    cat <<JSON
    "composio-admin": {
      "command": "node",
      "args": ["$WRAPPER_DIR/dist/index.js"],
      "env": {
        "COMPOSIO_API_KEY":           "${COMPOSIO_API_KEY}",
        "NEXT_PUBLIC_SUPABASE_URL":   "${NEXT_PUBLIC_SUPABASE_URL:-}",
        "SUPABASE_SERVICE_ROLE_KEY":  "${SUPABASE_SERVICE_ROLE_KEY}",
        "NEXUS_OPERATOR_USER_ID":     "${NEXUS_OPERATOR_USER_ID:-}",
        "ALLOWED_USER_IDS":           "${ALLOWED_USER_IDS:-}"
      }
    }
JSON
  elif [ -n "${COMPOSIO_API_KEY:-}" ]; then
    [ $first -eq 0 ] && printf ',\n'
    first=0
    cat <<JSON
    "composio": {
      "command": "npx",
      "args": ["-y", "@composio/rube-mcp"],
      "env": {
        "COMPOSIO_API_KEY": "${COMPOSIO_API_KEY}"
      }
    }
JSON
  fi
  if [ "$MEMORY_MCP_BUILT" -eq 1 ]; then
    [ $first -eq 0 ] && printf ',\n'
    first=0
    cat <<JSON
    "memory-hq": {
      "command": "node",
      "args": ["$MEMORY_MCP_DIR/dist/index.js"],
      "env": {
        "MEMORY_HQ_TOKEN":  "${MEMORY_HQ_TOKEN}",
        "NEXUS_BASE_URL":   "${NEXUS_BASE_URL:-}",
        "MEMORY_AUTHOR":    "claude-agent:platform-copilot"
      }
    }
JSON
  fi
  if [ "$CODEX_MCP_BUILT" -eq 1 ]; then
    [ $first -eq 0 ] && printf ',\n'
    first=0
    cat <<JSON
    "codex-delegate": {
      "command": "node",
      "args": ["$CODEX_MCP_DIR/dist/index.js"],
      "env": {
        "CODEX_GATEWAY_URL":          "${CODEX_GATEWAY_URL}",
        "CODEX_GATEWAY_BEARER_TOKEN": "${CODEX_GATEWAY_BEARER_TOKEN}",
        "NEXUS_OPERATOR_USER_ID":     "${NEXUS_OPERATOR_USER_ID:-}",
        "ALLOWED_USER_IDS":           "${ALLOWED_USER_IDS:-}",
        "CODEX_DELEGATE_TIMEOUT_MS":  "${CODEX_DELEGATE_TIMEOUT_MS:-300000}",
        "CODEX_DELEGATE_POLL_MS":     "${CODEX_DELEGATE_POLL_MS:-3000}"
      }
    }
JSON
  fi
  if [ "$BROKER_MCP_BUILT" -eq 1 ]; then
    [ $first -eq 0 ] && printf ',\n'
    first=0
    cat <<JSON
    "permission-broker": {
      "command": "node",
      "args": ["$BROKER_MCP_DIR/dist/index.js"],
      "env": {
        "NEXT_PUBLIC_SUPABASE_URL":   "${NEXT_PUBLIC_SUPABASE_URL:-}",
        "SUPABASE_SERVICE_ROLE_KEY":  "${SUPABASE_SERVICE_ROLE_KEY}",
        "NEXUS_OPERATOR_USER_ID":     "${NEXUS_OPERATOR_USER_ID:-}",
        "ALLOWED_USER_IDS":           "${ALLOWED_USER_IDS:-}",
        "BROKER_TIMEOUT_MS":          "${BROKER_TIMEOUT_MS:-600000}",
        "BROKER_POLL_INTERVAL_MS":    "${BROKER_POLL_INTERVAL_MS:-1000}"
      }
    }
JSON
  fi
  if [ "$COOLIFY_MCP_BUILT" -eq 1 ]; then
    [ $first -eq 0 ] && printf ',\n'
    first=0
    cat <<JSON
    "coolify": {
      "command": "node",
      "args": ["$COOLIFY_MCP_DIR/dist/index.js"],
      "env": {
        "NEXT_PUBLIC_SUPABASE_URL":   "${NEXT_PUBLIC_SUPABASE_URL:-}",
        "SUPABASE_SERVICE_ROLE_KEY":  "${SUPABASE_SERVICE_ROLE_KEY}",
        "NEXUS_OPERATOR_USER_ID":     "${NEXUS_OPERATOR_USER_ID:-}",
        "ALLOWED_USER_IDS":           "${ALLOWED_USER_IDS:-}",
        "COOLIFY_KVM4_URL":           "${COOLIFY_KVM4_URL}",
        "COOLIFY_KVM4_API_TOKEN":     "${COOLIFY_KVM4_API_TOKEN}",
        "PROTECTED_UUIDS":            "${PROTECTED_UUIDS:-}",
        "COOLIFY_RATE_LIMIT_MIN":     "${COOLIFY_RATE_LIMIT_MIN:-5}",
        "COOLIFY_RATE_LIMIT_HOUR":    "${COOLIFY_RATE_LIMIT_HOUR:-30}"
      }
    }
JSON
  fi
}

MCP_BLOCK="$(build_mcp_block)"
if [ -n "$MCP_BLOCK" ]; then
  mkdir -p /root/.claude
  # Pre-allowlist the trusted MCP tools + the broad workhorse tools so
  # `claude -p` (non-interactive) doesn't silently drop tool calls waiting
  # for a TTY confirmation that never comes. Two tiers, both safe under
  # the container threat model (ephemeral /repo clone, no financial
  # secrets in this gateway's env per ADR 002):
  #
  #   1. MCP tools (composio-admin, memory-hq, codex-delegate) — already
  #      structurally bounded by their respective wrappers.
  #   2. Workhorse tools (Bash, Edit, Write, Read, Glob, Grep, LS,
  #      BashOutput, NotebookEdit/NotebookRead, WebFetch, WebSearch,
  #      TodoWrite). Approved here because:
  #        - The container is the security boundary. /repo is a fresh
  #          clone on each boot; the agent can't escape it.
  #        - Compound-command splitting in Bash makes per-pattern
  #          allowlists brittle. `npx tsc | head -30` splits into two
  #          sub-commands and BOTH need to match. Wholesale-allow Bash
  #          inside the sandbox.
  #        - The CHAT-level approval-request block (lib/chat/approval.ts)
  #          is the policy gate operators see. CLI-level approval gates
  #          don't work in headless mode anyway — they emit prose
  #          rejections the chat UI can't render as buttons.
  #
  # For tool calls that DON'T match the allow list, the new permission-
  # broker MCP (PR #189) catches them via --permission-prompt-tool and
  # surfaces an Allow/Deny card in the chat. So unknown tools still get
  # a UI gate; the allow list just covers the common path so the broker
  # isn't on the hot path for every Bash run.
  cat > /root/.claude/settings.json <<JSON
{
  "mcpServers": {
$MCP_BLOCK
  },
  "permissions": {
    "allow": [
      "mcp__composio-admin__admin_list_connected_platforms",
      "mcp__composio-admin__admin_list_actions",
      "mcp__composio-admin__admin_execute_action",
      "mcp__memory-hq__memory_atom",
      "mcp__memory-hq__memory_entity",
      "mcp__memory-hq__memory_moc",
      "mcp__memory-hq__memory_query",
      "mcp__memory-hq__memory_search",
      "mcp__codex-delegate__delegate_to_codex",
      "mcp__permission-broker__permission_prompt",
      "mcp__coolify__coolify_list_apps",
      "mcp__coolify__coolify_get_app",
      "mcp__coolify__coolify_get_logs",
      "mcp__coolify__coolify_list_env_keys",
      "mcp__coolify__coolify_get_env_value",
      "mcp__coolify__coolify_redeploy",
      "mcp__coolify__coolify_restart",
      "mcp__coolify__coolify_start",
      "mcp__coolify__coolify_stop",
      "mcp__coolify__coolify_set_env",
      "mcp__coolify__coolify_delete_env",
      "Bash",
      "Edit",
      "Write",
      "NotebookEdit",
      "Read",
      "Glob",
      "Grep",
      "LS",
      "BashOutput",
      "NotebookRead",
      "WebFetch",
      "WebSearch",
      "TodoWrite"
    ]
  }
}
JSON
  REGISTERED=""
  [ "$WRAPPER_BUILT" -eq 1 ]                              && REGISTERED="$REGISTERED composio-admin"
  [ -n "${COMPOSIO_API_KEY:-}" ] && [ "$WRAPPER_BUILT" -ne 1 ] && REGISTERED="$REGISTERED composio"
  [ "$MEMORY_MCP_BUILT" -eq 1 ]                           && REGISTERED="$REGISTERED memory-hq"
  [ "$CODEX_MCP_BUILT" -eq 1 ]                            && REGISTERED="$REGISTERED codex-delegate"
  [ "$BROKER_MCP_BUILT" -eq 1 ]                           && REGISTERED="$REGISTERED permission-broker"
  [ "$COOLIFY_MCP_BUILT" -eq 1 ]                          && REGISTERED="$REGISTERED coolify"
  echo "[gateway] Wrote MCP config:$REGISTERED"
else
  # No MCP servers built — log clearly and clean up any stale settings.json
  # from a prior boot WITH keys set (volume persistence edge case).
  echo "[gateway] WARNING: no MCP servers registered."
  if [ -z "${COMPOSIO_API_KEY:-}" ]; then
    echo "[gateway]   - COMPOSIO_API_KEY not set → platform-copilot will lack Composio tools."
  fi
  if [ -z "${MEMORY_HQ_TOKEN:-}" ]; then
    echo "[gateway]   - MEMORY_HQ_TOKEN not set → no durable memory across sessions."
  fi
  if [ -z "${CODEX_GATEWAY_URL:-}" ] || [ -z "${CODEX_GATEWAY_BEARER_TOKEN:-}" ]; then
    echo "[gateway]   - CODEX_GATEWAY_URL or CODEX_GATEWAY_BEARER_TOKEN not set → delegate_to_codex unavailable."
  fi
  echo "[gateway]   Set the missing env vars in Coolify and redeploy to activate."
  if [ -f /root/.claude/settings.json ]; then
    echo "[gateway]   Removing stale /root/.claude/settings.json."
    rm -f /root/.claude/settings.json
  fi
fi

exec node /app/dist/index.js
