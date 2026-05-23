# Autonomous QA runner — Playwright + a thin Node orchestrator.
#
# Runs on the same Coolify host as the claude-gateway service so the smoke
# specs can dispatch fix-attempts over the private `coolify` network without
# exposing the gateway publicly. Headless-only: no GUI dependencies, no xvfb.
#
# We use the official Playwright image (`mcr.microsoft.com/playwright`) which
# bundles Chromium/Firefox/WebKit + system fonts + libnss/libgbm and pins to a
# tested matching browser+driver pair. Bumping the tag here is the single
# coordinate point — leave the playwright npm package version equal to it.

FROM mcr.microsoft.com/playwright:v1.49.0-noble AS build
WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
COPY e2e ./e2e
COPY playwright.config.ts ./
RUN npm run build


FROM mcr.microsoft.com/playwright:v1.49.0-noble AS runtime
WORKDIR /app

# Doppler CLI — secrets pulled at container startup, so the only env var
# Coolify (or any orchestrator) needs to set is DOPPLER_TOKEN. Every other
# secret (QA_RUNNER_HMAC_SECRET, BOT_*, NEXUS_BASE_URL, CLAUDE_GATEWAY_*)
# flows from Doppler at boot via `doppler run --` (see ENTRYPOINT below).
# Same pattern as services/claude-gateway/Dockerfile. See AGENTS.md
# §"Docker images — Doppler as the source of truth".
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl gnupg ca-certificates \
 && curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh | sh \
 && rm -rf /var/lib/apt/lists/*

# Install only production deps. Playwright's browsers are already in the
# base image — `npx playwright install` is unnecessary and would re-download.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=build /app/dist ./dist
COPY --from=build /app/e2e ./e2e
COPY playwright.config.ts ./

# `qa-runner` is invoked by webhook from /api/cron/post-deploy-smoke — it
# binds 3001 so it doesn't clash with claude-gateway:3000 on the same host.
ENV QA_RUNNER_PORT=3001
ENV NODE_ENV=production
EXPOSE 3001

# Single-worker Playwright by default to bound RAM on small VPS tiers.
ENV PLAYWRIGHT_WORKERS=1

# Wrap the runtime command with `doppler run` so all secrets are fetched
# fresh from Doppler at boot. --fallback writes a local cache after each
# successful pull; if Doppler is down on a restart, the cache is reused so
# the container still starts (with whatever was current at the last pull).
ENTRYPOINT ["doppler", "run", "--fallback=/tmp/doppler.cache.json", "--"]
CMD ["node", "dist/index.js"]
