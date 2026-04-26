#!/usr/bin/env bash
set -euo pipefail

: "${BUSINESS_NAME:?must be set}"
: "${BUSINESS_ROLE:?must be set}"
: "${OPENCLAW_BEARER_TOKEN:?must be set}"
: "${ANTHROPIC_API_KEY:?must be set}"
BUSINESS_BOUNDARIES="${BUSINESS_BOUNDARIES:-Default Felix-style boundaries}"
BUSINESS_VOICE="${BUSINESS_VOICE:-Intellectually sharp but warm; concise by default}"
OPERATOR_NAME="${OPERATOR_NAME:-Owner}"
TRUSTED_CHANNEL="${TRUSTED_CHANNEL:-Slack}"

WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
mkdir -p "${WORKSPACE_DIR}"

if [ ! -f "${WORKSPACE_DIR}/SOUL.md" ]; then
  for f in SOUL.md IDENTITY.md MEMORY.md AGENTS.md; do
    BUSINESS_NAME BUSINESS_ROLE BUSINESS_BOUNDARIES BUSINESS_VOICE OPERATOR_NAME TRUSTED_CHANNEL \
      envsubst < "/opt/workspace-template/${f}" > "${WORKSPACE_DIR}/${f}"
  done
fi

if [ ! -d "${WORKSPACE_DIR}/.git" ]; then
  git -C "${WORKSPACE_DIR}" init -q
  git -C "${WORKSPACE_DIR}" config user.email "claw@${BUSINESS_NAME,,}.local"
  git -C "${WORKSPACE_DIR}" config user.name "${BUSINESS_NAME} (OpenClaw)"
  git -C "${WORKSPACE_DIR}" add -A
  git -C "${WORKSPACE_DIR}" commit -q -m "init: ${BUSINESS_NAME} workspace from template"
fi

export ANTHROPIC_API_KEY OPENCLAW_BEARER_TOKEN
exec openclaw start \
  --workspace="${WORKSPACE_DIR}" \
  --port="${OPENCLAW_PORT:-18789}" \
  --bind="${OPENCLAW_BIND:-loopback}"
