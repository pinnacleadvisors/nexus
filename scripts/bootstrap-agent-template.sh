#!/usr/bin/env bash
# scripts/bootstrap-agent-template.sh
#
# One-shot setup for the org's GitHub template repo. Creates
# pinnacleadvisors/agent-template (private, "template" flag set), seeds it
# with the staged template/ tree from this nexus checkout PLUS copies of
# the canonical .claude/ hooks + skills + lib/molecular bits, then pushes.
#
# Idempotent: re-run after editing nexus/template/ to push fresh content.
# Existing repos created from the template stay current via their own
# .github/workflows/sync-framework.yml.
#
# Requires:
#   - gh CLI authenticated (gh auth status)
#   - Run from a checkout of pinnacleadvisors/nexus (this script lives there)
#
# Usage:
#   ./scripts/bootstrap-agent-template.sh
#   AGENT_TEMPLATE_REPO=myorg/my-template ./scripts/...

set -euo pipefail

ORG_REPO="${AGENT_TEMPLATE_REPO:-pinnacleadvisors/agent-template}"
NEXUS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE_SRC="${NEXUS_DIR}/template"

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI not installed. https://cli.github.com" >&2
  exit 2
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: gh not authenticated. Run: gh auth login" >&2
  exit 2
fi
if [ ! -d "$TEMPLATE_SRC" ]; then
  echo "ERROR: template source not found at $TEMPLATE_SRC" >&2
  exit 2
fi

echo "==> agent-template bootstrap for $ORG_REPO"

# Step 1 — create repo if missing.
if gh repo view "$ORG_REPO" >/dev/null 2>&1; then
  echo "    repo exists, will resync content"
else
  echo "    creating private template repo $ORG_REPO"
  gh repo create "$ORG_REPO" --private \
    --description "Template for projects integrating with memory-hq + the agent framework. Use 'gh repo create --template $ORG_REPO ...'" \
    --confirm
fi

# Mark as template (idempotent).
echo "    marking as template repo"
gh repo edit "$ORG_REPO" --template

# Step 2 — clone to temp dir.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
echo "    cloning into $TMP/repo"
gh repo clone "$ORG_REPO" "$TMP/repo" -- --quiet

cd "$TMP/repo"
if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  git checkout -b main
fi

# Step 3 — copy staged template content.
echo "    syncing nexus/template/* into the repo root"
# rsync preserves dotfiles + nested structure. Exclude any local cruft.
rsync -a --delete \
  --exclude='.git/' --exclude='.git' \
  "$TEMPLATE_SRC"/ ./

# Step 4 — copy canonical .claude/ + lib/molecular files from nexus.
echo "    copying nexus/.claude/hooks + skills + lib/molecular into the template"
mkdir -p .claude/hooks .claude/skills/molecularmemory_local lib/molecular
cp "$NEXUS_DIR/.claude/hooks/check-write-size.sh"                          .claude/hooks/
cp "$NEXUS_DIR/.claude/hooks/skill-router.sh"                              .claude/hooks/ 2>/dev/null || true
cp "$NEXUS_DIR/.claude/skills/molecularmemory_local/cli.mjs"               .claude/skills/molecularmemory_local/
cp "$NEXUS_DIR/.claude/skills/molecularmemory_local/github-commands.mjs"   .claude/skills/molecularmemory_local/
cp "$NEXUS_DIR/.claude/skills/molecularmemory_local/SKILL.md"              .claude/skills/molecularmemory_local/
cp "$NEXUS_DIR/lib/molecular/github-backend.mjs"                            lib/molecular/

chmod +x .claude/hooks/*.sh
chmod +x scripts/setup.sh

# Step 5 — initial commit + push.
git add -A
if git diff --cached --quiet; then
  echo "    nothing to commit"
else
  git commit -q -m "chore: bootstrap / resync agent-template content from nexus"
  echo "    pushing to origin/main"
  git push -q -u origin main
fi

cd "$NEXUS_DIR"

echo
echo "==> done."
echo "    template URL: https://github.com/$ORG_REPO"
echo
echo "    To create a new repo from this template:"
echo "      gh repo create my-new-project --template $ORG_REPO --private"
echo "      cd my-new-project && ./scripts/setup.sh"
echo
echo "    To keep new repos auto-synced with framework changes:"
echo "      Each new repo's sync-framework.yml runs daily."
echo "      It needs MEMORY_HQ_TOKEN as a repo secret. Set with:"
echo "        gh secret set MEMORY_HQ_TOKEN --repo <owner>/<new-repo>"
echo
echo "    To push template changes:"
echo "      Edit nexus/template/* OR nexus/.claude/* OR nexus/lib/molecular/* and re-run this script."
