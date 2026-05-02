#!/usr/bin/env bash
# Manual deploy: Vercel + Coolify (claude-gateway, codex-gateway, qa-runner).
#
# Triggers fresh deploys without waiting for git auto-deploy. Run when you
# want to test platform changes — not on every commit.
#
# ─── ONE-TIME SETUP ─────────────────────────────────────────────────────────
#
# 1. Disable auto-deploy in Vercel:
#    vercel.com/<team>/<project>/settings/git → Production Branch: blank
#    (or toggle off "Automatically deploy" entirely)
#
# 2. Disable auto-deploy in each Coolify resource:
#    Coolify → Resource → Configuration → Advanced → toggle OFF
#    "Auto deploy on Git push". Do this for: claude-gateway (KVM4),
#    codex-gateway (KVM2), qa-runner (KVM4), cloudflared-* if applicable.
#
# 3. Generate API tokens:
#    a) Vercel:  vercel.com/account/tokens → Create Token (full scope)
#    b) Coolify: <coolify-url>/security/api-tokens → New Token
#                Generate one per Coolify instance (KVM4 + KVM2).
#
# 4. Find each resource's UUID:
#    Open the resource in Coolify v4 — the URL ends in `.../application/<UUID>`.
#    Copy the last UUID. Or:
#    curl -H "Authorization: Bearer $TOKEN" $COOLIFY_URL/api/v1/applications | jq
#
# 5. Export env vars in your shell (~/.zshrc or via 'doppler run --'):
#    Required:
#      VERCEL_TOKEN              VERCEL_TEAM_ID (optional)
#      COOLIFY_KVM4_URL          COOLIFY_KVM4_API_TOKEN
#      COOLIFY_KVM4_CLAUDE_UUID
#    Optional (per service deployed):
#      COOLIFY_KVM4_QA_UUID
#      COOLIFY_KVM2_URL          COOLIFY_KVM2_API_TOKEN
#      COOLIFY_KVM2_CODEX_UUID
#
# ─── USAGE ──────────────────────────────────────────────────────────────────
#
#   ./scripts/deploy.sh                         # interactive picker
#   ./scripts/deploy.sh --all
#   ./scripts/deploy.sh --vercel
#   ./scripts/deploy.sh --claude --codex
#   ./scripts/deploy.sh --skip-typecheck --all  # bypass tsc gate

set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || dirname "${BASH_SOURCE[0]}")"

if [ -t 1 ]; then
  G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; X=$'\033[0m'
else
  G= R= Y= B= X=
fi
ok()   { printf '%s✓%s %s\n' "$G" "$X" "$1"; }
warn() { printf '%s⚠%s %s\n' "$Y" "$X" "$1"; }
err()  { printf '%s✘%s %s\n' "$R" "$X" "$1" >&2; }
hdr()  { printf '\n%s── %s ──%s\n' "$B" "$1" "$X"; }

do_vercel=0; do_claude=0; do_codex=0; do_qa=0; do_typecheck=1; interactive=1

while [ $# -gt 0 ]; do
  case "$1" in
    --all)
      do_vercel=1
      # In --all mode, only auto-include a Coolify service if its UUID env
      # var is set. Lets you skip services you haven't deployed yet (e.g.
      # qa-runner) without configuring placeholder env vars. Explicit
      # --claude / --codex / --qa still hard-requires the UUID.
      [ -n "${COOLIFY_KVM4_CLAUDE_UUID:-}" ] && do_claude=1
      [ -n "${COOLIFY_KVM4_QA_UUID:-}"     ] && do_qa=1
      [ -n "${COOLIFY_KVM2_CODEX_UUID:-}"  ] && do_codex=1
      interactive=0
      ;;
    --vercel)         do_vercel=1; interactive=0 ;;
    --claude)         do_claude=1; interactive=0 ;;
    --codex)          do_codex=1;  interactive=0 ;;
    --qa)             do_qa=1;     interactive=0 ;;
    --skip-typecheck) do_typecheck=0 ;;
    -h|--help)        sed -n '2,45p' "$0"; exit 0 ;;
    *) err "unknown flag: $1"; exit 2 ;;
  esac
  shift
done

if [ $interactive = 1 ]; then
  read -rp "Deploy Vercel?              (y/N) " a; [[ "$a" =~ ^[Yy] ]] && do_vercel=1
  read -rp "Deploy claude-gateway (KVM4)? (y/N) " a; [[ "$a" =~ ^[Yy] ]] && do_claude=1
  read -rp "Deploy codex-gateway  (KVM2)? (y/N) " a; [[ "$a" =~ ^[Yy] ]] && do_codex=1
  read -rp "Deploy qa-runner      (KVM4)? (y/N) " a; [[ "$a" =~ ^[Yy] ]] && do_qa=1
fi

if [ $do_vercel = 0 ] && [ $do_claude = 0 ] && [ $do_codex = 0 ] && [ $do_qa = 0 ]; then
  warn "nothing selected — exiting"
  exit 0
fi

# Sourced helpers below this line.

# ─── git status hint ────────────────────────────────────────────────────────
hdr "git status"
git_branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "(detached)")
git_dirty=$(git status --porcelain | wc -l | tr -d ' ')
git_unpushed=$(git rev-list "@{u}.." 2>/dev/null | wc -l | tr -d ' ' || echo 0)
printf 'branch: %s · uncommitted: %s · unpushed: %s\n' "$git_branch" "$git_dirty" "$git_unpushed"

if [ "$git_dirty" -gt 0 ] || [ "$git_unpushed" -gt 0 ]; then
  warn "Vercel + Coolify deploy from origin — uncommitted/unpushed changes won't appear in the new build"
  read -rp "continue anyway? (y/N) " a
  [[ "$a" =~ ^[Yy] ]] || exit 0
fi

# ─── pre-flight typecheck (only when Vercel is in the set) ──────────────────
if [ $do_typecheck = 1 ] && [ $do_vercel = 1 ]; then
  hdr "typecheck"
  if [ ! -d node_modules ]; then
    printf 'installing root deps (npm install)...\n'
    npm install --no-audit --no-fund >/dev/null
  fi
  if npx tsc --noEmit; then
    ok "typecheck clean"
  else
    err "typecheck failed — fix errors or pass --skip-typecheck"
    exit 1
  fi
fi

require_env() {
  local var="$1" hint="${2:-}"
  if [ -z "${!var:-}" ]; then
    err "missing env var: $var"
    [ -n "$hint" ] && printf '   hint: %s\n' "$hint"
    exit 3
  fi
}

deploy_coolify() {
  local label="$1" url="$2" token="$3" uuid="$4"
  hdr "$label"
  local api="${url%/}/api/v1/deploy?uuid=${uuid}&force=true"
  printf 'POST %s\n' "$api"
  local response http body
  response=$(curl -sS -w '\n%{http_code}' \
    -X POST "$api" \
    -H "Authorization: Bearer $token" || true)
  http=$(printf '%s' "$response" | tail -n1)
  body=$(printf '%s' "$response" | sed '$d')
  case "$http" in
    200|201|202)
      ok "$label deploy queued (HTTP $http)"
      [ -n "$body" ] && printf '   %s\n' "$body" ;;
    *)
      err "$label deploy failed (HTTP $http)"
      [ -n "$body" ] && printf '   %s\n' "$body"
      return 1 ;;
  esac
}

# ─── Vercel ─────────────────────────────────────────────────────────────────
if [ $do_vercel = 1 ]; then
  require_env VERCEL_TOKEN "https://vercel.com/account/tokens"
  hdr "Vercel"
  # Use vercel via npx by default — avoids the permission issue when
  # /usr/local/lib/node_modules is owned by root (default on macOS). If you
  # already have vercel installed via 'sudo npm i -g vercel' or 'brew install
  # vercel-cli', that wins because it's faster.
  if command -v vercel >/dev/null 2>&1; then
    vercel_cmd=(vercel)
  else
    printf 'vercel CLI not on PATH — using npx (first run fetches ~80MB to cache)\n'
    vercel_cmd=(npx --yes vercel@latest)
  fi
  vercel_args=(deploy --prod --token "$VERCEL_TOKEN" --yes)
  [ -n "${VERCEL_TEAM_ID:-}" ] && vercel_args+=(--scope "$VERCEL_TEAM_ID")
  printf '%s %s\n' "${vercel_cmd[*]}" "${vercel_args[*]}"
  if "${vercel_cmd[@]}" "${vercel_args[@]}"; then
    ok "Vercel production deploy triggered"
  else
    err "Vercel deploy failed"
    exit 1
  fi
fi

# ─── claude-gateway (KVM4) ──────────────────────────────────────────────────
if [ $do_claude = 1 ]; then
  require_env COOLIFY_KVM4_URL          "e.g. http://<kvm4-ip>:8000"
  require_env COOLIFY_KVM4_API_TOKEN    "Coolify → Security → API Tokens"
  require_env COOLIFY_KVM4_CLAUDE_UUID  "Coolify → claude-gateway resource URL → last UUID"
  deploy_coolify "claude-gateway (KVM4)" \
    "$COOLIFY_KVM4_URL" "$COOLIFY_KVM4_API_TOKEN" "$COOLIFY_KVM4_CLAUDE_UUID"
fi

# ─── qa-runner (KVM4) ───────────────────────────────────────────────────────
if [ $do_qa = 1 ]; then
  require_env COOLIFY_KVM4_URL
  require_env COOLIFY_KVM4_API_TOKEN
  require_env COOLIFY_KVM4_QA_UUID "Coolify → qa-runner resource URL → last UUID"
  deploy_coolify "qa-runner (KVM4)" \
    "$COOLIFY_KVM4_URL" "$COOLIFY_KVM4_API_TOKEN" "$COOLIFY_KVM4_QA_UUID"
fi

# ─── codex-gateway (KVM2) ───────────────────────────────────────────────────
if [ $do_codex = 1 ]; then
  require_env COOLIFY_KVM2_URL          "e.g. http://72.62.244.75:8000"
  require_env COOLIFY_KVM2_API_TOKEN    "Coolify on KVM2 → Security → API Tokens"
  require_env COOLIFY_KVM2_CODEX_UUID   "Coolify → codex-gateway resource URL → last UUID"
  deploy_coolify "codex-gateway (KVM2)" \
    "$COOLIFY_KVM2_URL" "$COOLIFY_KVM2_API_TOKEN" "$COOLIFY_KVM2_CODEX_UUID"
fi

# ─── done ───────────────────────────────────────────────────────────────────
hdr "done"
ok "all selected deploys triggered"
printf '\nWatch logs:\n'
[ $do_vercel = 1 ] && printf '  vercel: vercel logs --token $VERCEL_TOKEN --follow\n'
[ $do_claude = 1 ] && printf '  claude: %s → claude-gateway → Logs\n' "$COOLIFY_KVM4_URL"
[ $do_codex  = 1 ] && printf '  codex:  %s → codex-gateway → Logs\n' "$COOLIFY_KVM2_URL"
[ $do_qa     = 1 ] && printf '  qa:     %s → qa-runner → Logs\n' "$COOLIFY_KVM4_URL"
