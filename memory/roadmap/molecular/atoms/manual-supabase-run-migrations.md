---
type: atom
title: "Manual — Run Supabase migrations from MacBook"
id: manual-supabase-run-migrations
created: 2026-04-26
sources:
  - ROADMAP.md#L32
links:
  - "[[manual-steps]]"
---

# Manual — Run Supabase migrations from MacBook

⬜ Not done. Run `cd nexus && npm run migrate` on your MacBook. Uses Doppler to inject credentials and applies pending `.sql` files via the Supabase Management API. Safe to re-run — already-applied files are skipped. Cannot be run from the cloud dev environment because it requires `SUPABASE_PROJECT_REF` + `SUPABASE_ACCESS_TOKEN` only available via Doppler locally. Alternative: paste each file into Supabase dashboard SQL Editor in order.

## Related
- [[manual-steps]]
