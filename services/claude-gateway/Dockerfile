# Self-hosted Claude Code gateway for Nexus.
# Builds in two stages so the runtime image carries only what we need to spawn
# the claude CLI and serve HTTP on port 3000.

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build


FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# git is required so the entrypoint can clone the Nexus repo on boot — that
# clone supplies .claude/agents/<slug>.md specs to the spawned claude CLI.
# bash + ca-certificates round out the runtime essentials.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates bash \
 && rm -rf /var/lib/apt/lists/*

# Install the claude CLI globally. Pinned to a known-good major; bump
# manually after smoke-testing a new release.
RUN npm install --location=global @anthropic-ai/claude-code@latest

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=build /app/dist ./dist
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# /root/.claude holds the OAuth credentials from `claude login`. Mount this
# from a Coolify persistent volume so the token survives container restarts.
# /repo holds the cloned Nexus repo (agents + skills) — refreshed on boot.
VOLUME ["/root/.claude"]
ENV NEXUS_REPO_PATH=/repo
ENV CLAUDE_GATEWAY_PORT=3000
EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
