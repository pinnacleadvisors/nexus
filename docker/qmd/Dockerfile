# QMD sidecar — local hybrid (BM25 + vector + LLM rerank) search over Nexus
# molecular memory. See docker/qmd/README.md for deploy steps.
#
# Pipeline:
#   1. Clone (or pull) the Nexus repo at startup so memory/molecular is fresh
#   2. Register memory/molecular as a QMD collection
#   3. qmd update + qmd embed (downloads ~2 GB of GGUF models on first boot)
#   4. qmd mcp --http --port 8181 — MCP-over-HTTP for lib/molecular/qmd-client.ts
#
# Hardware: 4 GB RAM minimum (model load + SQLite + Node). 8 GB recommended.

FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# build-essential + python3 are needed by node-llama-cpp's prebuild fallback.
# git lets the entrypoint clone the memory repo at runtime.
# tini is PID 1 so SIGTERM propagates cleanly to qmd.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      git \
      jq \
      libsqlite3-dev \
      python3 \
      sqlite3 \
      tini \
  && rm -rf /var/lib/apt/lists/*

# Non-root user — QMD writes ~/.cache/qmd, so we map that into /data via $HOME.
RUN useradd --create-home --shell /bin/bash qmd
ENV HOME=/data
RUN mkdir -p /data /data/repo /data/cache && chown -R qmd:qmd /data

USER qmd
WORKDIR /home/qmd

# Install QMD globally to the user's prefix so we don't need root at install time.
ENV NPM_CONFIG_PREFIX=/home/qmd/.npm-global
ENV PATH=/home/qmd/.npm-global/bin:$PATH
RUN npm install -g @tobilu/qmd

COPY --chown=qmd:qmd entrypoint.sh /home/qmd/entrypoint.sh
RUN chmod +x /home/qmd/entrypoint.sh

EXPOSE 8181

# Mount /data as a volume so model downloads survive redeploys.
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=300s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8181/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/home/qmd/entrypoint.sh"]
