#!/usr/bin/env bash
# install-git-hooks.sh — copy repo-tracked hooks into .git/hooks so they run.
#
# Git does not execute hooks checked into the repo; they have to live under
# .git/hooks, which is local to each clone. This script links them so every
# developer gets the same guards after a single setup step.
#
# Usage (once per clone):
#   ./scripts/install-git-hooks.sh

set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
SRC="$ROOT/scripts/hooks"
DST="$ROOT/.git/hooks"

mkdir -p "$DST"
for f in "$SRC"/*; do
  name=$(basename "$f")
  cp -f "$f" "$DST/$name"
  chmod +x "$DST/$name"
  echo "  installed $name"
done

echo "[install-git-hooks] done — hooks active in $DST"
