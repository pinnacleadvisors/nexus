---
title: sync-memory uses GitHub webhook HMAC
created: 2026-05-02
links:
  - mocs/learning-system
---

# sync-memory uses GitHub webhook HMAC

`POST /api/cron/sync-memory` is gated by `GITHUB_WEBHOOK_SECRET` HMAC-sha256 verification of `x-hub-signature-256`. The `pinnacleadvisors/memory-hq` repo posts to it on push; the route diffs commits and upserts/deletes mirror tables (`mol_atoms`, `mol_entities`, `mol_mocs`, `mol_sources`, `mol_synthesis`). `GET ?reconcile=1` is owner-only (Clerk) or cron (`CRON_SECRET`) and walks the full tree — used for drift recovery. Already auth-gated; no S5 exposure.

Source: `app/api/cron/sync-memory/route.ts:46-52, 130-165`.
