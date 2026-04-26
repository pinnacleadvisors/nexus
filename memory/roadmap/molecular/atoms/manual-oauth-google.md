---
type: atom
title: "Manual — OAuth app: Google"
id: manual-oauth-google
created: 2026-04-26
sources:
  - ROADMAP.md#L81
links:
  - "[[manual-steps]]"
---

# Manual — OAuth app: Google

⬜ Not done. https://console.cloud.google.com → APIs & Services → Credentials → Create OAuth 2.0 Client ID. Redirect URI: `https://<your-vercel-domain>/api/oauth/google/callback`. Scopes: `drive.file`, `docs`, `spreadsheets`. Add `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` to Doppler.

## Related
- [[manual-steps]]
