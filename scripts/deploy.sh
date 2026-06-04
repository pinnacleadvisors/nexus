#!/usr/bin/env bash
# Manual deploy.
#
# PRIMARY target = the **Mac mini local-OS stack** (OrbStack + plain
# docker-compose at services/local-os/) per ADR 011 — `docker compose up -d
# --build <service>`. This is where the platform runs since 2026-06-04.
#
# KVM4 (Coolify) is **FALLBACK ONLY** until the Hostinger plan expires
# 2026-06-28 — pass `--kvm4` to deploy there via the Coolify API instead.
# Vercel is disabled in lean mode.
#
# Run when you want to ship local changes — not on every commit.
#
# ─── USAGE ──────────────────────────────────────────────────────────────────
#   ./scripts/deploy.sh                      # interactive picker (Mac)
#   ./scripts/deploy.sh --nexus-app          # rebuild+restart nexus-app on the Mac
#   ./scripts/deploy.sh --all                # rebuild+restart the whole Mac stack
#   ./scripts/deploy.sh --claude --codex     # claude-gateway + codex-gateway (Mac)
#   ./scripts/deploy.sh --cron               # cron-runner (Mac)
#   ./scripts/deploy.sh --skip-typecheck --nexus-app
#   ./scripts/deploy.sh --kvm4 --nexus-app   # legacy Coolify deploy (fallback host)
#
# Mac services (services/local-os/docker-compose.yaml): nexus-app,
#   claude-gateway, codex-gateway, nexus-sandbox, cron-runner, cloudflared.
#   (qa-runner + firecrawl live on KVM4 only → use --kvm4 for those.)
#
# KVM4 env (only with --kvm4): COOLIFY_KVM4_URL, COOLIFY_KVM4_API_TOKEN,
#   COOLIFY_KVM4_{NEXUS_APP,NEXUS_SANDBOX,CLAUDE,CODEX,QA,FIRECRAWL}_UUID.
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || dirname "${BASH_SOURCE[0]}")"

COMPOSE_FILE="services/local-os/docker-compose.yaml"
ENV_FILE="services/local-os/.env"

if [ -t 1 ]; then G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; X=$'\033[0m'; else G= R= Y= B= X=; fi
ok()   { printf '%s✓%s %s\n' "$G" "$X" "$1"; }
warn() { printf '%s⚠%s %s\n' "$Y" "$X" "$1"; }
err()  { printf '%s✘%s %s\n' "$R" "$X" "$1" >&2; }
hdr()  { printf '\n%s── %s ──%s\n' "$B" "$1" "$X"; }

use_kvm4=0; do_typecheck=1; interactive=1
do_nexus_app=0; do_nexus_sandbox=0; do_claude=0; do_codex=0; do_cron=0; do_cloudflared=0; do_qa=0; do_firecrawl=0

while [ $# -gt 0 ]; do
  case "$1" in
    --kvm4)           use_kvm4=1 ;;
    --all)
      do_nexus_app=1; do_nexus_sandbox=1; do_claude=1; do_codex=1; do_cron=1; do_cloudflared=1; interactive=0 ;;
    --nexus-app)      do_nexus_app=1;      interactive=0 ;;
    --nexus-sandbox)  do_nexus_sandbox=1;  interactive=0 ;;
    --claude)         do_claude=1;         interactive=0 ;;
    --codex)          do_codex=1;          interactive=0 ;;
    --cron)           do_cron=1;           interactive=0 ;;
    --cloudflared)    do_cloudflared=1;    interactive=0 ;;
    --qa)             do_qa=1; use_kvm4=1; interactive=0 ;;       # KVM4-only service
    --firecrawl)      do_firecrawl=1; use_kvm4=1; interactive=0 ;; # KVM4-only service
    --vercel)         err "--vercel is disabled in lean mode"; exit 2 ;;
    --skip-typecheck) do_typecheck=0 ;;
    -h|--help)        sed -n '2,40p' "$0"; exit 0 ;;
    *) err "unknown flag: $1"; exit 2 ;;
  esac
  shift
done

if [ $interactive = 1 ]; then
  host=$([ $use_kvm4 = 1 ] && echo KVM4 || echo Mac)
  read -rp "Deploy nexus-app      ($host)? (y/N) " a; [[ "$a" =~ ^[Yy] ]] && do_nexus_app=1
  read -rp "Deploy claude-gateway ($host)? (y/N) " a; [[ "$a" =~ ^[Yy] ]] && do_claude=1
  read -rp "Deploy codex-gateway  ($host)? (y/N) " a; [[ "$a" =~ ^[Yy] ]] && do_codex=1
  read -rp "Deploy nexus-sandbox  ($host)? (y/N) " a; [[ "$a" =~ ^[Yy] ]] && do_nexus_sandbox=1
  [ $use_kvm4 = 0 ] && { read -rp "Deploy cron-runner    (Mac)? (y/N) " a; [[ "$a" =~ ^[Yy] ]] && do_cron=1; }
fi

if [ $((do_nexus_app+do_nexus_sandbox+do_claude+do_codex+do_cron+do_cloudflared+do_qa+do_firecrawl)) = 0 ]; then
  warn "nothing selected — exiting"; exit 0
fi

# ─── pre-flight typecheck ───────────────────────────────────────────────────
if [ $do_typecheck = 1 ]; then
  hdr "typecheck"
  [ -d node_modules ] || { printf 'installing root deps...\n'; npm install --no-audit --no-fund >/dev/null; }
  rm -rf .next/types .next/dev/types
  if npx tsc --noEmit; then ok "typecheck clean"; else err "typecheck failed — fix or pass --skip-typecheck"; exit 1; fi
fi

require_env() { local v="$1"; if [ -z "${!v:-}" ]; then err "missing env var: $v"; [ -n "${2:-}" ] && printf '   hint: %s\n' "$2"; exit 3; fi; }

# ─── KVM4 fallback (Coolify API) ────────────────────────────────────────────
deploy_coolify() {
  local label="$1" url="$2" token="$3" uuid="$4"
  hdr "$label"
  local api="${url%/}/api/v1/deploy?uuid=${uuid}&force=true"
  printf 'POST %s\n' "$api"
  local r http body; r=$(curl -sS -w '\n%{http_code}' -X POST "$api" -H "Authorization: Bearer $token" || true)
  http=$(printf '%s' "$r" | tail -n1); body=$(printf '%s' "$r" | sed '$d')
  case "$http" in 200|201|202) ok "$label queued (HTTP $http)"; [ -n "$body" ] && printf '   %s\n' "$body" ;;
    *) err "$label failed (HTTP $http)"; [ -n "$body" ] && printf '   %s\n' "$body"; return 1 ;; esac
}

if [ $use_kvm4 = 1 ]; then
  warn "KVM4 is FALLBACK ONLY (Hostinger expires 2026-06-28). Primary is the Mac — drop --kvm4 to deploy there."
  require_env COOLIFY_KVM4_URL "e.g. https://coolify.coolifycloudtunnel.uk"
  require_env COOLIFY_KVM4_API_TOKEN "Coolify → Security → API Tokens"
  u="$COOLIFY_KVM4_URL"; t="$COOLIFY_KVM4_API_TOKEN"
  [ $do_nexus_app     = 1 ] && { require_env COOLIFY_KVM4_NEXUS_APP_UUID;     deploy_coolify "nexus-app (KVM4)"      "$u" "$t" "$COOLIFY_KVM4_NEXUS_APP_UUID"; }
  [ $do_nexus_sandbox = 1 ] && { require_env COOLIFY_KVM4_NEXUS_SANDBOX_UUID; deploy_coolify "nexus-sandbox (KVM4)"  "$u" "$t" "$COOLIFY_KVM4_NEXUS_SANDBOX_UUID"; }
  [ $do_claude        = 1 ] && { require_env COOLIFY_KVM4_CLAUDE_UUID;        deploy_coolify "claude-gateway (KVM4)" "$u" "$t" "$COOLIFY_KVM4_CLAUDE_UUID"; }
  [ $do_codex         = 1 ] && { require_env COOLIFY_KVM4_CODEX_UUID;         deploy_coolify "codex-gateway (KVM4)"  "$u" "$t" "$COOLIFY_KVM4_CODEX_UUID"; }
  [ $do_qa            = 1 ] && { require_env COOLIFY_KVM4_QA_UUID;            deploy_coolify "qa-runner (KVM4)"      "$u" "$t" "$COOLIFY_KVM4_QA_UUID"; }
  [ $do_firecrawl     = 1 ] && { require_env COOLIFY_KVM4_FIRECRAWL_UUID;     deploy_coolify "firecrawl (KVM4)"      "$u" "$t" "$COOLIFY_KVM4_FIRECRAWL_UUID"; }
  hdr "done"; ok "KVM4 deploys queued — watch: $u → <service> → Logs"; exit 0
fi

# ─── Mac local-os deploy (primary) ──────────────────────────────────────────
command -v docker >/dev/null 2>&1 || { err "docker not found — is OrbStack running?"; exit 3; }
[ -f "$ENV_FILE" ] || { err "$ENV_FILE missing (the DOPPLER_TOKEN service token). See services/local-os/README.md"; exit 3; }

svcs=()
[ $do_nexus_app     = 1 ] && svcs+=(nexus-app)
[ $do_claude        = 1 ] && svcs+=(claude-gateway)
[ $do_codex         = 1 ] && svcs+=(codex-gateway)
[ $do_nexus_sandbox = 1 ] && svcs+=(nexus-sandbox)
[ $do_cron          = 1 ] && svcs+=(cron-runner)
[ $do_cloudflared   = 1 ] && svcs+=(cloudflared)

hdr "Mac local-os deploy"
printf 'docker compose up -d --build %s\n' "${svcs[*]}"
set -a; . "$ENV_FILE"; set +a
docker network inspect coolify >/dev/null 2>&1 || docker network create coolify >/dev/null
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build "${svcs[@]}"

hdr "done"
docker compose -f "$COMPOSE_FILE" ps --format '{{.Service}}: {{.Status}}' 2>/dev/null || true
ok "rebuilt + restarted: ${svcs[*]}"
printf '\nWatch logs:  docker compose -f %s logs -f <service>\n' "$COMPOSE_FILE"
