---
type: atom
title: "Manual — Row-Level Security via Clerk JWT template"
id: manual-rls-clerk-jwt
created: 2026-04-26
sources:
  - ROADMAP.md#L164
links:
  - "[[manual-steps]]"
  - "[[phase-9-security-hardening]]"
status: active
lastAccessed: 2026-04-26
accessCount: 0
---

# Manual — Row-Level Security via Clerk JWT template

✅ JWT template configured; ⬜ migration 004 pending. Clerk Dashboard → JWT Templates → New template → choose "Supabase". Set audience to your Supabase project URL; ensure `sub` claim maps to `{{user.id}}`. Copy Supabase JWT Secret (Settings → API) into Clerk template "Signing key". Then `npm run migrate` for migration 004 (RLS + policies).

## Related
- [[manual-steps]]
- [[phase-9-security-hardening]]
