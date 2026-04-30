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

CMD ["node", "dist/index.js"]
