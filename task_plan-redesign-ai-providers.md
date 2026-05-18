Goal: Redesign the Settings → AI Providers tab to match the Accounts liquid-glass UI, add an Agentdex page for model-agnostic agent management, restyle Businesses, and delete `/tools` (workspace tools surface via sidebar).
Success criteria:
  - `/settings?tab=ai` renders provider cards with dual-mode (Subscription / API key) connection picker, mirroring `AccountList.tsx` aesthetic
  - `/settings/agents` (new) renders all 17 `.claude/agents/*.md` as Pokemon-style cards with skills + spec viewer + per-agent model picker
  - "Recommend model" button per-card and "Recommend all" at the top, powered by `/api/models/recommend` (LLM judge per click against a static `lib/models/catalog.ts`)
  - `/settings/businesses` restyled with liquid-glass aesthetic, same field set
  - `/tools` page deleted (`/tools/claw` + `/tools/agents` preserved); Toolbox link removed from sidebar
  - `npx tsc --noEmit` and `npm run check:retry-storm` pass
Hard constraints:
  - No backwards-compat shims for the old /tools page or AiTab — clean replace
  - Reuse `OAuthTile` / `ApiKeyCard` design language from `AccountList.tsx` — same liquid-glass palette
  - `/settings/accounts` URL stays (rename label only) — Composio Auth Config redirect URIs don't break
  - Recommender uses existing `callClaude()` from `lib/claw/llm.ts` — no new SDK imports
  - Write-size discipline: every file ≤ 300 lines per Write call

## Files
NEW
  lib/models/types.ts                            — ModelDefinition, ModelRecommendation
  lib/models/catalog.ts                          — Hand-curated benchmark catalog (Claude / GPT / Gemini / DeepSeek / image / video)
  lib/models/recommender.ts                      — LLM-judge wrapper around callClaude()
  lib/ai/providers.ts                            — AI provider registry (mirrors lib/oauth/providers.ts shape)
  components/settings/AiProviderCard.tsx         — Dual-mode card (Subscription | API key)
  components/settings/AiProviderList.tsx         — Grid + provider chain banner
  components/settings/AgentCard.tsx              — Pokemon-style agent card
  components/settings/AgentList.tsx              — Grid + "Recommend all"
  app/(protected)/settings/agents/page.tsx       — Agentdex page
  app/api/models/recommend/route.ts              — POST → LLM judge → { model, rationale }
  app/api/ai-providers/route.ts                  — POST /api-key paste + GET status (mirrors connected-accounts/api-key)

REFACTOR
  app/(protected)/settings/page.tsx              — AiTab uses AiProviderList; remove old config-status block
  app/(protected)/settings/businesses/page.tsx   — Liquid-glass restyle, same fields
  components/settings/SettingsTabs.tsx           — Add Agents tab; rename Accounts → Connectors label
  components/layout/Sidebar.tsx                  — Remove `/tools` Toolbox link
  lib/types.ts                                   — Add ModelDefinition / AiProviderConfig types if needed

DELETE
  app/(protected)/tools/page.tsx
  components/tools/ToolsGrid.tsx
  components/tools/ToolCard.tsx
  (TOOLS array in lib/mock-data.ts — only if unused elsewhere)

## Progress (as of 2026-05-18)
### Completed
- [x] Explore — mapped 6 surfaces (AI tab, Accounts, Businesses, Tools, Agents, Recommender)
- [x] Decide scope — full redesign, LLM-judge recommender, delete /tools
- [x] Task 1 — lib/models/types.ts
- [x] Task 2 — lib/models/catalog.ts (split skeleton + edit-fill)
- [x] Task 3 — lib/models/recommender.ts
- [x] Task 4 — lib/ai/providers.ts
- [x] Task 5 — app/api/models/recommend/route.ts
- [x] Task 6 — Extended /api/connected-accounts/api-key to recognise AI providers
- [x] Task 7 — components/settings/AiProviderCard.tsx + AiProviderCardSections.tsx + AiProviderCardBody.tsx
- [x] Task 8 — components/settings/AiProviderList.tsx
- [x] Task 9 — Refactor AiTab in settings/page.tsx
- [x] Task 10 — components/settings/AgentCard.tsx
- [x] Task 11 — components/settings/AgentList.tsx + AgentListHeader.tsx
- [x] Task 12 — app/(protected)/settings/agents/page.tsx
- [x] Task 13 — Updated SettingsTabs (added Agents, renamed Accounts → Connectors label)
- [x] Task 14 — Restyled settings/businesses/page.tsx (liquid-glass) + BusinessesCard.tsx
- [x] Task 15 — Deleted /tools page + ToolsGrid + ToolCard + TOOLS mock data
- [x] Task 16 — Removed /tools from Sidebar + Library icon
- [x] Task 17 — Typecheck passes, retry-storm + sentry-config pass, next build green

### Decisions made along the way
- Kept `/settings/accounts` URL stable (label only renamed to "Connectors") to avoid breaking Composio Auth Config redirect URIs (18 refs across 10 files).
- Extended existing `/api/connected-accounts/api-key` to dispatch on either OAuthProvider OR AiProvider rather than duplicating the encrypted-key flow.
- Split large components across multiple files (e.g. AiProviderCardSections + AiProviderCardBody) to satisfy the 300-line / 10 KB write-size cap.
- "Recommend models for all" uses 3-at-a-time concurrency to keep the LLM judge from saturating the gateway worker; partial success is tolerated.
- The LLM judge is bounded to picking from the static catalog (validates the model id, falls back to a static heuristic if hallucinated).
