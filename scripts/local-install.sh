#!/usr/bin/env bash
#
# scripts/local-install.sh — one-command Nexus self-host bootstrap.
#
# Phase 3 of task_plan-desktop-app.md. Brings up the docker-compose.local
# stack (nexus + postgres + ollama), creates the ~/.nexus home directory,
# pulls a default Ollama model, and prints the install URL.
#
# Usage:
#   ./scripts/local-install.sh          # full bootstrap
#   ./scripts/local-install.sh --start  # just start the stack
#   ./scripts/local-install.sh --stop   # stop without removing data
#
# Idempotent — safe to re-run. Existing data in nexus_db_data / nexus_ollama_data
# volumes is preserved across `up -d` cycles.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NEXUS_HOME="${HOME}/.nexus"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.local.yaml"
DEFAULT_OLLAMA_MODEL="${NEXUS_OLLAMA_MODEL:-llama3.3:latest}"

# ── helpers ─────────────────────────────────────────────────────────────────

info()    { printf '\033[36m[info]\033[0m  %s\n' "$1"; }
ok()      { printf '\033[32m[ok]\033[0m    %s\n' "$1"; }
warn()    { printf '\033[33m[warn]\033[0m  %s\n' "$1"; }
err()     { printf '\033[31m[err]\033[0m   %s\n' "$1" 1>&2; }

require() {
  command -v "$1" >/dev/null 2>&1 || { err "missing dependency: $1"; exit 1; }
}

stop_stack() {
  info "stopping nexus local stack (data volumes preserved)"
  docker compose -f "$COMPOSE_FILE" down
}

start_stack() {
  info "starting nexus local stack on docker-compose.local.yaml"
  docker compose -f "$COMPOSE_FILE" up -d
}

ensure_home() {
  if [ ! -d "$NEXUS_HOME" ]; then
    info "creating $NEXUS_HOME"
    mkdir -p "$NEXUS_HOME/uploads"
    printf '{}\n' > "$NEXUS_HOME/secrets.json"
    chmod 700 "$NEXUS_HOME"
    chmod 600 "$NEXUS_HOME/secrets.json"
    ok "operator-managed home directory ready at $NEXUS_HOME"
  else
    ok "$NEXUS_HOME already exists"
  fi
}

pull_default_model() {
  info "pulling default Ollama model ($DEFAULT_OLLAMA_MODEL) — this can take 5-10 min on first run"
  # Wait for ollama container to be ready (up to 60s)
  for i in $(seq 1 30); do
    if docker compose -f "$COMPOSE_FILE" exec -T ollama ollama list >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  docker compose -f "$COMPOSE_FILE" exec -T ollama ollama pull "$DEFAULT_OLLAMA_MODEL" || warn "ollama pull failed — operator can retry later"
}

print_status() {
  echo
  ok "nexus running at http://localhost:${NEXUS_PORT:-3000}"
  echo
  printf '  postgres : localhost:%s  (user nexus, pass nexus, db nexus)\n' "${POSTGRES_PORT:-5433}"
  printf '  ollama   : localhost:%s  (model: %s)\n'                       "${OLLAMA_PORT:-11434}" "$DEFAULT_OLLAMA_MODEL"
  printf '  home     : %s\n'                                              "$NEXUS_HOME"
  echo
  printf '  next: install the PWA from http://localhost:%s — your browser will add\n'  "${NEXUS_PORT:-3000}"
  printf '        a desktop icon. Edit secrets in %s/secrets.json as needed.\n'        "$NEXUS_HOME"
  printf '        Switch to remote: install the PWA from https://nexus.coolifycloudtunnel.uk.\n'
  echo
}

# ── main ────────────────────────────────────────────────────────────────────

require docker

case "${1:-}" in
  --start)
    start_stack
    print_status
    exit 0
    ;;
  --stop)
    stop_stack
    ok "stopped (run again without --stop to bring it back up)"
    exit 0
    ;;
  --help|-h)
    sed -n '4,18p' "$0"
    exit 0
    ;;
esac

info "bootstrapping nexus local install"
ensure_home
start_stack
pull_default_model
print_status
