# Multi-stage Dockerfile for the Nexus Next.js 16 platform in lean mode.
# Hosted on Coolify on a single Hostinger KVM alongside claude-gateway,
# codex-gateway, and nexus-sandbox (rootless Podman). See README.md.
#
# Build context: the repository root (paths relative to the repo root).
# Coolify-side: set "Build pack" to Dockerfile and "Dockerfile path" to
# services/lean-deploy/Dockerfile; set "Build context" to the repo root.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Copy lockfile first so dependency layer is cacheable.
COPY package.json package-lock.json* ./
# BuildKit cache mount for the npm download cache — same lockfile → instant
# rehydrate from the cache (~5s) instead of redownloading every package
# (~30s). Survives across builds inside the same BuildKit cache instance.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund


FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Doppler CLI also lives in the build stage. NEXT_PUBLIC_* vars are inlined
# into the client bundle at `next build` time; without Doppler-injected env,
# they bake in as undefined and CSP / Clerk / Supabase clients ship broken.
# DOPPLER_TOKEN comes in as a BuildKit secret so it never lands in image
# layers or `docker history`.
#
# apt cache mounts skip the ~15s download of ca-certificates + curl + gnupg
# on cached rebuilds. Debian's image installs a docker-clean hook that
# trashes the cache after install; rm it so the mount stays warm.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh | sh
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next.config.ts pulls Sentry config; the build needs Sentry env to avoid a
# warning, but the actual upload is gated by SENTRY_AUTH_TOKEN being present
# (we don't ship one in lean mode — Sentry stays opt-in).
#
# Build with Doppler-injected env when a token is available (BuildKit secret),
# otherwise fall back to a plain build — useful for local builds without
# Doppler. The fallback path still works because app/layout.tsx now reads env
# at request time (force-dynamic), so missing build-time env only degrades
# client-bundle NEXT_PUBLIC_* inlining, not server-side gating.
#
# .next/cache holds Next.js's incremental compilation cache. Mounting it
# from BuildKit cache cuts cold next-build by ~10-20s on unchanged routes.
RUN --mount=type=secret,id=doppler_token \
    --mount=type=cache,target=/app/.next/cache,sharing=locked \
    if [ -s /run/secrets/doppler_token ]; then \
      DOPPLER_TOKEN=$(cat /run/secrets/doppler_token) \
        doppler run --fallback=/tmp/doppler.cache.json -- npm run build; \
    else \
      echo "[build] no doppler_token secret — building without Doppler env" && \
      npm run build; \
    fi


FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# git is here for any in-app shell-out that reads the repo (memory-hq CLI,
# molecularmemory_local skill). ca-certificates is here for outbound HTTPS.
# curl + gnupg are NOT needed at runtime — Doppler binary is copied from
# the build stage below, no need to re-curl it.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
 && apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates

# Doppler CLI — already installed in the build stage above. Copy the
# binary instead of re-installing it (saves ~10s — the curl-and-shell
# install path hits a CDN and runs an interactive prompt fallback).
# /usr/local/bin/doppler is where the install script lands the binary.
COPY --from=build /usr/local/bin/doppler /usr/local/bin/doppler

COPY --from=build /app /app
EXPOSE 3000
CMD ["doppler", "run", "--fallback=/tmp/doppler.cache.json", "--", "npm", "run", "start"]
