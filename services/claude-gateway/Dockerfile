# Self-hosted Claude Code gateway for Nexus.
# Builds in two stages so the runtime image carries only what we need to spawn
# the claude CLI and serve HTTP on port 3000.

FROM node:22-bookworm-slim AS build
WORKDIR /app

# node-pty (the @homebridge prebuilt fork) ships NAPI prebuilds for linux
# x64/arm64, but prebuild-install falls back to compiling if the prebuilt
# binary can't be fetched. python3 + make + g++ guarantee that fallback works
# so the image build never breaks on a transient prebuild-host hiccup. These
# tools live only in the (discarded) build stage — zero runtime image bloat.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build


FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# git is required so the entrypoint can clone the Nexus repo on boot — that
# clone supplies .claude/agents/<slug>.md specs to the spawned claude CLI.
# bash + ca-certificates + curl round out the runtime essentials. curl + gnupg
# are also needed to bootstrap the Doppler CLI (next layer).
#
# jq + python3-minimal added by Phase 3 of task_plan-mobile-copilot.md so the
# repo's .claude/hooks/* scripts can run: check-write-size.sh uses jq to
# inspect tool input; skill-router.sh uses python3 to JSON-parse the prompt.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates bash curl gnupg jq python3-minimal \
 && rm -rf /var/lib/apt/lists/*

# Doppler CLI — secrets pulled at container startup, so the only env var that
# needs to live in Coolify is DOPPLER_TOKEN. Everything else (CLAUDE_GATEWAY_BEARER,
# COMPOSIO_API_KEY, MEMORY_HQ_TOKEN, etc.) flows from Doppler at boot via
# `doppler run --` (see ENTRYPOINT below). See docs/runbooks/doppler-coolify-sync.md.
RUN curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh | sh

# Install the claude CLI globally. Pinned to a known-good major; bump
# manually after smoke-testing a new release.
RUN npm install --location=global @anthropic-ai/claude-code@latest

# Composio MCP access for the platform-copilot agent.
#
# PR #152 shipped @composio/rube-mcp (universal, soft-isolation — relies on
# the agent self-disciplining to admin-scope connections). This image now
# uses @nexus/mcp-composio-admin instead — a hard-isolation wrapper built
# from services/mcp-composio-admin/ that filters at the MCP layer: only
# admin-scope (business_slug='_admin') connected_accounts rows are reachable.
# rube-mcp is kept installed as a fallback in case the wrapper has issues —
# the entrypoint registers ONE of them in ~/.claude/settings.json.
#
# Per-business agents run on per-business containers (Dockerfile.business)
# with their own MCP setups, so there's no cross-scope pollution.
RUN npm install --location=global @composio/rube-mcp@latest

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

# Wrap the entrypoint with `doppler run` so all secrets are fetched fresh from
# Doppler at boot. --fallback writes a local cache after each successful pull;
# if Doppler is down on a later restart, the cache is reused so the container
# still starts (with whatever was current at the last pull).
ENTRYPOINT ["doppler", "run", "--fallback=/tmp/doppler.cache.json", "--", "./entrypoint.sh"]
