---
type: atom
title: "Composio connected accounts replace per-platform OAuth"
id: composio-connected-accounts-replace-per-platform-oauth
created: 2026-05-06
sources:
  - lib/composio/actions.ts
status: active
lastAccessed: 2026-05-06
accessCount: 0
---

# Composio connected accounts replace per-platform OAuth

OAuth-authenticated platform integrations (Twitter/X, LinkedIn, Gmail, Slack, Notion, Stripe, Shopify, Canva, GA, etc.) are brokered through Composio. Tokens never touch our database — Composio holds them, we store only the connected_account_id in the connected_accounts table (migration 033). lib/composio/actions.executeBusinessAction() looks up the right connected_account_id by (user, business, platform) and calls Composio. Adding a new platform = one row in lib/oauth/providers.ts, no new code.
