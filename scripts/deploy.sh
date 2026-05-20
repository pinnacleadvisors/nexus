#!/usr/bin/env bash
# Manual deploy: Coolify only (lean mode).
#
# Vercel deploy is currently DISABLED — the platform runs entirely on
# Coolify on KVM4 (nexus-app, nexus-sandbox, claude-gateway, codex-gateway,
# etc.) behind the cloudflared tunnel on coolifycloudtunnel.uk. To
# re-enable Vercel later (e.g. when paying users arrive and we want the
# CDN + global edge again), uncomment the blocks marked
# `# [vercel-disabled]` and remove the early-exit in the --vercel handler.
#
# Triggers fresh deploys without waiting for git auto-deploy. Run when you
# want to test platform changes — not on every commit.
#
# ─── ONE-TIME SETUP ─────────────────────────────────────────────────────────
#
# 1. (Vercel — disabled in lean mode; ignore unless re-enabling.)
#    vercel.com/<team>/<project>/settings/git → Production Branch: blank
#    (or toggle off "Automatically deploy" entirely)
#
# 2. Disable auto-deploy in each Coolify resource:
#    Coolify → Resource → Configuration → Advanced → toggle OFF
#    "Auto deploy on Git push". Do this for: claude-gateway (KVM4),
#    codex-gateway (KVM2), qa-runner (KVM4), cloudflared-* if applicable.
#
# 3. Generate API tokens:
#    a) (Vercel — disabled in lean mode.)
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
#      COOLIFY_KVM4_URL          COOLIFY_KVM4_API_TOKEN
#      COOLIFY_KVM4_NEXUS_APP_UUID
#    Optional (per service deployed):
#      COOLIFY_KVM4_NEXUS_SANDBOX_UUID
#      COOLIFY_KVM4_CLAUDE_UUID
#      COOLIFY_KVM4_CODEX_UUID
#      COOLIFY_KVM4_QA_UUID
#      COOLIFY_KVM4_FIRECRAWL_UUID
#      COOLIFY_KVM2_URL          COOLIFY_KVM2_API_TOKEN
#      COOLIFY_KVM2_CODEX_UUID   (legacy fallback for codex-gateway)
#    (Vercel — disabled in lean mode.)
#      VERCEL_TOKEN              VERCEL_TEAM_ID
#
# ─── USAGE ──────────────────────────────────────────────────────────────────
#
#   ./scripts/deploy.sh                         # interactive picker
#   ./scripts/deploy.sh --all
#   ./scripts/deploy.sh --nexus-app             # the Next.js platform itself, on KVM4 (lean mode)
#   ./scripts/deploy.sh --nexus-sandbox         # rootless-Podman exec sandbox, KVM4
#   ./scripts/deploy.sh --claude --codex
#   ./scripts/deploy.sh --firecrawl
#   ./scripts/deploy.sh --skip-typecheck --all  # bypass tsc gate
#   # --vercel is disabled in lean mode (lean=Coolify only).
#
# Lean-mode default = everything on KVM4. The codex-gateway --codex flag
# below defaults to KVM4 (where the new lean stack lives) and falls back
# to KVM2 if COOLIFY_KVM4_CODEX_UUID is unset.
#
# NOTE: cloudflared (the tunnel connector) does NOT need to be redeployed
# when testing platform features. It's a stateless tunnel daemon — it routes
# inbound traffic to whatever container is currently behind the alias and
# stays running across gateway restarts. Only redeploy cloudflared if you
# rotate the tunnel token or bump its image.

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

do_vercel=0; do_nexus_app=0; do_nexus_sandbox=0
do_claude=0; do_codex=0; do_qa=0; do_firecrawl=0
do_typecheck=1; interactive=1

while [ $# -gt 0 ]; do
  case "$1" in
    --all)
      # [vercel-disabled] # do_vercel=1
      # In --all mode, only auto-include a Coolify service if its UUID env
      # var is set. Lets you skip services you haven't deployed yet without
      # configuring placeholder env vars. Explicit --<service> still hard-
      # requires the UUID.
      [ -n "${COOLIFY_KVM4_NEXUS_APP_UUID:-}"     ] && do_nexus_app=1
      [ -n "${COOLIFY_KVM4_NEXUS_SANDBOX_UUID:-}" ] && do_nexus_sandbox=1
      [ -n "${COOLIFY_KVM4_CLAUDE_UUID:-}"        ] && do_claude=1
      [ -n "${COOLIFY_KVM4_QA_UUID:-}"            ] && do_qa=1
      [ -n "${COOLIFY_KVM4_FIRECRAWL_UUID:-}"     ] && do_firecrawl=1
      # codex-gateway lean-mode lives on KVM4; KVM2 is the legacy location.
      # Prefer KVM4 if its UUID is set, fall back to KVM2.
      [ -n "${COOLIFY_KVM4_CODEX_UUID:-}" ] || [ -n "${COOLIFY_KVM2_CODEX_UUID:-}" ] && do_codex=1
      interactive=0
      ;;
    --vercel)
      err "--vercel is disabled in lean mode (lean=Coolify only). To re-enable, uncomment the [vercel-disabled] blocks in this script."
      exit 2
      ;;
    --nexus-app)      do_nexus_app=1;       interactive=0 ;;
    --nexus-sandbox)  do_nexus_sandbox=1;   interactive=0 ;;
    --claude)         do_claude=1;          interactive=0 ;;
    --codex)          do_codex=1;           interactive=0 ;;
    --qa)             do_qa=1;              interactive=0 ;;
    --firecrawl)      do_firecrawl=1;       interactive=0 ;;
    --skip-typecheck) do_typecheck=0 ;;
    -h|--help)        sed -n '2,68p' "$0"; exit 0 ;;
    *) err "unknown flag: $1"; exit 2 ;;
  esac
  shift
done

if [ $interactive = 1 ]; then
  read -rp "Deploy nexus-app     (KVM4)? (y/N) " a; [[ "$a" =~ ^[Yy] ]] && do_nexus_app=1
  read -rp "Deploy nexus-sandbox (KVM4)? (y/N) " a; [[ "$a" =~ ^[Yy] ]] && do_nexus_sandbox=1
  read -rp "Deploy claude-gateway (KVM4)? (y/N) " a; [[ "$a" =~ ^[Yy] ]] && do_claude=1
  read -rp "Deploy codex-gateway  (KVM4)? (y/N) " a; [[ "$a" =~ ^[Yy] ]] && do_codex=1
  read -rp "Deploy qa-runner      (KVM4)? (y/N) " a; [[ "$a" =~ ^[Yy] ]] && do_qa=1
  read -rp "Deploy firecrawl      (KVM4)? (y/N) " a; [[ "$a" =~ ^[Yy] ]] && do_firecrawl=1
  # [vercel-disabled] # read -rp "Deploy Vercel?               (y/N) " a; [[ "$a" =~ ^[Yy] ]] && do_vercel=1
fi

if [ $do_vercel = 0 ] && [ $do_nexus_app = 0 ] && [ $do_nexus_sandbox = 0 ] \
  && [ $do_claude = 0 ] && [ $do_codex = 0 ] && [ $do_qa = 0 ] && [ $do_firecrawl = 0 ]; then
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

# ─── pre-flight typecheck ───────────────────────────────────────────────────
# Was gated on Vercel-included only; with Vercel disabled in lean mode it
# would never run. Coolify rebuilds in-container with its own typecheck, but
# catching errors locally saves a ~3-min container build round-trip. Skip
# with --skip-typecheck for rapid iteration on non-TS changes.
if [ $do_typecheck = 1 ]; then
  hdr "typecheck"
  if [ ! -d node_modules ]; then
    printf 'installing root deps (npm install)...\n'
    npm install --no-audit --no-fund >/dev/null
  fi
  # Drop stale typed-route validator artefacts before tsc runs. Next.js
  # generates .next/types/validator.ts with one `typeof import()` per
  # page.tsx it finds; tsconfig.json includes that path. If a previous
  # build mapped a route that has since been deleted (e.g. /tools/page.tsx
  # → ce29955), the stale validator still imports the missing module and
  # tsc fails with TS2307 "Cannot find module .../page.js" until next
  # build regenerates it. Vercel does its own fresh build, so wiping the
  # local artefacts here costs us nothing.
  rm -rf .next/types .next/dev/types
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

# ─── Vercel (DISABLED in lean mode) ─────────────────────────────────────────
# [vercel-disabled] Uncomment this block and the `do_vercel=1` lines above
# (--all handler, --vercel handler, interactive prompt) to re-enable a
# parallel Vercel deploy. Lean mode runs entirely on Coolify; this block is
# preserved for the eventual paying-user phase.
# if [ $do_vercel = 1 ]; then
#   require_env VERCEL_TOKEN "https://vercel.com/account/tokens"
#   hdr "Vercel"
#   # Use vercel via npx by default — avoids the permission issue when
#   # /usr/local/lib/node_modules is owned by root (default on macOS). If you
#   # already have vercel installed via 'sudo npm i -g vercel' or 'brew install
#   # vercel-cli', that wins because it's faster.
#   if command -v vercel >/dev/null 2>&1; then
#     vercel_cmd=(vercel)
#   else
#     printf 'vercel CLI not on PATH — using npx (first run fetches ~80MB to cache)\n'
#     vercel_cmd=(npx --yes vercel@latest)
#   fi
#   vercel_args=(deploy --prod --token "$VERCEL_TOKEN" --yes)
#   [ -n "${VERCEL_TEAM_ID:-}" ] && vercel_args+=(--scope "$VERCEL_TEAM_ID")
#   printf '%s %s\n' "${vercel_cmd[*]}" "${vercel_args[*]}"
#   if "${vercel_cmd[@]}" "${vercel_args[@]}"; then
#     ok "Vercel production deploy triggered"
#   else
#     err "Vercel deploy failed"
#     exit 1
#   fi
# fi

# ─── nexus-app (KVM4) — the Next.js platform itself in lean mode ────────────
if [ $do_nexus_app = 1 ]; then
  require_env COOLIFY_KVM4_URL              "e.g. https://coolify.coolifycloudtunnel.uk"
  require_env COOLIFY_KVM4_API_TOKEN        "Coolify → Security → API Tokens"
  require_env COOLIFY_KVM4_NEXUS_APP_UUID   "Coolify → nexus-app resource URL → last UUID"
  deploy_coolify "nexus-app (KVM4)" \
    "$COOLIFY_KVM4_URL" "$COOLIFY_KVM4_API_TOKEN" "$COOLIFY_KVM4_NEXUS_APP_UUID"
fi

# ─── nexus-sandbox (KVM4) — rootless-Podman exec sandbox ────────────────────
if [ $do_nexus_sandbox = 1 ]; then
  require_env COOLIFY_KVM4_URL
  require_env COOLIFY_KVM4_API_TOKEN
  require_env COOLIFY_KVM4_NEXUS_SANDBOX_UUID  "Coolify → nexus-sandbox resource URL → last UUID"
  deploy_coolify "nexus-sandbox (KVM4)" \
    "$COOLIFY_KVM4_URL" "$COOLIFY_KVM4_API_TOKEN" "$COOLIFY_KVM4_NEXUS_SANDBOX_UUID"
fi

# ─── claude-gateway (KVM4) ──────────────────────────────────────────────────
if [ $do_claude = 1 ]; then
  require_env COOLIFY_KVM4_URL          "e.g. https://coolify.coolifycloudtunnel.uk"
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

# ─── firecrawl (KVM4) ───────────────────────────────────────────────────────
if [ $do_firecrawl = 1 ]; then
  require_env COOLIFY_KVM4_URL
  require_env COOLIFY_KVM4_API_TOKEN
  require_env COOLIFY_KVM4_FIRECRAWL_UUID "Coolify → firecrawl resource URL → last UUID"
  deploy_coolify "firecrawl (KVM4)" \
    "$COOLIFY_KVM4_URL" "$COOLIFY_KVM4_API_TOKEN" "$COOLIFY_KVM4_FIRECRAWL_UUID"
fi

# ─── codex-gateway — KVM4 (lean mode) preferred, KVM2 (legacy) fallback ─────
if [ $do_codex = 1 ]; then
  if [ -n "${COOLIFY_KVM4_CODEX_UUID:-}" ]; then
    require_env COOLIFY_KVM4_URL
    require_env COOLIFY_KVM4_API_TOKEN
    deploy_coolify "codex-gateway (KVM4)" \
      "$COOLIFY_KVM4_URL" "$COOLIFY_KVM4_API_TOKEN" "$COOLIFY_KVM4_CODEX_UUID"
  elif [ -n "${COOLIFY_KVM2_CODEX_UUID:-}" ]; then
    require_env COOLIFY_KVM2_URL         "legacy KVM2 Coolify URL (lean mode targets KVM4 instead)"
    require_env COOLIFY_KVM2_API_TOKEN   "Coolify on KVM2 → Security → API Tokens"
    deploy_coolify "codex-gateway (KVM2 — legacy)" \
      "$COOLIFY_KVM2_URL" "$COOLIFY_KVM2_API_TOKEN" "$COOLIFY_KVM2_CODEX_UUID"
  else
    err "codex-gateway deploy requested but neither COOLIFY_KVM4_CODEX_UUID nor COOLIFY_KVM2_CODEX_UUID is set"
    exit 3
  fi
fi

# ─── done ───────────────────────────────────────────────────────────────────
hdr "done"
ok "all selected deploys triggered"
printf '\nWatch logs:\n'
# [vercel-disabled] [ $do_vercel        = 1 ] && printf '  vercel:        vercel logs --token $VERCEL_TOKEN --follow\n'
[ $do_nexus_app     = 1 ] && printf '  nexus-app:     %s → nexus-app → Logs\n' "$COOLIFY_KVM4_URL"
[ $do_nexus_sandbox = 1 ] && printf '  nexus-sandbox: %s → nexus-sandbox → Logs\n' "$COOLIFY_KVM4_URL"
[ $do_claude        = 1 ] && printf '  claude:        %s → claude-gateway → Logs\n' "$COOLIFY_KVM4_URL"
[ $do_codex         = 1 ] && printf '  codex:         %s → codex-gateway → Logs\n' "${COOLIFY_KVM4_URL:-${COOLIFY_KVM2_URL:-}}"
[ $do_qa            = 1 ] && printf '  qa:            %s → qa-runner → Logs\n' "$COOLIFY_KVM4_URL"
[ $do_firecrawl     = 1 ] && printf '  firecrawl:     %s → firecrawl → Logs\n' "$COOLIFY_KVM4_URL"
