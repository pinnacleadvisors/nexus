FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl jq tmux git gettext-base tini \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g --omit=dev openclaw@latest \
 && npm cache clean --force

WORKDIR /workspace
RUN useradd -ms /bin/bash claw && chown -R claw:claw /workspace
USER claw

COPY --chown=claw:claw workspace-template /opt/workspace-template
COPY --chown=claw:claw entrypoint.sh /usr/local/bin/entrypoint.sh

ENV WORKSPACE_DIR=/workspace \
    OPENCLAW_PORT=18789 \
    OPENCLAW_BIND=loopback

EXPOSE 18789
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:18789/health || exit 1

ENTRYPOINT ["/usr/bin/tini","--","/usr/local/bin/entrypoint.sh"]
