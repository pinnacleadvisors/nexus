#!/usr/bin/env bash
# QMD sidecar entrypoint. Boots in three phases:
#   1. Sync the repo so memory/molecular/ is fresh on disk
#   2. Run `qmd update` + `qmd embed` to refresh BM25 + vector indexes
#   3. Start `qmd mcp --http` foreground (tini handles signals)
#
# Required env (failing closed when any of these is missing):
#   MEMORY_REPO        e.g. https://x-access-token:<gh-pat>@github.com/pinnacleadvisors/nexus.git
#   MEMORY_BRANCH      e.g. main
# Optional:
#   QMD_BIND           default 0.0.0.0
#   QMD_PORT           default 8181
#   COLLECTION_NAME    default molecular
#   COLLECTION_GLOB    default memory/molecular/**/*.md
#   QMD_REINDEX_ON_BOOT  set to "0" to skip qmd update on every restart

set -euo pipefail

REPO_DIR="${HOME}/repo"
QMD_BIND="${QMD_BIND:-0.0.0.0}"
QMD_PORT="${QMD_PORT:-8181}"
COLLECTION_NAME="${COLLECTION_NAME:-molecular}"
COLLECTION_GLOB="${COLLECTION_GLOB:-memory/molecular/**/*.md}"
QMD_REINDEX_ON_BOOT="${QMD_REINDEX_ON_BOOT:-1}"

if [[ -z "${MEMORY_REPO:-}" ]]; then
  echo "[qmd] MEMORY_REPO is required (full clone URL — include token if private)" >&2
  exit 1
fi
MEMORY_BRANCH="${MEMORY_BRANCH:-main}"

# 1. Sync repo
if [[ ! -d "${REPO_DIR}/.git" ]]; then
  echo "[qmd] cloning ${MEMORY_BRANCH} from MEMORY_REPO into ${REPO_DIR}"
  git clone --depth 1 --branch "${MEMORY_BRANCH}" "${MEMORY_REPO}" "${REPO_DIR}"
else
  echo "[qmd] pulling latest ${MEMORY_BRANCH} into ${REPO_DIR}"
  git -C "${REPO_DIR}" fetch --depth 1 origin "${MEMORY_BRANCH}"
  git -C "${REPO_DIR}" reset --hard "origin/${MEMORY_BRANCH}"
fi

if [[ ! -d "${REPO_DIR}/memory/molecular" ]]; then
  echo "[qmd] memory/molecular missing in cloned repo — aborting" >&2
  exit 1
fi

# 2. Register collection (idempotent — qmd silently re-uses an existing one)
cd "${REPO_DIR}"
qmd collection add "${REPO_DIR}/memory/molecular" --name "${COLLECTION_NAME}" --glob "${COLLECTION_GLOB}" 2>/dev/null || true

if [[ "${QMD_REINDEX_ON_BOOT}" == "1" ]]; then
  echo "[qmd] running qmd update + embed (first boot can take ~15 min as models download)"
  qmd update
  qmd embed
fi

# 3. Run MCP HTTP server foreground
echo "[qmd] starting MCP HTTP server on ${QMD_BIND}:${QMD_PORT}"
exec qmd mcp --http --bind "${QMD_BIND}" --port "${QMD_PORT}"
