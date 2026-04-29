#!/usr/bin/env bash
# scripts/bootstrap-memory-hq.sh
#
# One-shot setup for the central knowledge graph at pinnacleadvisors/memory-hq.
# Idempotent: safe to re-run (skips creation if repo exists, syncs framework
# files on every run).
#
# Requires:
#   - gh CLI authenticated (gh auth status)
#   - Run from a checkout of pinnacleadvisors/nexus (this script lives there)
#
# Usage:
#   ./scripts/bootstrap-memory-hq.sh                              # default org/name
#   MEMORY_HQ_ORG=myorg MEMORY_HQ_REPO=memory ./scripts/...       # override
#
# What it does:
#   1. Creates pinnacleadvisors/memory-hq (private) if it doesn't exist
#   2. Clones it to a temp dir
#   3. Seeds the directory layout (atoms/, entities/, mocs/, sources/,
#      synthesis/, log/, digest/) with .gitkeep files
#   4. Copies docs/framework/ into framework/ — universal protocol docs
#      that any AI model on any device can pull
#   5. Initial commit + push, then cleans up the temp clone

set -euo pipefail

ORG="${MEMORY_HQ_ORG:-pinnacleadvisors}"
NAME="${MEMORY_HQ_REPO:-memory-hq}"
FULL="${ORG}/${NAME}"
NEXUS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRAMEWORK_SRC="${NEXUS_DIR}/docs/framework"

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI not installed. https://cli.github.com" >&2
  exit 2
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: gh not authenticated. Run: gh auth login" >&2
  exit 2
fi
if [ ! -d "$FRAMEWORK_SRC" ]; then
  echo "ERROR: framework source not found at $FRAMEWORK_SRC" >&2
  exit 2
fi

echo "==> Memory HQ bootstrap for $FULL"

# Step 1 — create the repo if missing.
if gh repo view "$FULL" >/dev/null 2>&1; then
  echo "    repo exists, will sync framework only"
else
  echo "    creating private repo $FULL"
  gh repo create "$FULL" --private \
    --description "Central cross-repo knowledge graph for AI agents (atoms/entities/MOCs + framework). Source of truth — Supabase-mirrored for reads." \
    --confirm
fi

# Step 2 — clone to temp.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
echo "    cloning into $TMP"
gh repo clone "$FULL" "$TMP/repo" -- --quiet

cd "$TMP/repo"

# Initialize main if empty.
if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  git checkout -b main
fi

# Step 3 — directory layout with .gitkeep so empty dirs are tracked.
for d in atoms entities mocs sources synthesis log digest framework framework/ADAPTERS; do
  mkdir -p "$d"
  touch "$d/.gitkeep"
done

# Step 4 — copy framework docs.
echo "    syncing framework/ from nexus/docs/framework/"
cp -R "$FRAMEWORK_SRC"/* framework/

# Top-level README if missing.
if [ ! -f README.md ]; then
  cat > README.md <<'EOF'
# memory-hq

Central cross-repo knowledge graph used by every AI model and every project in the org.

## Layout

```
atoms/<scope-id>/<slug>.md        atomic facts (one per file)
entities/<scope-id>/<slug>.md     people / companies / concepts
mocs/<scope-id>/<slug>.md         maps of content (topic hubs)
sources/<scope-id>/<slug>.md      ingested documents (one per source)
synthesis/<scope-id>/<slug>.md    multi-source essays / Q&A
log/<iso>-<op>-<slug>.md          file-per-event activity log
digest/<YYYY-MM-DD>.md            cron-generated daily digest
framework/                        cross-model agent framework docs
INDEX.md                          cron-generated counts + scope list (do not edit)
```

`scope-id` = first 8 chars of sha1(JSON-canonical scope) + human suffix. Disambiguates same-named atoms across projects/businesses.

## Reading + writing

Source of truth = this repo (markdown). Hot-path reads go through the Supabase mirror via `GET /api/memory/query`. All writes flow through `POST /api/memory/event` for provenance and rate-limiting.

See `framework/README.md` for the cross-model framework, and `framework/ADAPTERS/CLAUDE-CODE.md` for Claude-specific implementation.

## Bootstrap

This repo is bootstrapped from `pinnacleadvisors/nexus` via `scripts/bootstrap-memory-hq.sh`. To refresh the framework files, re-run that script.
EOF
fi

# Step 5 — commit + push.
git add -A
if git diff --cached --quiet; then
  echo "    nothing to commit"
else
  git commit -q -m "chore: bootstrap memory-hq layout + framework sync"
  echo "    pushing to origin/main"
  git push -q -u origin main
fi

cd "$NEXUS_DIR"

echo
echo "==> done."
echo "    next steps:"
echo "    1. mint MEMORY_HQ_TOKEN — fine-grained PAT, contents:rw + metadata:r, scoped to $FULL only"
echo "    2. add MEMORY_HQ_TOKEN to Doppler (and ideally MEMORY_HQ_REPO=$FULL)"
echo "    3. configure GitHub webhook on $FULL per memory/platform/SECRETS.md"
echo "    4. run scripts/smoke-memory-event.mjs against your deploy to verify"
