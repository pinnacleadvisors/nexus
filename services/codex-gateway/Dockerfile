# Self-hosted Codex CLI gateway for Nexus.
# Mirrors services/claude-gateway/ shape so dispatchToCodexGateway can reuse the
# same HMAC-signed protocol. Spawns the codex CLI to drain the user's ChatGPT
# Pro plan instead of paying per-token API costs.

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
# clone supplies .claude/agents/<slug>.md specs that get prepended to prompts
# as system instructions. bash + ca-certificates round out the runtime essentials.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates bash \
 && rm -rf /var/lib/apt/lists/*

# Install the codex CLI globally. Pinned to latest; bump manually after
# smoke-testing a new release. The package is published by OpenAI and
# authenticates against the user's ChatGPT Plus/Pro account via OAuth.
RUN npm install --location=global @openai/codex@latest

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=build /app/dist ./dist
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# /root/.codex holds the OAuth credentials from `codex login`. Mount this
# from a Coolify persistent volume so the token survives container restarts.
# /repo holds the cloned Nexus repo (agents + skills) — refreshed on boot.
VOLUME ["/root/.codex"]
ENV NEXUS_REPO_PATH=/repo
ENV CODEX_GATEWAY_PORT=3000
EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
