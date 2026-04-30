#!/usr/bin/env bash
# scripts/setup.sh — first-time setup checklist for a repo created from
# pinnacleadvisors/agent-template.
#
# Idempotent: safe to re-run. Prints prereqs and next steps; doesn't modify
# anything destructive.

set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> agent-template setup"
echo

# 1. Node version check.
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not installed. Need Node 20+." >&2
  exit 2
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERROR: Node $(node -v) is too old. Need Node 20+." >&2
  exit 2
fi
echo "    [ok] node $(node -v)"

# 2. gh CLI (for GitHub Actions secret + workflow runs).
if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    echo "    [ok] gh authenticated"
  else
    echo "    [warn] gh not authenticated — run: gh auth login"
  fi
else
  echo "    [warn] gh CLI not installed — fine for local use, needed for managing secrets"
fi

# 3. Hooks executable.
chmod +x .claude/hooks/*.sh 2>/dev/null || true
echo "    [ok] hooks marked executable"

# 4. Framework pull (best-effort).
if [ -n "${MEMORY_HQ_TOKEN:-}" ]; then
  echo "    [ok] MEMORY_HQ_TOKEN found in env — pulling framework..."
  if node .claude/skills/molecularmemory_local/cli.mjs --backend=github framework-pull \
       --to=.claude/framework --dropIn=CLAUDE.md >/dev/null 2>&1; then
    echo "    [ok] framework pulled into .claude/framework/ + CLAUDE.md"
  else
    echo "    [warn] framework-pull failed — workflow will retry on next schedule"
  fi
else
  echo "    [warn] MEMORY_HQ_TOKEN not in env — set it locally to write atoms,"
  echo "           OR rely on the daily sync-framework.yml workflow (also needs the secret)."
fi

# 5. Print remaining one-time tasks.
cat <<'EOF'

==> next steps (one-time, owner action):

  1. Add MEMORY_HQ_TOKEN as a GitHub Actions repo secret:
       gh secret set MEMORY_HQ_TOKEN

     This lets the daily sync-framework.yml workflow pull updates from
     memory-hq into this repo.

  2. (Optional) Add MEMORY_HQ_TOKEN to your local Doppler / env so the
     molecular memory CLI works locally:
       doppler secrets set MEMORY_HQ_TOKEN=<value>
     OR
       export MEMORY_HQ_TOKEN=<value>   # in ~/.zshrc / ~/.bashrc

  3. Replace AGENTS.md with this project's stack rules (the placeholder
     describes the format).

  4. (Optional) Trigger the framework sync now instead of waiting for
     the daily schedule:
       gh workflow run sync-framework.yml

  5. Open in Claude Code and verify CLAUDE.md is loaded — ask
     "summarize the long-horizon task protocol" — should reference
     Goal / Explore / Plan / Implement.

EOF

echo "==> setup complete"
