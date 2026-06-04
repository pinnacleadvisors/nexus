#!/bin/sh
# Regenerate the crontab from vercel.json, then hand off to supercronic.
# Runs under `doppler run --` so CRON_SECRET (and CRON_TARGET if set) are in env.
set -eu

echo "[cron-runner] generating crontab from ${CRONS_JSON:-/app/cron/crons.json} -> target ${CRON_TARGET:-http://nexus-app:3000}"
node /app/cron/gen-crontab.mjs > /tmp/crontab
echo "[cron-runner] $(grep -cE '^[^#[:space:]]' /tmp/crontab) jobs scheduled"

# -passthrough-logs surfaces each job's stdout in `docker logs cron-runner`.
exec supercronic -passthrough-logs /tmp/crontab
