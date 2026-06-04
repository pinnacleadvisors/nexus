# cron-runner — supercronic firing the platform's /api/cron/* routes on the
# Mac, replacing cron-job.org. Single DOPPLER_TOKEN provides CRON_SECRET at
# boot (same pattern as the other services). arm64 (Apple Silicon / OrbStack).
FROM node:24-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates gnupg tzdata \
 && curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh | sh \
 && rm -rf /var/lib/apt/lists/*

# supercronic — container-native cron (logs to stdout, no root crond needed).
ARG SUPERCRONIC_VERSION=v0.2.33
RUN curl -fsSLo /usr/local/bin/supercronic \
      "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-arm64" \
 && chmod +x /usr/local/bin/supercronic

ENV TZ=UTC
WORKDIR /app
# Baked fallbacks; compose mounts the live host copies over these for edit-without-rebuild.
COPY gen-crontab.mjs /app/cron/gen-crontab.mjs
COPY crons.json      /app/cron/crons.json
COPY entrypoint.sh   /app/cron/entrypoint.sh
RUN chmod +x /app/cron/entrypoint.sh

ENTRYPOINT ["doppler", "run", "--fallback=/tmp/doppler.cache.json", "--"]
CMD ["/app/cron/entrypoint.sh"]
