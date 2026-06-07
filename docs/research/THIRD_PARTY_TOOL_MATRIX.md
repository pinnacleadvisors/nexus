# Third-Party Tool Matrix

**Single source of truth for "which tool do I pick for this task".** One comparison
table per category of third-party tool, organised by the platform's own capability
taxonomy (`EcosystemKind` in [`lib/ecosystems/types.ts`](../../lib/ecosystems/types.ts) +
the agent-runtime / LLM-provider layers above it).

> **Audience:** the orchestrator agent (and any department lead / loop) deciding which
> harness, model, memory store, or ecosystem adapter to route a task to. This doc answers
> *"what are my options and which is best for X"*. Its companion
> [`OPEN_SOURCE_ABSORPTIONS.md`](OPEN_SOURCE_ABSORPTIONS.md) answers the different question
> *"what patterns have we taken from where, and where do they live in code"*. Keep the two
> separate: this is the **selection matrix**, that is the **absorption ledger**.

> **Generated:** 2026-06-04 from a repo-wide analysis (11-agent workflow). Every claim is
> grounded in a cited file path. When the code moves, update the cell — don't let it rot.
> See [How to keep this doc current](#how-to-keep-this-doc-current).

---

## How to read these tables

- **First column is always the tool.** Status emojis follow the operator's house style:
  | Emoji | Meaning |
  |---|---|
  | 🚀 | Standout / the canonical default for this category |
  | ✅ | Yes / wired & working today |
  | 🟡 | Stub — code exists but `available()` is false until env is set, or throws-on-construct |
  | ⚠️ | Caveat / partial / deprecated-but-present |
  | 🔬 | Candidate — evaluated, not yet wired |
  | 🚫 | No / not integrated |
  | ➖ | Not applicable for this tool's role |
- **"Wired"** means callable *today* through the platform's own routing (the ecosystem
  registry, the gateway dispatch, or the provider switch) — **not** just "a secret slot exists".
  An env-var name in `SECRETS.md` with no adapter file is 🟡/🚫, not ✅.
- **Canonical defaults** for the 15 ecosystem kinds are NOT decided ad-hoc — they live in one
  place: [`lib/teams/default-bindings.ts`](../../lib/teams/default-bindings.ts) `DEFAULT_BINDINGS`.
  An operator can rebind any team via `/teams`; the table seeds the initial value only.

---

## 0. Quick pick — orchestrator routing cheat-sheet

The 30-second "what do I reach for" map. Detail + caveats in the per-category sections below.

| Task type | Reach for | Why |
|---|---|---|
| Design-heavy build: architecture, multi-file codegen, refactor, customer chat | **Claude Code gateway** (`§1`) | Plan-billed (free at the margin), skills + sub-agents + Agent-Teams |
| Execution-heavy: debugging, container/deploy/sysadmin, current-UI research | **Codex gateway** (`§1`) | Sandboxed, PR-only trust ladder; routed via `shouldRouteToCodex` |
| High-volume, low-stakes background (failure scans, nightly digest, lead-scoring) | **`LLM_PROVIDER=nim`** (`§2`) | NVIDIA NIM free tier — zero marginal cost, already wired, under-used |
| Need a non-Claude frontier model per-task | **`LLM_PROVIDER=openrouter`** (`§2`) | Live, one key, ~200 models |
| Remember / recall a durable cross-project fact | **memory-hq** via `memory_atom` / `memory_search` (`§3`) | The canonical L2c graph; queryable from any session |
| Read stack rules / architecture before a task | **`memory/` 3-layer files** (`§3`) | Start at `memory/INDEX.md` |
| Open-web topic search from dispatch code | **Tavily** (or SearXNG if self-hosting) (`§7`) | Default `search` adapter; SearXNG is a normalised drop-in |
| Scrape one public static page, in-session | **`firecrawl_local` skill** (`§7`) | Free, token-less; escalate to hosted Firecrawl for JS/anti-bot |
| Run an authenticated action on a connected SaaS (tweet, Gmail, Stripe, GitHub PR) | **Composio** `executeBusinessAction()` (`§8`) | Single OAuth source of truth; we store only `composio_account_id` |
| Author/repair a multi-step visual business workflow | **n8n** (strategist → debugger) (`§8`) | Runtime executes externally, auto-retries 3× |
| Async/fan-out/batch agent loops with durable retries | **Inngest** functions (`§8`) | `inngest/functions/*` |
| Outbound phone / real-time voice agent | **Pipecat** (`§6`) | Only fully-wired OSS voice-agent; safe pick over the unbuilt `vapi` default |
| Workforce coordination: org chart, roles, budgets, governance | **Paperclip** (`§1`) delegating to Nexus agents/loops | See [Synergy A](#a-paperclip--nexus-delegation) |

---

## 1. Agent harnesses / runtimes

The orchestration + worker-runtime layer. (This is the category the operator's example
table was for — OpenHuman is **not integrated yet**.)

| Tool | Wired into Nexus (where) | OSS / license | Cost model | Simple start | memory-hq substrate | Composio | Model routing | Native tools | Best-for |
|---|---|---|---|---|---|---|---|---|---|
| **Claude Code** (self-hosted gateway) 🚀 | ✅ canonical primary — [`services/claude-gateway/`](../../services/claude-gateway/), dispatched from [`app/api/claude-session/dispatch/route.ts`](../../app/api/claude-session/dispatch/route.ts) (`CLAUDE_CODE_GATEWAY_URL`) | ⚠️ Anthropic CLI wrapped by a Nexus HMAC gateway | 🚀 plan-billed (20× Max, not per-token) | ✅ Doppler-token compose + `claude login` | ✅ via mcp-memory | ✅ + per-business MCP set | ⚠️ Claude-only; Codex is the sibling gateway | 🚀 skills / sub-agents / Agent-Teams | Design + agentic build; **default runtime** |
| **Codex** (codex-gateway) ✅ | ✅ wired — [`services/codex-gateway/`](../../services/codex-gateway/), `lib/claw/codex-gateway.ts` (`shouldRouteToCodex`), `CODEX_GATEWAY_URL` | ⚠️ OpenAI CLI wrapped (same HMAC protocol) | 🚀 plan-billed (ChatGPT Pro); ⚠️ token rotates ~30d | ⚠️ headless auth finicky (3 modes) | ✅ via substrate | ✅ | ⚠️ GPT-only; peer-routed | ✅ native exec / sandbox (ADR 002) | Debugging / manual-ops / research |
| **OpenClaw** ⚠️ | ⚠️ deprecated fallback — [`docker/openclaw/`](../../docker/openclaw/), env-only `OPENCLAW_GATEWAY_URL` (`business-client.ts` resolve step 5) | ✅ OSS (20+ channels; corrected 2026-06-04) | ⚠️ raw shared `ANTHROPIC_API_KEY` (per-token) | ⚠️ per-business container + identity files | 🚫 predates substrate | 🚫 raw key, not brokered | 🚫 Claude-only | ⚠️ gateway + tmux workspace | Legacy per-business fallback; **superseded** by claude-gateway |
| **opencode** (sst/opencode) 🔬 | 🔬 candidate — [`lib/ecosystems/adapters/open-code.ts`](../../lib/ecosystems/adapters/open-code.ts) (gateway fallback); **RUN** in ADR 012; no standalone deploy | ✅ OSS (sst/opencode) | ✅ rides 75+ provider keys | ✅ `opencode serve`, embeddable API | 🔬 planned | 🔬 planned | 🚀 **75+ providers** (standout) | ✅ full coding loop | Model-agnostic chat engine + dev |
| **claudecodeui** (siteboon) 🟡 | 🟡 embedded UI — `app/(protected)/code/page.tsx` + `components/code/CodeEmbed.tsx` (`CODE_EMBED_URL`, ADR 013 Ph1) | ✅ OSS (siteboon) | ✅ free UI; cost = the runtime it drives | ⚠️ own tunnel + auth; Nexus iframes it | ➖ shell | ➖ inherits | ⚠️ inherits | ➖ chat UI, not a loop | Embeddable mobile + web chat surface |
| **Hermes Agent** (nousresearch/hermes-agent) 🔬 | 🔬 candidate — `task_plan-workforce-lab.md` (separate repo); `hermes_local` adapter Ph4 pending; **patterns-only in-tree** | ✅ OSS (v0.8.0; corrected 2026-06-04) | ✅ rides the model it points at | ✅ Discord-native, self-improving skills | 🔬 planned (memory-os native) | 🔬 planned | 🚀 model-agnostic | 🚀 self-improving skills loop | Worker runtime under Paperclip (lab) |
| **Paperclip** (paperclipai/paperclip) 🟡 | 🟡 orchestrator — `app/(protected)/workforce/page.tsx` + `app/api/workforce/[...path]/route.ts` proxy (`PAPERCLIP_API_BASE`); abstraction at `lib/adapters/registry.ts` | ✅ MIT (~67K⭐) | ✅ free OSS | ⚠️ `npx paperclipai onboard`, :3100, Clerk-proxied | ➖ governance, not memory | ➖ delegates | ➖ agent-agnostic | ➖ orchestration, not a loop | Workforce orchestration (roles / budgets / governance) |
| **OpenHuman** 🚫 | 🚫 **NOT integrated** — zero repo references, no decision recorded | n/a | n/a | n/a | 🚫 | 🚫 | 🚫 | 🚫 | — (not yet evaluated) |

**Canonical default:** the self-hosted **Claude Code gateway** ([`services/claude-gateway/`](../../services/claude-gateway/)),
dispatched via [`app/api/claude-session/dispatch/route.ts`](../../app/api/claude-session/dispatch/route.ts)
(`dispatchToOpenClaw` is a legacy function name that now speaks the gateway protocol). Chosen
because it is plan-billed on the 20× Max plan, supports skills/sub-agents/Agent-Teams, and merges
repo-wide + per-agent hooks (`agent_library.hooks`) at spawn. **codex-gateway** is the canonical
peer for execution-heavy work; `shouldRouteToCodex` decides Claude-vs-Codex. Both are first-class in
`lib/adapters/registry.ts` (alongside `coolify-business` / `n8n` / `inngest`).

**Gaps / picks for the orchestrator:**
- Design/build → **claude-gateway**; debug/ops/research → **codex-gateway**; model-agnostic/cost-sensitive → **opencode** (once deployed); operator chat surface → **claudecodeui**; workforce coordination → **Paperclip** with **Hermes** as worker.
- `hermes_local` and `open-code` are **not yet in `lib/adapters/registry.ts`** (only claude/codex/coolify/n8n/inngest) — an orchestrator cannot route to them today.
- No in-runtime model routing yet — Claude-vs-Codex is two single-identity gateways picked by `shouldRouteToCodex`, not a provider abstraction. **opencode is the intended fix** but is unwired.
- **OpenClaw is dead weight** (raw key, no substrate) — slated for removal after the per-business pilot.
- **OpenHuman** has no evaluation row in `OPEN_SOURCE_ABSORPTIONS.md` — add one before considering it.

---

## 2. LLM providers (text generation)

| Provider | Wired | Where | Billing model | Model routing | OSS / license | Best-for |
|---|---|---|---|---|---|---|
| **Claude** (self-hosted Code gateway) 🚀 | ✅ | [`services/claude-gateway/`](../../services/claude-gateway/) · resolved in `lib/claw/business-client.ts`; default model `claude-sonnet-4-6` in [`lib/llm/provider.ts`](../../lib/llm/provider.ts) | **Plan-billed** — drains the 20× Max sub (pty mode); `claude -p` print mode is API-metered post-2026-06-15 (`CLAUDE_DEFAULT_EXEC_MODE`) | PRIMARY tier; **bypasses `LLM_PROVIDER`** (calls Claude directly over HTTP). Per-business containers `nexus-business-<slug>` | Proprietary (Anthropic) | **Canonical default.** Design-heavy: architecture, codegen, refactor, customer chat |
| **OpenClaw** (legacy gateway) ⚠️ | ✅ | `OPENCLAW_GATEWAY_URL` · cookie config via `/api/claw/config` | Plan-billed (Claude Pro sub) | 2nd tier of the default chain | Proprietary | Legacy single-tenant fallback; not required for new deploys |
| **Anthropic API** (direct) ⚠️ | ✅ | `ANTHROPIC_API_KEY` · `anthropic(model)` in `lib/llm/provider.ts` (`case 'claude'`) | **API-billed** (per-token) | Final fallback tier (`LLM_PROVIDER=claude`, the default); model the `claude-llm` ecosystem adapter wraps | Proprietary | Last-resort when both gateways are down; `CLAUDE_MAX_ONLY=1` disables in prod |
| **OpenRouter** ✅ | ✅ | [`lib/llm/providers/openrouter.ts`](../../lib/llm/providers/openrouter.ts) | API-billed (per-model) | `LLM_PROVIDER=openrouter`; default `anthropic/claude-sonnet-4-6`, override `OPENROUTER_DEFAULT_MODEL` | Proprietary router over OSS+proprietary models | Per-task model choice / ~200 models when Max+Pro subs exhausted |
| **NVIDIA NIM** ✅ | ✅ | [`lib/llm/providers/nim.ts`](../../lib/llm/providers/nim.ts) (live — absorptions doc still marks it 🔬, **stale**) | 🚀 **Free tier** → zero marginal cost | `LLM_PROVIDER=nim`; default `meta/llama-3.3-70b-instruct` | Hosted OSS models (Llama, Mixtral, Gemma, DeepSeek, Nemotron) | 🚀 High-volume low-stakes background: failure-scan, nightly digest, trend-scout, lead-scoring. NOT customer-facing (latency) |
| **Mimo** (Mimo Pro 2.5) ✅ | ✅ env-gated | `lib/llm/providers/mimo.ts` — `getMimoModel()` builds via `createOpenAI({baseURL})` when `MIMO_API_KEY` set | API-billed (cheaper than Claude) | `LLM_PROVIDER=mimo`; default `mimo-pro-2.5` | OpenAI-compatible | Intended Claude-Max-end cost pivot. ⚠️ Confirm Mimo's `/chat/completions` shape with a real key before prod traffic |
| **Ollama** (local) ✅ | ✅ env-gated | `lib/llm/providers/ollama.ts` — `getOllamaModel()` builds via `createOpenAI` against `<OLLAMA_BASE_URL>/v1` | 🚀 **Free** (self-hosted local compute) | `LLM_PROVIDER=ollama`; default `llama3.3` | OSS (MIT) | Cheap smoke-tests of prompt/agent logic without burning Max budget |
| **Plumoai** 🔬 | 🔬 candidate | No code — research line in [`OPEN_SOURCE_ABSORPTIONS.md`](OPEN_SOURCE_ABSORPTIONS.md) | Unknown | Not in `LlmProvider` enum; scope unverified | Unknown | Undetermined — verify scope (provider vs runtime) before wiring |

**Canonical default:** **Claude via the gateway, plan-billed** (asserted in `memory/platform/SECRETS.md` 3-tier
chain + `lib/llm/provider.ts` default `LLM_PROVIDER=claude`). **Architectural gotcha:** the `LLM_PROVIDER` switch
only governs the **third tier** (the API fallback). The primary gateway path calls Claude directly and is
**unaffected by `LLM_PROVIDER`** — to route a business onto OpenRouter/NIM/Mimo/Ollama, the gateway probe must
fail or be disabled. The `claude-llm` ecosystem adapter (the default `llm` capability for every department) *does*
honour `LLM_PROVIDER` + the dynamic `/settings` override (migration 083, DB value beats env).

**Gaps / picks for the orchestrator:**
- **Clearest immediate win:** flip `LLM_PROVIDER=nim` for high-volume low-stakes background work — free tier, already wired, currently under-used.
- ✅ **Mimo + Ollama wired** (this PR): both build a real `LanguageModel` via `createOpenAI` (OpenAI-compatible / Ollama `/v1`), no new npm dep. They build when configured and throw a friendly ConfigError otherwise (chat fallback downgrades to Claude). The Claude-Max-end cost pivot is now unblocked.
- ✅ **`maxTokens` IS enforced** in `lib/ecosystems/adapters/claude-llm.ts:70` (passed as `maxOutputTokens`, defaulting to `DEFAULT_MAX_OUTPUT_TOKENS`). The earlier "not enforced" note was stale — verified 2026-06-07.
- **Doc drift (fixed this PR):** `OPEN_SOURCE_ABSORPTIONS.md` marked NIM as a candidate; the adapter exists and is live. Updated to ✅.
- **Hard provider swap requires bypassing the gateway** — worth an explicit operator runbook step.

---

## 3. Memory systems

These are **not competitors** — they sit at different volatility layers (see the 3-layer
architecture in [`CLAUDE.md`](../../CLAUDE.md)). memory-hq is the canonical cross-project graph.

| System | Layer / role | Wired? | Where | Canonical? | License / cost | Best-for |
|---|---|---|---|---|---|---|
| **memory-hq** 🚀 | L2c — cross-project knowledge graph (atoms / entities / MOCs / sources / synthesis) | ✅ canonical store, Supabase `mol_*` mirror + MCP tools + `/api/memory/*` + adapter | `pinnacleadvisors/memory-hq` repo · [`lib/ecosystems/adapters/memory-hq.ts`](../../lib/ecosystems/adapters/memory-hq.ts) · scope-id `55bedf46-nexus` | ✅ **YES — single source of truth** (`available() => true`) | Private GitHub repo / free | Durable facts shared across every project & model; `memory_search` from any session |
| **molecularmemory_local** ⚠️ | L2 — dev cache + the CLI that writes to L2c | ⚠️ yes, but as a **stale-by-default dev cache** | skill [`.claude/skills/molecularmemory_local/`](../../.claude/skills/molecularmemory_local/) · cache `memory/molecular/` | 🚫 no — explicitly "dev-only cache" | repo-local / free | Offline scratch graph + the write tool (`atom`/`entity`/`moc`/`ingest`) that funnels facts into memory-hq (`--backend=github`) |
| **3-layer file memory** (`memory/`) ✅ | L1 (Brief, stable) + L2 (State, living) | ✅ loaded every session | `memory/INDEX.md`, `memory/platform/*.md`, `memory/roadmap/*.md`, `CLAUDE.md`, `AGENTS.md`, `docs/adr/` | ✅ canonical **for L1/L2 platform docs** | in-repo / free | Stack rules, architecture, roadmap, ADRs — the per-repo brief read before any task |
| **memory-os** (ClaudioDrews) 🔬 | external OSS candidate (trust-scored facts, semantic dedup, decay, 4-level retrieval) | 🔬 RUN-in-lab only (`workforce-lab` w/ Hermes); not in the app | `OPEN_SOURCE_ABSORPTIONS.md` · ADR 012 | 🚫 **NO — must NOT replace memory-hq** (single-maintainer, Hermes-coupled) | OSS / free to run | **ABSORB its features** (trust scores, cosine>0.92 dedup, weekly decay, retrieval cascade) into memory-hq — not adopt wholesale |
| **supermemory** (agent) ✅ | writer/role on top of L2c — terminal node in agent chains | ✅ managed agent; ~12 specs hand off to it post-run | [`.claude/agents/supermemory.md`](../../.claude/agents/supermemory.md) | 🚫 no (it's a *writer* of the graph, not a store) | in-repo agent / free | Deciding what a finished run is worth keeping, then writing atoms into memory-hq |
| **agentmemory** ➖ | generic category term (memory-os / Hermes lineage) | 🚫 zero references in the codebase | n/a | 🚫 no | n/a | Not a Nexus system — the umbrella concept memory-hq + memory-os instantiate |

**Canonical default:** **memory-hq** — the adapter is `available() => true` and reads fall back to the
`mol_*` Supabase mirror so it never goes dark. CLAUDE.md/AGENTS.md repeatedly demote `memory/molecular/`
to "a development cache only — may be empty or stale and the graph still works".

**Gaps / picks for the orchestrator:**
- Remember a durable cross-project fact / look up prior knowledge → **memory-hq** via `memory_atom` / `memory_search` MCP (canonical). Use the local CLI `--backend=github` only when MCP isn't registered.
- Read stack rules / architecture before a task → the **`memory/` 3-layer files** (start at `memory/INDEX.md`).
- Post-run archival → hand off to the **supermemory** agent.
- **Load-bearing guardrail:** memory-os is ABSORB-features / RUN-in-lab only — **do not let it replace memory-hq** (regression). Absorb its 4 features into memory-hq via `task_plan-memory-architecture.md`.
- The memory-hq *adapter* is still a stub (`atom_write`/`search`/`query` proxy to `/api/memory/*`; `memory_walk`/`memory_timeline` return empty until the H-Mem crons land) — callers should use the MCP tools directly, not the adapter, for now.

---

## 4. Code-authoring ecosystems (`EcosystemKind = 'code'`)

| Tool | Open-source | Wired | Where | Strengths | Best-for |
|---|---|---|---|---|---|
| **open-code** 🚀 | ✅ (Open Code, OSS — pre-GA) | 🟡 stub-with-fallback (real client, no native backend yet) | [`lib/ecosystems/adapters/open-code.ts`](../../lib/ecosystems/adapters/open-code.ts) | 🚀 **Default `code` binding.** Self-healing dual-path: native Open Code HTTP API (`OPEN_CODE_BASE_URL`) when set, else routes through **claude-gateway**. `telemetry.via` reports which backend served | Platform-wide default authoring adapter; ships dev work before Open Code GA by piggybacking the gateway |
| **aider** | ✅ (Aider, OSS Python CLI) | 🟡 stub (real client, needs self-hosted shim) | [`lib/ecosystems/adapters/aider.ts`](../../lib/ecosystems/adapters/aider.ts) | Thin HTTP client over an operator-deployed shim; `available()` false until `AIDER_BASE_URL` set | Repo-scoped, git-aware OSS pair-programming behind a JSON contract |
| **claude-code** (via gateway) 🚀 | ✅ **explicit `code:claude-code` adapter** (PR 2026-06-07) | [`lib/ecosystems/adapters/claude-code.ts`](../../lib/ecosystems/adapters/claude-code.ts); `services/claude-gateway/`; **now the `DEFAULT_BINDINGS.code`** | Subscription-billed self-hosted Claude Code; **the de-facto engine today** since Open Code isn't GA | Design-heavy codegen, refactors, multi-file features — the honest default binding (no silent open-code fallback) |
| **codex** | 🚫 proprietary | ✅ **`code:code-codex` adapter** (PR 2026-06-07) wrapping `dispatchToCodexGateway()` | [`lib/ecosystems/adapters/code-codex.ts`](../../lib/ecosystems/adapters/code-codex.ts); `.claude/agents/codex-operator.md`; `services/codex-gateway/` (ADR 002) | Sandboxed exec slice: debug, container setup, deploy, current-UI research. L0 PR-only trust ladder | Execution/ops work — now bindable via `/teams` (`code:code-codex`), not only as a managed agent |
| **cursor** | 🚫 proprietary | 🚫 not wired (named only in a comment) | `registry.ts` header comment | None yet — IDE-centric, no headless HTTP contract | 🔬 candidate: needs `adapters/cursor.ts` + a shim |

**Canonical default:** **open-code** (`DEFAULT_BINDINGS.code = 'open-code'`; no niche overrides it). It is
`available()` whenever the claude-gateway is configured, so it works out-of-the-box. Only `open-code` + `aider`
are registered for `kind: 'code'`.

**Gaps / picks for the orchestrator:**
- General codegen / refactor / multi-file (design-heavy) → **open-code** binding (executes on claude-gateway today; the only one `available()` without extra env).
- OSS / self-hosted git-aware pairing → **aider** (needs `AIDER_BASE_URL`).
- Execution-heavy ops (debug, container, deploy, sysadmin) → route to the **codex-operator** agent via dispatch, **not** an ecosystem binding. Anything touching financial/auth secrets → hand to `doppler-broker` (ADR 001).
- ✅ **Honesty gap closed (PR 2026-06-07):** added explicit [`adapters/claude-code.ts`](../../lib/ecosystems/adapters/claude-code.ts) (`code:claude-code`, no silent fallback — `telemetry.via` always `claude-gateway`) and [`adapters/code-codex.ts`](../../lib/ecosystems/adapters/code-codex.ts) (`code:code-codex`, wraps `dispatchToCodexGateway()`). `DEFAULT_BINDINGS.code` flipped `open-code`→`claude-code` so the binding name matches the backend. `open-code` stays registered for Open Code GA.

---

## 5. Design ecosystems (`EcosystemKind = 'design'`)

| Tool | Open-source | Wired today | Where | Output (comps / tokens / code) | Best-for |
|---|---|---|---|---|---|
| **open-design.ai** 🚀 | ⚠️ self-hostable proxy, license unconfirmed | ✅ the only `design`-kind adapter registered | [`lib/ecosystems/adapters/open-design.ts`](../../lib/ecosystems/adapters/open-design.ts); default in `default-bindings.ts` | ✅ comps (`render_comp`), ✅ tokens (`export_tokens` → json/css/tailwind), 🚫 code | Default end-to-end design provider — wireframe→comp + brand-token export, breakpoint-aware |
| **Vercel v0** | 🚫 closed/SaaS | 🚫 named in prose only | `.claude/agents/departments/design/design-lead.md` | 🚫 comps, 🚫 tokens, ✅ code (React/Tailwind) | Prompt→React/Tailwind — closest match to the `generate_module` gap open-design doesn't cover |
| **Lovable** | 🚫 closed/SaaS | 🚫 named in prose only | `design-lead.md` | 🚫 comps, 🚫 tokens, ✅ code (full-app scaffolds) | Full app/page generation from a prompt |
| **Galileo AI** | 🚫 closed/SaaS | 🚫 named in prose only | `design-lead.md` | ✅ comps (hi-fi mockups), ⚠️ tokens, 🚫 code | Text→high-fidelity UI comp; alternate `render_comp` provider |
| **Figma AI** | 🚫 closed/SaaS | 🚫 named in prose only | `design-lead.md` (publisher role names Figma as a push target) | ✅ comps (editable frames), ⚠️ tokens (variables/styles), 🚫 code | Editable design-file comps + publish/handoff surface |

**Canonical default:** **open-design.ai** — the only wired `design` adapter (`DEFAULT_BINDINGS.design`,
also the `saas` niche default). 3 verbs: `render_comp`, `export_tokens`, `list_templates`. **No public
fallback** — dark until `OPEN_DESIGN_BASE_URL` is set. The four alternatives (v0/Lovable/Galileo/Figma)
exist **only as prose** in the design-lead spec — `getEcosystem('design','v0')` returns `null` today.

**Gaps / picks for the orchestrator:**
- ✅ **Naming-vs-wiring mismatch resolved (2026-06-07):** rather than ship 4 dead stubs for a deprioritized
  department (design-team was superseded by the ADR 012 Paperclip pivot, and v0/Lovable/Galileo/Figma APIs
  don't cleanly map to `render_comp`/`export_tokens`/`list_templates`), the design-lead + visual-renderer
  prose was softened to "open-design is the sole wired provider; alternates planned". No more false-availability.
- **No codegen verb in the design kind** — design→code is intentionally the `code` ecosystem's job (`generate_module` → open-code/claude-code) or the `frontend-design` skill. v0/Lovable would fill it only if you want codegen owned by the design dept.
- Comp render / token export → **open-design** (sole provider). Prompt→component code → **`code` ecosystem** or `frontend-design` skill, not design.

---

## 6. Content-media generation (video / image / voice / music / avatar / speech)

> ✅ **Updated by PR #489 — the table below predates it.** The media stack now HAS registered adapters:
> `video:kling` + `video:runway` (wrapping `lib/video/*`), `image:muapi`, `voice:elevenlabs`, `music:suno`,
> `avatar:heygen`, `speech:whisper`. All are env-gated (callable once their key is set). See the §9 coverage
> map for the current truth; the per-row "🚫 no adapter / env-var only" cells below are historical.

⚠️ *(historical, pre-PR#489)* Only **2 of these had real `EcosystemAdapter` implementations** (Higgsfield,
Pipecat); the rest existed as **env-var names only** in `SECRETS.md`. "Default-bound" = seeded into a team's
`ecosystem_bindings` by `default-bindings.ts`.

| Capability | Tool | Adapter? | Where | Default-bound? | Best-for |
|---|---|---|---|---|---|
| **Video** | Higgsfield | ✅ full HTTP adapter (env-gated) | [`adapters/higgsfield.ts`](../../lib/ecosystems/adapters/higgsfield.ts) | ✅ `video` default + `ecommerce` override | ⚠️ **superseded** (OSS_ABSORPTIONS ❌) yet still the only callable video path |
| Video | Kling | 🚫 env name only (`KLING_API_KEY`) | `SECRETS.md` | 🚫 | Cinematic, high-motion |
| Video | Runway | 🚫 env name only (`RUNWAY_API_KEY`) | `SECRETS.md` | ⚠️ `saas` override → runway (but **no adapter to back it**) | Stylised product-demo |
| Video | Skyreels-v2 | 🚫 not wired | `OPEN_SOURCE_ABSORPTIONS.md` | 🚫 | 🔬 OSS self-hosted video candidate |
| **Image** | MUAPI | 🚫 env name only (`MUAPI_AI_KEY`) | `SECRETS.md` | ✅ `image` default | Scene / general images |
| Image | Flux | 🚫 not wired | `default-bindings.ts` | ⚠️ `ecommerce` override (no adapter) | Photo-realistic product shots |
| **Voice** | ElevenLabs | 🚫 env name only (`ELEVENLABS_API_KEY`) | `SECRETS.md` | ✅ `voice` default | Voiceover / TTS |
| Voice | Voxcpm | 🚫 not wired | `OPEN_SOURCE_ABSORPTIONS.md` | 🚫 | 🔬 OSS voice-cloning (`task_plan-voxcpm-voice-adapter.md`) |
| **Music** | Suno | 🚫 env name only (`SUNO_API_KEY`) | `SECRETS.md` | ✅ `music` default | AI background music |
| Music | Udio | 🚫 env name only (`UDIO_API_KEY`) | `SECRETS.md` | 🚫 | Music (fallback to Suno) |
| **Avatar** | HeyGen | 🚫 env name only (`HEYGEN_API_KEY`) | `SECRETS.md` | ✅ `avatar` default | UGC / avatar video |
| Avatar | D-ID | 🚫 env name only (`DID_API_KEY`) | `SECRETS.md` | 🚫 | Talking-head fallback |
| **Speech (STT)** | Whisper | 🚫 not wired | `default-bindings.ts` | ✅ `speech` default | Transcription |
| **Voice-agent** | Pipecat | ✅ full HTTP adapter (env-gated `PIPECAT_BASE_URL`) | [`adapters/pipecat.ts`](../../lib/ecosystems/adapters/pipecat.ts) | 🚫 (default is `vapi`) | 🚀 Real-time outbound calls without paid Vapi/Retell — sales-CS dept |
| Voice-agent | Vapi | 🚫 not wired | `default-bindings.ts` | ✅ `voice-agent` default (but **unbuilt**) | Hosted voice-agent |

**Gaps / picks for the orchestrator:**
- **Default-vs-reality mismatch (worst in the repo):** `video` defaults to **higgsfield** — simultaneously the only callable video adapter AND marked ❌ superseded. The named successors (Kling/Runway) have env vars but no adapter, so a `saas`-niche team binds video→`runway` and hits `unavailable` at invoke. Build runway/kling adapters (fork `higgsfield.ts`) or change the default off a tool documented as dead.
- ✅ **Registry-callable now:** voice (ElevenLabs), image (MUAPI **+ Flux**), music (Suno/Udio), avatar (HeyGen **+ D-ID**) all have registered env-gated adapters (PR #489 + 2026-06-07). Routing these verbs resolves; they return typed `unavailable` until their key is set.
- Outbound phone / real-time voice → **Pipecat** (only fully-wired option; safer than the unbuilt `vapi` default).
- Voiceover / music / image / avatar through the registry → **not routable** until adapters land — use Phase-18 direct integrations or build the adapter first.

---

## 7. Search & scrape

Two planes: the **ecosystem-adapter plane** (`getEcosystem(kind,name)`, called from dispatch/agent code)
and the **Claude-Code-session plane** (skills + the built-in `WebSearch`, only inside an agent session).

| Tool | Capability | OSS | Wired | Where | Cost | Best-for |
|---|---|---|---|---|---|---|
| **Tavily** 🚀 | 🔎 search · 🚫 scrape | 🚫 proprietary SaaS | ✅ `search` adapter | [`adapters/tavily.ts`](../../lib/ecosystems/adapters/tavily.ts) (wraps `lib/tools/tavily.ts`) | 1k free/mo then paid (`TAVILY_API_KEY`) | Default `search` — LLM-tuned ranked web results for research |
| **Firecrawl** (hosted) | ✅ scrape · ⚠️ crawl/map deferred | ⚠️ OSS engine; this adapter targets the hosted API | ✅ `doc-parse` adapter | [`adapters/firecrawl.ts`](../../lib/ecosystems/adapters/firecrawl.ts) | `FIRECRAWL_API_KEY` (or self-host) | JS-heavy/SPA, anti-bot, thousands of pages, screenshots |
| **firecrawl_local** 🚀 | ✅ scrape · ✅ crawl · ✅ map | ✅ in-repo, dependency-free | ✅ Claude Code skill (token-free) | [`.claude/skills/firecrawl_local/`](../../.claude/skills/firecrawl_local/) | 🆓 free (`fetch` + regex→md) | One public static page→md, sitemap discovery, ≤20-pg crawl without a credit |
| **SearXNG** | 🔎 search (meta-aggregator) | ✅ fully OSS, self-host | ✅ `search` adapter (alt to Tavily) | [`adapters/searxng.ts`](../../lib/ecosystems/adapters/searxng.ts) | 🆓 software; pay only to self-host (`SEARXNG_BASE_URL`) | Cost-free / privacy search; **normalised drop-in** for Tavily (same output shape) |
| **DeerFlow** | 🔬 multi-step research sidecar | ⚠️ external sidecar | 🟡 env vars only, **not started** | `SECRETS.md` (`DEERFLOW_*`) | sidecar URL + key | (Planned) deep research fan-out — unbuilt; use the `deep-research` skill today |
| **WebSearch** (built-in) | 🔎 search (Claude Code native) | 🚫 Anthropic-hosted | ⚠️ in-session only, not in registry | deferred tool (no repo file) | 🆓 bundled | Ad-hoc in-session search with no Tavily key; not callable from dispatch |

**Canonical defaults:** **search → Tavily** (SearXNG is a normalised drop-in when `SEARXNG_BASE_URL` is set);
**scrape → Firecrawl** (`doc-parse`), but inside a session the cheaper first choice is **firecrawl_local**,
escalating to hosted Firecrawl only for JS/anti-bot/screenshot/large-crawl.

**Gaps / picks for the orchestrator:**
- Open-web search from dispatch code → **Tavily** (or SearXNG self-host). In-session with no key → built-in **WebSearch**.
- Single static page / sitemap / ≤20-pg crawl in-session → **firecrawl_local** (free, first choice). JS/SPA/anti-bot/screenshot/large crawl → **hosted Firecrawl**.
- Deep multi-source research → in-session **deep-research** skill today; revisit **DeerFlow** only after it's wired.
- Firecrawl adapter exposes only `scrape_url` (map/crawl deferred); no server-side map/crawl adapter — only the session skill covers those.

---

## 8. Workflow & integration

| Tool | Role | Wired (where) | OSS / license | OAuth source-of-truth | Best-for |
|---|---|---|---|---|---|
| **Composio** 🚀 | OAuth/API broker + action fan-out for 100+ connectors (Twitter, Gmail, Slack, Notion, Stripe, Shopify, GitHub, GA…) | ✅ fully wired — [`lib/composio/client.ts`](../../lib/composio/client.ts), `lib/composio/actions.ts` (`executeBusinessAction()`/`executeAdminAction()`), `lib/oauth/providers.ts`, `adapters/composio.ts` (`run_action`); UI `/settings/accounts` | 🚫 SaaS (managed broker) | 🚀 **Single source of truth** — Composio holds all OAuth tokens; we store only `composio_account_id`; tokens never touch our DB | Any authenticated SaaS action on behalf of a business/user; per-business + admin-scope isolation |
| **n8n** | Visual multi-step workflow runner | ⚠️ runs externally — generated/validated by Nexus (`lib/n8n/validate.ts`, `finalize.ts`, `/api/n8n/generate`+`/debug`, strategist+debugger agents, `mcp__n8n__*`) | ✅ fair-code (Sustainable Use License) | 🚫 delegates auth to Composio / `N8N_ENCRYPTION_KEY` | Long-lived visual workflows for an idea card; steps auto-retry 3× → routes must return 200+`{ok:false}` |
| **Inngest** | Durable event/queue + step-function runtime | ⚠️ half-wired — functions ship (`inngest/functions/*`) + serve route, but `lib/adapters/inngest.ts` marked "NOT YET WIRED" (no cancel, limited status) | ⚠️ SDK Apache-2.0; orchestration hosted (self-host option) | ➖ N/A (event runtime) | Async / fan-out / batch agent loops with durable retries |
| **supercronic** (cron-runner) | Container-native cron firing `/api/cron/*` | ✅ wired — [`services/local-os/cron/`](../../services/local-os/cron/), control surface `crons.json` (`{path,schedule,enabled}`) on the Mac | ✅ MIT | ➖ N/A (scheduler) | Time-based triggers; **replaced cron-job.org** (retired 2026-06-04) — idempotent 200-returning routes |

**Canonical tools:** **Composio** (the only fully production-wired integration layer; the OAuth invariant —
tokens never touch our DB — is enforced in code + AGENTS.md) and **supercronic** (`crons.json` is the
agent-editable cron control surface on the always-on Mac host).

**Gaps / picks for the orchestrator:**
- Authenticated SaaS action → **Composio** `executeBusinessAction()` (per-business) / `executeAdminAction()` (platform ops). Catch `ConnectedAccountMissingError` → surface a "connect <platform>" prompt.
- Multi-step visual workflow → **n8n** (strategist→generate, debugger→repair).
- Async/fan-out/durable retries → **Inngest** functions. Plain time triggers → **supercronic** `crons.json`.
- **Auth-source split (keep visible):** `lib/oauth/providers.ts` is NOT all-Composio — ConvertKit, Cloudflare DNS, Vercel, Resend, PostHog, Sentry, Doppler, Supabase use the `apiKeySetup` pattern (encrypted key on the row + per-business env injection). "Composio is the single OAuth source of truth" holds only for OAuth-brokered platforms.
- The `workflow` ecosystem kind is overloaded — `composio.ts` itself flags that an **n8n adapter** is the canonical workflow adapter still to be added. Inngest adapter needs run-status lookup + cooperative cancel if it becomes load-bearing.

---

## 9. Ecosystem adapter coverage map (15 `EcosystemKind` values)

The master "what can the registry route today" map. Source of truth: the `EcosystemKind` union
([`types.ts:17`](../../lib/ecosystems/types.ts)) × `ALL_ADAPTERS` ([`registry.ts:33`](../../lib/ecosystems/registry.ts)).

> ✅ **All 15 kinds now have ≥1 registered adapter** (closed by PR #489). The `check:ecosystem-bindings`
> guard fails CI if any kind loses coverage or any default binding stops resolving. Adapters are env-gated:
> "in registry" = routable; `available()` = configured-and-callable.

| `EcosystemKind` | Bound adapter(s) | In registry? | File | `available()` gate | Notes |
|---|---|---|---|---|---|
| `llm` | Claude (`llm:claude`) | ✅ | `claude-llm.ts` | 🚀 always `true` | Only kind with a no-config default |
| `code` | Aider, Open Code, **Claude Code**, **Codex** | ✅ | `aider.ts`, `open-code.ts`, `claude-code.ts`, `code-codex.ts` | ⚠️ env-gated | Explicit gateway bindings (2026-06-07); default = `claude-code` |
| `design` | open-design | ✅ | `open-design.ts` | ⚠️ `OPEN_DESIGN_BASE_URL` | Single provider |
| `video` | Higgsfield, **Kling**, **Runway** | ✅ | `higgsfield.ts`, `kling.ts`, `runway.ts` | ⚠️ env-gated | Kling/Runway wrap `lib/video/*` (PR #489); saas default `runway` resolves |
| `image` | **MUAPI**, **Flux** | ✅ | `muapi.ts`, `flux.ts` | ⚠️ env-gated | Flux via Replicate (`REPLICATE_API_TOKEN`), photo-real (2026-06-07) |
| `voice` | **ElevenLabs** | ✅ | `elevenlabs.ts` | ⚠️ `ELEVENLABS_API_KEY` | Added PR #489 (base64 audio) |
| `music` | **Suno/Udio** | ✅ | `suno.ts` | ⚠️ `SUNO_API_KEY`\|`UDIO_API_KEY` | Added PR #489 |
| `avatar` | **HeyGen**, **D-ID** | ✅ | `heygen.ts`, `did.ts` | ⚠️ env-gated | D-ID talking-head fallback wired (`DID_API_KEY`, 2026-06-07) |
| `speech` | **Whisper** | ✅ | `whisper.ts` | ⚠️ `WHISPER_BASE_URL`\|`OPENAI_API_KEY` | Added PR #489 (OpenAI-compatible STT) |
| `memory` | memory-hq, GBrain | ✅ | `memory-hq.ts`, `gbrain.ts` | memory-hq 🚀 always `true`; gbrain ⚠️ env | Best-covered after llm |
| `search` | Tavily, SearXNG | ✅ | `tavily.ts`, `searxng.ts` | ⚠️ env-gated | Paid + self-host both present |
| `browser` | **Playwright/Browserless** | ✅ | `browserless.ts` | ⚠️ `BROWSER_BASE_URL` | Added PR #489 (headless shim) |
| `workflow` | Composio, **n8n** | ✅ | `composio.ts`, `n8n.ts` | ⚠️ env-gated | n8n = run-a-workflow; composio = run-one-action (PR #489) |
| `voice-agent` | Pipecat | ✅ | `pipecat.ts` | ⚠️ `PIPECAT_BASE_URL` | Default repointed `vapi`→`pipecat` |
| `doc-parse` | Firecrawl | ✅ | `firecrawl.ts` | ⚠️ env-gated | `scrape_url` + `parse_pdf` (PDF URL→md; 2026-06-07). True OCR/file-upload engine (Docling) still a follow-up |

**Health summary:** **all 15 kinds are registered** (25 adapters total as of 2026-06-07). Only **2 boot with
zero config** (`claude-llm`, `memory-hq`); the rest are env-gated and return a typed `unavailable` until
configured — the platform stays bootable. `code` (4), `memory`/`search`/`video`/`workflow`/`image`/`avatar`
(≥2) are fallback-capable; the single-provider kinds go dark (not crash) if their one env-gate is unset.

**Remaining follow-ups** (best-effort routers — confirm upstream contract when keys land): the D-ID (`did.ts`)
and Flux (`flux.ts`) routers + the firecrawl `parse_pdf` verb are wired but unverified against live keys;
a true OCR/file-upload `doc-parse` engine (Docling) and a Vapi voice-agent adapter remain unbuilt.

---

## Synergy & single-source-of-truth

The platform now *orchestrates* many third-party tools rather than reimplementing them. Two
questions follow from that: (A) where should the new orchestrator (Paperclip) **delegate to
existing Nexus surfaces** instead of duplicating them, and (B) which **docs** must collapse to
one canonical source now that the lean-Nexus pivot (ADR 012) flipped the default from ABSORB → RUN.

### A. Paperclip ↔ Nexus delegation

**North star:** Paperclip is the *workforce orchestration shell* (org chart, roles, budgets,
governance, heartbeats). It should **call the existing Nexus libraries as its execution substrate**,
never grow a second copy of them. The wiring point is [`lib/adapters/registry.ts`](../../lib/adapters/registry.ts)
(the Paperclip-absorbed adapter abstraction — today holds `claude` / `codex` / `coolify-business` / `n8n` / `inngest`).

| Paperclip concern | Delegate to (Nexus surface) | Status | Effort |
|---|---|---|---|
| Dispatch a worker action | claude-gateway / codex-gateway via `lib/adapters/registry.ts` → `/api/claude-session/dispatch` | ✅ adapters exist (claude/codex) | — |
| Heartbeat / scheduled cycle fires a worker | the **loop primitives** — `loop-runner`, `bug-hunt-loop`, `solopreneur-loop` (`.claude/agents/`) | 🔬 route Paperclip heartbeats into loop dispatch, don't reimplement | M |
| Worker needs a capability (video, search, memory) | the **ecosystem adapter registry** (`lib/ecosystems/registry.ts`, `getEcosystem(kind,name)`) | 🔬 bridge `lib/adapters` ↔ `lib/ecosystems` | S |
| Worker needs a named procedure | the **skills library** (`.claude/skills/*`) via the spawning agent's skill set | 🔬 expose skills to Paperclip workers | S |
| Durable memory / recall | **memory-hq** MCP (`memory_atom` / `memory_search`) — canonical | ✅ keep; Paperclip is governance, not memory | S |
| Authenticated SaaS action | **Composio** `executeBusinessAction()` — single OAuth source of truth | ✅ keep; Paperclip delegates | S |
| Spend / budget enforcement | **cost-guard** (`lib/cost-guard.ts`, `checkKillSwitch`) — the existing kill-switch | ⚠️ **DO NOT** let Paperclip budgets become a second guard | M |
| Approval queue | the existing **`/inbox`** (Paperclip-absorbed already) — one queue across businesses | ⚠️ avoid two inboxes | L |
| Org chart / departments | the **department roster** (`.claude/agents/departments/*`, `lib/teams/*`) | ⚠️ avoid two org-chart systems | L |

**The redundancy risk to manage:** Paperclip ships its *own* org chart, approval inbox, and budget
governance. Nexus already has all three (`lib/teams/*` + `/teams` org-chart, `/inbox`, `lib/cost-guard.ts`).
**Each must have exactly one owner.** The recommended split: keep memory-hq, Composio, the exec-strategist,
and the per-business containers as Nexus-owned; let Paperclip own the org-chart/heartbeat/governance *shell*
and **call** the Nexus dispatch + loop + ecosystem libraries beneath it. Decommission the redundant Nexus UI
only after Paperclip's equivalent is proven in the `workforce-lab` soak — not before.

**Blocking gaps** (from §1): `hermes_local` and `open-code` are **not yet in `lib/adapters/registry.ts`**, so
Paperclip can't route to them; and `lib/adapters` (Paperclip's plane) and `lib/ecosystems` (the capability
plane) are **two separate registries** that should be bridged so a Paperclip worker can reach a video/search/
memory adapter without a third abstraction.

### B. Document consolidation opportunities (review-only)

> Per your instruction these are **listed, not executed** — review before anything is restructured.
> Convention from the lean-Nexus pivot: **banner + register, never delete** (reversible; the `workforce-lab`
> soak re-scores each demoted plan). The hard guardrail: **memory-os features get absorbed into memory-hq —
> memory-os must never replace it.**

| Opportunity | Current state | Canonical SSoT | Action for the others | Effort |
|---|---|---|---|---|
| One OSS-tools ledger | `OPEN_SOURCE_ABSORPTIONS.md` (self-declared SSoT) vs the unbuilt "open-orchestration registry" in `task_plan-lean-mode.md` + `/api/agents/survey-oss-framework` | `OPEN_SOURCE_ABSORPTIONS.md` (+ this matrix) | Fold the survey-registry idea in as a footnote; drop the standalone "registry" ambition | S |
| Paperclip absorption across 6 plans | `task_plan-paperclip-absorption.md`, `-paperclip-ui-phase-2`, `-departments-and-ecosystems`, `-content-team-higgsfield`, `-design-team-open-design`, `-dev-team-open-code` (all ⛔-bannered) | ADR 012 + `task_plan-lean-nexus-pivot.md` + `task_plan-workforce-lab.md` (the RUN successor) | Verify banners; cross-link from workforce-lab | S |
| Chat-stack plans | `task_plan-chat`, `-collaborative-chat`, `-chat-views`, `-sse-streaming`, `-model-agnostic-chat` (all ⛔-bannered) | ADR 013 + `task_plan-chat-replacement.md` | Keep chat-replacement as the sole open chat plan | S |
| model-agnostic-platform not demoted | `task_plan-model-agnostic-platform.md` has **no banner**; sibling `-model-agnostic-chat` is demoted (opencode = model-agnostic by design) | ADR 012 | Add a banner — demote, or scope to the genuinely-Nexus overlay | M |
| lean-mode + ADR 006 stale | `task_plan-lean-mode.md` (single-KVM) + `docs/adr/006` still "Accepted" vs Mac-primary | ADR 011 + `AGENTS.md#topology` | Mark ADR 006 "Superseded by 011/012"; banner the *plan* (the `LEAN_MODE` *flag* stays live) | S |
| "What runs where" restated | full topology narrative re-stated in `task_plan-local-os-migration`, `-business-containers-local-os`, `memory/platform/STACK.md`, `ARCHITECTURE.md`, `docs/runbooks/lean-mode.md` | `AGENTS.md#topology` (declared SSoT) | Replace restatements with `[topology](AGENTS.md#topology)` links (preserve host-only detail like the rollback CNAME snapshot) | M |
| Completed migration plans still open | `task_plan-local-os-migration.md` + `-business-containers-local-os.md` (migration done 2026-06-04) | `AGENTS.md#topology` + `services/local-os/` runbooks | Mark DONE; reduce to a one-line link | S |
| Memory-engine plans proliferating | `task_plan-hmem-architecture.md` + `task_plan-gbrain-integration.md` propose new engines; ADR 012 says keep memory-hq | memory-hq + `task_plan-memory-architecture.md` | Mark hmem/gbrain DECIDE→fold-or-park per lean-nexus-pivot | M |
| ADR index incomplete | `docs/adr/009-gbrain-evaluation.md` exists but is absent from `docs/adr/INDEX.md` | `docs/adr/INDEX.md` | Add the 009 row | S |

**Net read:** the heavy lifting is mostly done — 11 task_plans already carry correct ⛔ SUPERSEDED banners
pointing at `task_plan-lean-nexus-pivot.md`, which + ADR 012 + `OPEN_SOURCE_ABSORPTIONS.md` form a clean
three-tier spine (master plan / decision record / project ledger). The remaining work is the 9 rows above
(mostly S/M) plus re-homing the bespoke-chat governance affordances (typed iteration/edit/signals blocks)
into Paperclip governance **before** the chat plans are treated as fully closed — they move, they are not lost.

---

## How to keep this doc current

1. **A new adapter lands** (`lib/ecosystems/adapters/<name>.ts`) → add/flip its row in the relevant
   category table + the §9 coverage map. Flip 🟡→✅ when `available()` can return true in a normal deploy.
2. **A default binding changes** (`lib/teams/default-bindings.ts`) → move the 🚀 marker.
3. **A tool is superseded/retired** → mark ⚠️/🚫 with a one-line reason; do **not** delete the row (paper trail).
4. **A new OSS tool is evaluated** → its decision (RUN/ABSORB/FORK/REJECT) goes in
   [`OPEN_SOURCE_ABSORPTIONS.md`](OPEN_SOURCE_ABSORPTIONS.md); only add a row *here* once it's selectable for a task.
5. This doc is **not** covered by `check:agent-spec-freshness`. Re-verify against the registry whenever you touch
   `lib/ecosystems/` or `lib/adapters/`. The fastest regeneration is to re-run the analysis workflow that built it.
