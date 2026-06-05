# Architectural Decision Records

| # | Title | Status | Date |
|---|-------|--------|------|
| [001](001-composio-doppler-broker.md) | Composio→Doppler secrets broker for Claude Code web | Accepted | 2026-04-25 |
| [002](002-codex-gateway-sandbox.md) | Codex CLI gateway as sandboxed manual-ops runtime | Accepted | 2026-05-02 |
| [003](003-protected-route-matcher.md) | Widened middleware matcher for `(protected)/` route group | Accepted | 2026-05-03 |
| [004](004-skip-gsd.md) | Skip GSD (Get-Shit-Done) skill — overlaps with claude-evolve + memory-hq | Accepted | 2026-05-06 |
| [005](005-claude-code-aesthetic-redesign.md) | Claude-Code-aesthetic redesign + liquid glass design system | Proposed | 2026-05-15 |
| [006](006-lean-mode-pivot.md) | Lean-mode pivot via feature flag — single-KVM Coolify, dormant multi-tenant code | Accepted | 2026-05-19 |
| [007](007-paperclip-absorption.md) | Selective absorption of Paperclip patterns — schema, UI, adapter architecture; no runtime migration | Accepted | 2026-05-22 |
| [008](008-platform-copilot-autonomous-ui-verify.md) | Platform-copilot autonomous UI verification (screenshot pair via codex-delegate) before PR + lift PR-open approval gate | Accepted | 2026-05-23 |
| [009](009-gbrain-evaluation.md) | GBrain self-wiring graph-memory evaluation — opt-in `memory:gbrain` adapter behind a benchmark gate; memory-hq stays canonical | Accepted | 2026-05-28 |
| [010](010-graphify-obsidian-dual-store.md) | Decline Graphify+Obsidian dual-store — memory-hq + Supabase `mol_*` mirror already is it (one-way-consistent, safer than dual-write) | Accepted | 2026-05-30 |
| [011](011-mac-mini-local-os.md) | Mac-mini local OS as primary host (off Hostinger) — OrbStack + compose, Supabase stays cloud, KVM4 fallback until 2026-06-28 | Accepted | 2026-06-04 |
| [012](012-lean-nexus-integration-cockpit.md) | Lean Nexus — integration cockpit over best-of-breed OSS (Paperclip/Hermes/opencode); build only the gap; MCP substrate (memory-hq+Composio) as shared agent backbone | Accepted | 2026-06-04 |
| [013](013-chat-engine-replacement.md) | Chat engine replacement — embed OSS chat (claudecodeui), decouple + keep the governance views (typed-block rail is already DB-backed); re-home parsing via a Stop-hook | Accepted | 2026-06-04 |
| [014](014-two-plane-adapter-model.md) | Two-plane adapter model — runtime `lib/adapters` (run/poll/cancel an agent) vs capability `lib/ecosystems` (verb+payload); keep separate, bridge deferred | Accepted | 2026-06-05 |
| — | Solopreneur autonomous experiment with strategic-irreversibles-only gating ([runbook](../runbooks/solopreneur-experiment.md)) | Accepted | 2026-05-09 |
| — | Cloudflare DNS over Namecheap API for per-business DNS automation (no IP-allowlist friction) — see [`docs/runbooks/namecheap-to-cloudflare-dns.md`](../runbooks/namecheap-to-cloudflare-dns.md) | Accepted | 2026-05-09 |
