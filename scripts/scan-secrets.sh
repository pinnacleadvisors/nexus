#!/usr/bin/env bash
# scan-secrets.sh — pre-commit guard that rejects common secret patterns in the
# staged diff. Runs only against files about to land, so it does not choke on
# historical commits.
#
# Patterns covered:
#   - Stripe / Anthropic / OpenAI-shaped keys (sk-... with 20+ chars)
#   - JWTs (eyJ... base64-ish segment followed by a dot)
#   - PEM private keys
#   - GitHub PATs (ghp_..., ghs_..., github_pat_...)
#   - AWS access keys (AKIA/ASIA followed by 16 chars)
#
# Override: `SKIP_SECRET_SCAN=1 git commit ...`  (use only for intentional test
# fixtures — document why in the commit).

set -euo pipefail

if [ "${SKIP_SECRET_SCAN:-}" = "1" ]; then
  echo "[scan-secrets] SKIP_SECRET_SCAN=1 set — skipping"
  exit 0
fi

# Only scan files actually staged for this commit
FILES=$(git diff --cached --name-only --diff-filter=ACMR)
if [ -z "$FILES" ]; then exit 0; fi

PATTERNS=(
  'sk-[A-Za-z0-9_-]{20,}'
  'sk-ant-[A-Za-z0-9_-]{20,}'
  'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'
  '-----BEGIN [A-Z ]+PRIVATE KEY-----'
  'gh[pousr]_[A-Za-z0-9]{20,}'
  'github_pat_[A-Za-z0-9_]{20,}'
  '(AKIA|ASIA)[A-Z0-9]{16}'
)

EXCLUDE_DIRS=(node_modules .next dist build .git)
EXCLUDE_ARGS=()
for d in "${EXCLUDE_DIRS[@]}"; do
  EXCLUDE_ARGS+=(--exclude-dir="$d")
done

FAIL=0
for f in $FILES; do
  # Skip files that no longer exist on disk (deletion staged)
  [ -f "$f" ] || continue
  for pat in "${PATTERNS[@]}"; do
    if grep -InE "${EXCLUDE_ARGS[@]}" "$pat" "$f" 2>/dev/null; then
      echo "  ^^^ $f matches secret pattern: $pat" >&2
      FAIL=1
    fi
  done
done

if [ "$FAIL" -ne 0 ]; then
  cat >&2 <<'ERR'

[scan-secrets] Secret-shaped string found in staged changes. Either:
  1. Remove it — use Doppler/env vars instead.
  2. If it is a test fixture, rename the variable so it does not match
     (avoid literal sk-.../eyJ.../ghp_...) OR commit with:
       SKIP_SECRET_SCAN=1 git commit -m "test: add fixture (secret scan skipped — synthetic)"
ERR
  exit 1
fi
