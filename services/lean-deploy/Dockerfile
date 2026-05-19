# Multi-stage Dockerfile for the Nexus Next.js 16 platform in lean mode.
# Hosted on Coolify on a single Hostinger KVM alongside claude-gateway,
# codex-gateway, and nexus-sandbox (rootless Podman). See README.md.
#
# Build context: the repository root (paths relative to the repo root).
# Coolify-side: set "Build pack" to Dockerfile and "Dockerfile path" to
# services/lean-deploy/Dockerfile; set "Build context" to the repo root.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Copy lockfile first so dependency layer is cacheable
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund


FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next.config.ts pulls Sentry config; the build needs Sentry env to avoid a
# warning, but the actual upload is gated by SENTRY_AUTH_TOKEN being present
# (we don't ship one in lean mode — Sentry stays opt-in).
RUN npm run build


FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# git is here for any in-app shell-out that reads the repo (memory-hq CLI,
# molecularmemory_local skill) — small footprint, big convenience.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
EXPOSE 3000
CMD ["npm", "run", "start"]
