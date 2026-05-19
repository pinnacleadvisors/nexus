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
#
# Phase 7 of task_plan-chat.md — add Playwright system dependencies so the
# codex agent can drive a headless Chromium when platform-copilot delegates
# a browser smoke test via `delegate_to_codex`. The full list comes from
# `npx playwright install-deps` (Debian bookworm) — bundled here directly
# so the layer caches independently of the playwright npm install.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git ca-certificates bash curl gnupg \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 \
      fonts-liberation fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

# Doppler CLI — secrets pulled at container startup via `doppler run --` in
# the ENTRYPOINT. Single source of truth = Doppler; only DOPPLER_TOKEN needs
# to be set on the Coolify side. See docs/runbooks/doppler-coolify-sync.md.
RUN curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh | sh

# Install the codex CLI globally. Pinned to latest; bump manually after
# smoke-testing a new release. The package is published by OpenAI and
# authenticates against the user's ChatGPT Plus/Pro account via OAuth.
RUN npm install --location=global @openai/codex@latest

# Install Playwright + Chromium globally so the codex agent's shell tool can
# spin up a browser to smoke-test a deployed preview URL when platform-copilot
# delegates the work. Chromium only (no Firefox / WebKit) to keep the image
# small — Nexus + per-business storefronts only need Chromium coverage.
#
# The shared browser cache lives at /usr/local/playwright-browsers so every
# codex run reuses the same install (no per-job download cost).
#
# See docs/runbooks/codex-playwright-smoke-tests.md for the template prompts
# the platform-copilot uses when delegating a smoke run.
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/local/playwright-browsers
RUN npm install --location=global playwright@1.49.1 \
 && npx playwright install chromium \
 && rm -rf /var/cache/apt /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=build /app/dist ./dist
COPY entrypoint.sh ./entrypoint.sh
COPY scripts ./scripts
RUN chmod +x ./entrypoint.sh \
 && chmod +x ./scripts/nexus-smoke.mjs \
 && ln -sf /app/scripts/nexus-smoke.mjs /usr/local/bin/nexus-smoke

# /root/.codex holds the OAuth credentials from `codex login`. Mount this
# from a Coolify persistent volume so the token survives container restarts.
# /repo holds the cloned Nexus repo (agents + skills) — refreshed on boot.
VOLUME ["/root/.codex"]
ENV NEXUS_REPO_PATH=/repo
ENV CODEX_GATEWAY_PORT=3000
EXPOSE 3000

# Wrap the entrypoint with `doppler run` so secrets land in process.env at
# boot. --fallback caches secrets locally for resilience against Doppler API
# outages on subsequent restarts.
ENTRYPOINT ["doppler", "run", "--fallback=/tmp/doppler.cache.json", "--", "./entrypoint.sh"]
