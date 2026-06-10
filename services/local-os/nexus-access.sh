#!/bin/bash
# nexus-access.sh — toggle PUBLIC web access to the Mac-mini Nexus host.
#
#   on      bring the cloudflared `nexus-mac` tunnel UP  → public hostnames serve
#           (still behind the Cloudflare Access OTP gate). Use this BEFORE you leave.
#   off     take the tunnel DOWN → zero public ingress. Local 127.0.0.1 access on the
#           Mac is unaffected. This is the DEFAULT (boot comes up with no tunnel).
#   status  show current access state + a live public probe.
#
# Mechanism: cloudflared is in the compose `remote-access` profile, so the normal
# `docker compose up -d` (startup.sh / reboot) never starts it — the box defaults to
# OFF. This script is the only thing that starts it. State is sticky across reboot
# (unless-stopped): left ON it survives a reboot; OFF stays off.
#
# ⚠️ Trade-off: the tunnel is also how INBOUND webhooks reach the platform
# (Stripe events, OAuth callbacks → nexus.coolifycloudtunnel.uk). While OFF, those
# are not delivered. If you depend on live webhooks, leave access ON.
#
# Chicken-and-egg: turning ON needs to reach the box, so press `on` while you're still
# on the Mac / local network (before travelling). You can't enable it from the open
# internet once it's off (that's the point). For toggling while already away, use a
# private channel (Tailscale) — see services/local-os/README.md.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE="$REPO/services/local-os/docker-compose.yaml"
ENVFILE="$REPO/services/local-os/.env"
PROFILE="remote-access"
PUBLIC="https://nexus.coolifycloudtunnel.uk"
export PATH="$HOME/.orbstack/bin:/usr/local/bin:/opt/homebrew/bin:/Applications/OrbStack.app/Contents/MacOS/xbin:/usr/bin:/bin"

c(){ printf '\033[1;36m%s\033[0m\n' "$*"; }
ok(){ printf '   \033[32m✓\033[0m %s\n' "$*"; }
die(){ printf '\033[31mABORT: %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker not found (is OrbStack running?)"
[ -f "$COMPOSE" ] || die "compose file missing: $COMPOSE"

dc(){ docker compose -f "$COMPOSE" --env-file "$ENVFILE" --profile "$PROFILE" "$@"; }
running(){ local id; id="$(dc ps -q cloudflared 2>/dev/null)"; [ -n "$id" ] \
  && [ "$(docker inspect -f '{{.State.Running}}' "$id" 2>/dev/null)" = "true" ]; }

probe(){ curl -sS -o /dev/null -w '%{http_code}' --max-time 12 "$PUBLIC" 2>/dev/null || echo "000"; }

case "${1:-status}" in
  on)
    c "Enabling public access (cloudflared up)…"
    dc up -d cloudflared >/dev/null 2>&1 || die "compose up cloudflared failed"
    ok "cloudflared running"
    # Wait for a REAL served response (2xx/3xx). 000 = no answer yet, 5xx (e.g. 530
    # = tunnel error 1033) = connector still registering — keep waiting on both.
    code="000"
    for i in $(seq 1 20); do
      code="$(probe)"; case "$code" in 2*|3*) break;; esac; sleep 2
    done
    case "$code" in
      2*|3*) ok "public access ON — ${PUBLIC} → HTTP ${code} (behind Cloudflare Access OTP)" ;;
      *)     printf '   \033[33m! tunnel up but edge still returns %s (registering) — re-run `npm run access status` in ~15s\033[0m\n' "$code" ;;
    esac
    echo "   Hostnames now reachable: nexus.* · code.* · claude-gw.* · codex-gw.*"
    ;;
  off)
    c "Disabling public access (cloudflared down)…"
    dc stop cloudflared >/dev/null 2>&1 || true
    sleep 1
    if running; then die "cloudflared still running — check 'docker compose -f $COMPOSE ps'"; fi
    ok "cloudflared stopped — NO public ingress"
    ok "local access unaffected: http://127.0.0.1:3000 (nexus-app), :3010 (/code), :3100 (/workforce)"
    printf '   \033[33mnote: inbound webhooks (Stripe / OAuth callbacks) are NOT delivered while OFF.\033[0m\n'
    ;;
  status)
    if running; then
      code="$(probe)"
      c "ACCESS: ON  (public web reachable)"
      ok "${PUBLIC} → HTTP ${code} (302/307 = served behind Access)"
    else
      c "ACCESS: OFF  (default — no public ingress)"
      ok "local only: http://127.0.0.1:3000 / :3010 / :3100"
    fi
    ;;
  *) die "usage: nexus-access.sh [on|off|status]" ;;
esac
