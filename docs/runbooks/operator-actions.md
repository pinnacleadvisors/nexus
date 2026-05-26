# Operator Actions — In-Depth Guide (2026-05-27)

The deferred-item audit surfaced 5 work items that Claude can't ship alone — they need the operator at a keyboard. This runbook walks each one end-to-end with up-to-date UI navigation.

**Items covered:**
1. [Cycle 21 — Hyperbolic chamber smoke test against prd](#1-cycle-21--hyperbolic-chamber-smoke-test-against-prd)
2. [Block A2 — qa-runner /api/cron 401 RCA](#2-block-a2--qa-runner-apicron-401-rca)
3. [Mimo + Ollama provider activation (when Claude Max ends)](#3-mimo--ollama-provider-activation-when-claude-max-ends)
4. [memory-hq mirror push (when MCP recovers)](#4-memory-hq-mirror-push-when-mcp-recovers)
5. [sourcelessAtoms + emptyEntities cleanup (memory lint)](#5-sourcelessatoms--emptyentities-cleanup-memory-lint)

Plus reference sections:
- [Using the new AI provider on/off toggle](#using-the-new-ai-provider-onoff-toggle)
- [Quick-reference UI paths](#quick-reference-ui-paths)

> All URLs assume the canonical production host `https://nexus.coolifycloudtunnel.uk`. Substitute `https://localhost:3000` for local-mode work.

---

## 1. Cycle 21 — Hyperbolic chamber smoke test against prd

**What it is:** Run the hyperbolic-chamber business simulation (designed in Cycle 20) against the production database with a real `business_id`. Validates that Monte-Carlo persona generation + LLM voicing + multi-policy A/B converge to plausible KPI deltas on real Stripe + Composio context.

**Why it's operator-gated:** The simulation reads + writes production tables (`simulation_runs`, `simulation_events`, `experiment_metrics`). Even though writes are partitioned by `business_slug` so they can't leak into another tenant's data, the cost-guard kill switch and the operator's eye are the only checks that prevent a runaway-loop scenario.

**Prerequisites:**
- A production business exists at `/businesses/<slug>` with `simulation_enabled = true` (column added by migration 070). Check via `/dashboard` → click any business → look for the "Simulation" badge in the header.
- Doppler `prd` config has `TAVILY_API_KEY` (web search), `ANTHROPIC_API_KEY` OR a healthy Claude Code gateway (LLM voicing), and Stripe in test mode for the target business (no real charges).

**Step-by-step:**

1. **Open `/manage-platform` → Health** in a browser (`https://nexus.coolifycloudtunnel.uk/manage-platform`). The Health tab is the operator's safety net — keep it open in a second window so you can see cron + gateway state while the smoke runs.

2. **Pick the target business.** Go to `/businesses/<slug>` (e.g. `/businesses/pdf-experiment`). Confirm the "Simulation" badge shows `enabled` and the kill-switch panel at the bottom of the page is green.

3. **Open the Simulation tab on that business page.** New A/B + benchmark UI lives at the top — scroll past "Today's plan" to "Simulation".

4. **Click "Start hyperbolic chamber".** The button is in the simulation header next to "Start A/B". It opens a modal asking for:
   - **Days to simulate** — default 30. Hyperbolic chamber compresses 30 days → 1 hour real-time via the Monte-Carlo + Mulberry32 seeding.
   - **Policy count** — default 3 (one champion, two challengers). Higher counts multiply LLM voicing cost; cap at 5 for the smoke.
   - **Cost cap** — default `$2`. Hard ceiling per cost-guard. The simulation aborts when cumulative usage hits this number.
   - **Approval mode** — `manual` (operator approves chat blocks inline) vs `auto` (sim approves itself, faster but no human-in-loop). Use `manual` for the first smoke so you can validate the chat block UI on prd.

5. **Watch the run.** The simulation surface streams chat blocks in the right-hand panel. The progress bar at the top shows day N of 30. Cost-guard usage shows under the bar.

6. **Verify outputs at the end.** When the run finishes (~45-60 min for a 30-day sim at policy count 3):
   - **`/inbox`** should show a "Simulation completed" system alert.
   - **`/businesses/<slug>` → Simulation tab** should show the run in the list with deltas (revenue change, churn rate, CAC).
   - **`/dashboard`** should show no anomalous spikes in `experiment_metrics` for OTHER businesses.
   - **Supabase Studio** (https://supabase.com/dashboard → your project → Table Editor → `simulation_runs`): the new row has `status='completed'`, `compare_group='hyperbolic'`, and a non-null `summary`.

7. **If anything looks wrong:** kill the run via `/manage-platform → Switches` → flip `simulation_kill` to ON. The active simulation aborts within 30s. File a `kind:incident` memory atom describing what went wrong (see [Post-incident memory protocol](../../AGENTS.md#post-incident-memory-protocol)).

8. **Mark task #29 complete.** Once the smoke passes, the operator (or Claude in the next session) can mark `Cycle 21: smoke-test hyperbolic chamber against prd` as complete in the platform task list. `gh workflow run task-list-sync` regenerates the dashboard view.

**Rollback if the smoke fails:**
The simulation writes to `simulation_*` tables only — no production-customer data is touched. To clear a failed run: open Supabase Studio → `simulation_runs` → find the row by `compare_group='hyperbolic'` → delete. `simulation_events` rows cascade-delete via the FK.

---

## 2. Block A2 — qa-runner /api/cron 401 RCA

**What it is:** The `services/qa-runner/` Coolify app POSTs to `/api/cron/post-deploy-smoke` on Nexus to verify a fresh deploy. The hypothesis was that the cron route was returning 401 to qa-runner's bearer token. Block A2 in `task_plan-this-week.md` left this as "RCA needed" because no live curl smoke had been run to confirm the failure shape.

**Why it's operator-gated:** Requires shell access to KVM4 (Coolify host) to read qa-runner logs + Doppler tokens to validate which bearer token the runner is sending. Neither Claude has access to.

**Step-by-step:**

1. **SSH into KVM4** (the lean-mode Coolify host):
   ```
   ssh root@<KVM4-IP>     # IP in your Hostinger control panel → KVM4 → Connect
   ```

2. **Find the qa-runner container ID:**
   ```
   docker ps --filter 'name=qa-runner' --format '{{.ID}} {{.Names}}'
   ```

3. **Inspect the runner's recent logs:**
   ```
   docker logs --tail 200 <id> 2>&1 | grep -E 'post-deploy-smoke|401|unauthorized'
   ```

4. **Confirm the runner's bearer token.** From within the container:
   ```
   docker exec <id> doppler secrets get NEXUS_OPS_TOKEN --plain | head -1
   ```
   Compare to `doppler secrets get NEXUS_OPS_TOKEN --plain --config prd` from your laptop — they should match. If they don't, that's the bug.

5. **Probe the route directly:**
   ```
   curl -sw '\nHTTP %{http_code}\n' \
        -H "Authorization: Bearer <TOKEN>" \
        https://nexus.coolifycloudtunnel.uk/api/cron/post-deploy-smoke
   ```
   - **200 + `{"ok":true}` or `{"ok":false,error:"..."}`:** route is healthy. The 401 was transient or already fixed — close Block A2.
   - **401:** route refused the token. Look at [`app/api/cron/post-deploy-smoke/route.ts`](../../app/api/cron/post-deploy-smoke/route.ts) — confirm which header it checks (`CRON_SECRET` vs `NEXUS_OPS_TOKEN` vs `BOT_BEARER_TOKEN`). The qa-runner runbook ([`docs/runbooks/qa-runner-rollout.md`](qa-runner-rollout.md), if extant) documents the expected token name.
   - **5xx:** route is broken on a different axis. Open an `/issues` row with the stack trace.

6. **Write a memory atom** with the root cause. Linked to `[[mocs/autonomous-qa]]`. Quote from [AGENTS.md → Block A2](../../task_plan-this-week.md): "qa-runner bearer-token mismatch — CRON_SECRET vs BOT_BEARER_TOKEN". When you find the mismatch, the atom title should be exact (e.g. `qa-runner sends BOT_BEARER_TOKEN; route expects CRON_SECRET — fixed by adding fallback`).

**Resolution path:**
- **Token mismatch:** Add a fallback in the route's `isCronAuthed()` check to accept BOTH headers. Or rename qa-runner's env var to match what the route expects. Whichever is easier; document the choice in the atom.
- **Route already healthy:** Close Block A2 with "verified 2026-XX-XX — no auth failure on smoke; original incident was a transient".

---

## 3. Mimo + Ollama provider activation (when Claude Max ends)

**What it is:** Today every LLM call routes through `LLM_PROVIDER=claude` (default — `lib/llm/provider.ts`). [`lib/llm/providers/mimo.ts`](../../lib/llm/providers/mimo.ts) and [`lib/llm/providers/ollama.ts`](../../lib/llm/providers/ollama.ts) are scaffolded stubs — they `throw` when `getLlm()` resolves to them. Activating means replacing the throws with real provider SDK constructors.

**Why it's operator-gated:** Activating Mimo costs money (no longer plan-billed via Claude Max). Activating Ollama requires a self-hosted GPU instance. Both are revenue-affecting decisions that need explicit operator sign-off.

### Path A — Activate Mimo Pro 2.5

**When to do this:** When the Claude Max 20× plan is about to expire and you don't want to renew. Or when you want to A/B Mimo's quality + cost against Claude on real workload before committing.

**Prereqs:**
1. Sign up for Mimo Pro at https://mimo.ai → generate API key. Mimo's pricing page lists current rates.
2. Store the key in Doppler:
   ```
   doppler secrets set MIMO_API_KEY 'mimo_pro_...' --config prd
   doppler secrets set MIMO_BASE_URL 'https://api.mimo.ai/v1' --config prd
   ```

**Activation:**
1. Open [`lib/llm/providers/mimo.ts`](../../lib/llm/providers/mimo.ts). Find the `throw new Error('mimo provider not yet wired')` line.
2. Replace with the OpenAI-compatible adapter (Mimo exposes OpenAI-compatible REST):
   ```ts
   import { createOpenAICompatible } from '@ai-sdk/openai-compatible'

   export function getMimoModel(modelName: string): LanguageModel {
     const provider = createOpenAICompatible({
       name:    'mimo',
       baseURL: process.env.MIMO_BASE_URL ?? 'https://api.mimo.ai/v1',
       apiKey:  process.env.MIMO_API_KEY ?? '',
     })
     return provider.chatModel(modelName)
   }
   ```
3. Run a smoke locally:
   ```
   doppler run -- node -e "
     const { getLlm } = require('./lib/llm/provider.ts');
     getLlm({ provider: 'mimo', model: 'mimo-pro-2.5' });
     console.log('mimo wired');
   "
   ```
4. Flip the env in Doppler:
   ```
   doppler secrets set LLM_PROVIDER 'mimo' --config prd
   ```
5. Redeploy `nexus-app` in Coolify (UI → nexus-app → Redeploy). All chat fallback traffic now hits Mimo.

**Rollback:**
```
doppler secrets set LLM_PROVIDER 'claude' --config prd
```
Redeploy. Returns to Claude. The Mimo key stays in Doppler in case you flip back later.

### Path B — Activate Ollama (self-hosted)

**When to do this:** For local-mode smoke tests without burning Mimo / Claude budget. Or for fully-airgapped deployments.

**Prereqs:**
1. Deploy Ollama on KVM4 alongside the other Coolify apps:
   - In Coolify UI → New Resource → Public Repo → enter `https://github.com/ollama/ollama`
   - Or pull the upstream image: `docker pull ollama/ollama` and create a Coolify Compose app pointing at it.
   - Expose port `11434` on the `coolify` Docker network. Bind to an internal-only DNS name like `ollama.kvm4.local`.
2. Pull a model:
   ```
   docker exec ollama-<id> ollama pull llama3.3:70b
   ```

**Activation:**
1. Open [`lib/llm/providers/ollama.ts`](../../lib/llm/providers/ollama.ts). Replace the throw with:
   ```ts
   import { createOllama } from 'ollama-ai-provider-v2'

   export function getOllamaModel(modelName: string): LanguageModel {
     const provider = createOllama({
       baseURL: process.env.OLLAMA_BASE_URL ?? 'http://ollama.kvm4.local:11434/api',
     })
     return provider(modelName)
   }
   ```
2. `npm install ollama-ai-provider-v2` (or the current `@ai-sdk/ollama` once it ships).
3. Set Doppler:
   ```
   doppler secrets set OLLAMA_BASE_URL 'http://ollama.kvm4.local:11434/api' --config prd
   doppler secrets set LLM_PROVIDER 'ollama' --config prd
   ```
4. Redeploy.

**Rollback:** Same as Mimo — flip `LLM_PROVIDER=claude` and redeploy.

---

## 4. memory-hq mirror push (when MCP recovers)

**What it is:** The lean-mode iteration produced 11 atoms, 7 entities, and 1 MOC in `memory/molecular/` (local cache). The MCP `memory_atom` tool returned 503 during the run, so canonical writes to the `pinnacleadvisors/memory-hq` GitHub repo never happened. The Supabase mirror reads from memory-hq, not local cache — so until the push happens, queries from other repos can't see these atoms.

**Why it's operator-gated:** Requires `MEMORY_HQ_TOKEN` (GitHub PAT with repo scope) in the operator's local shell. The token isn't injected into Nexus runtime — operator runs the CLI from their dev machine.

**Step-by-step:**

1. **Verify the local cache is intact:**
   ```
   ls memory/molecular/atoms/ | grep -E 'voyager|hermes|evoskill|mimo|openclaw' | wc -l
   ```
   Expect ≥10. If less, the cache was wiped — recover from git history (`git log --all -- memory/molecular/atoms/`).

2. **Try the MCP path first** (preferred — atomic, audited):
   - Open Claude Desktop or Claude Code in this repo
   - Run `/molecularmemory_local query "voyager"` — if it returns results from local cache (not memory-hq), MCP isn't reaching memory-hq
   - Run `memory_search "voyager"` directly — if it 500s or 503s, MCP server is still down. Skip to step 3.

3. **Use the CLI with explicit GitHub backend:**
   ```
   export MEMORY_HQ_TOKEN='github_pat_...'         # from your password manager
   export MOLECULAR_BACKEND='github'
   for f in memory/molecular/atoms/voyager-*.md \
            memory/molecular/atoms/hermes-*.md \
            memory/molecular/atoms/evoskill-*.md \
            memory/molecular/atoms/mimo-*.md \
            memory/molecular/atoms/openclaw-*.md \
            memory/molecular/atoms/openswarm-*.md \
            memory/molecular/atoms/higgsfield-*.md \
            memory/molecular/atoms/lean-mode-*.md \
            memory/molecular/atoms/rootless-podman-*.md; do
     [ -f "$f" ] || continue
     title=$(grep -m1 '^title:' "$f" | sed 's/title: //; s/"//g')
     fact=$(sed -n '/^---$/,/^---$/!p' "$f" | head -3)
     node .claude/skills/molecularmemory_local/cli.mjs --backend=github atom \
       "$title" --fact="$fact" --moc=agent-framework-survey
   done
   ```
   Each call returns a JSON `{ ok: true, slug, scopeId }` line.

4. **Push the entities + MOC the same way:**
   ```
   for f in memory/molecular/entities/voyager.md memory/molecular/entities/hermes.md \
            memory/molecular/entities/evoskill.md memory/molecular/entities/openclaw.md \
            memory/molecular/entities/openswarm.md memory/molecular/entities/mimo.md \
            memory/molecular/entities/higgsfield.md; do
     [ -f "$f" ] || continue
     name=$(grep -m1 '^title:' "$f" | sed 's/title: //; s/"//g')
     node .claude/skills/molecularmemory_local/cli.mjs --backend=github entity concept "$name" --from-file="$f"
   done

   node .claude/skills/molecularmemory_local/cli.mjs --backend=github moc agent-framework-survey \
     --atoms=voyager-iterative-curriculum-absorbed,hermes-3-tier-light-index-recall-absorbed,evoskill-proposerevaluator-loop-absorbed \
     --entities=voyager,hermes,evoskill,openclaw,openswarm,mimo,higgsfield
   ```

5. **Verify the writes landed on memory-hq:**
   - Open https://github.com/pinnacleadvisors/memory-hq/tree/main/atoms/55bedf46-nexus
   - You should see the atoms with `frontmatter.author = "cli"` and recent timestamps.
   - The Supabase mirror webhook fires within ~30s; query from inside Claude: `memory_search "voyager"` should return results from `pinnacleadvisors/memory-hq` (not local cache).

**Common failures:**
- **CLI says `MEMORY_HQ_TOKEN missing`:** the env export above didn't stick to the subshell. Run as `env MEMORY_HQ_TOKEN=... node .claude/skills/...` instead.
- **GitHub returns 403:** the PAT doesn't have `repo` scope. Regenerate at https://github.com/settings/tokens/new and update Doppler.
- **GitHub returns 409 / "Update is not a fast-forward":** another agent wrote the same file between your read and push. Re-run — the CLI retries up to 3× automatically.

---

## 5. sourcelessAtoms + emptyEntities cleanup (memory lint)

**What it is:** `cli.mjs lint` currently flags:
- **11 `sourcelessAtoms`** — atoms missing a `locators:` array in their frontmatter (no canonical source URL / GitHub path).
- **2 `emptyEntities`** — `higgsfield` and `openswarm` entity files have frontmatter only, no body content.

**Why it's operator-gated:** Each atom needs a specific source URL the operator has access to (could be the upstream framework's README, a blog post, or a Nexus PR). Picking the right locator is a judgment call.

### Path A — Fix sourcelessAtoms

For each atom in the list:
1. Open `memory/molecular/atoms/<slug>.md`
2. Add a `locators:` array between the `id:` and the empty-line separator in frontmatter:
   ```yaml
   ---
   type: atom
   id: voyager-iterative-curriculum-absorbed
   title: "Voyager iterative curriculum (absorbed)"
   kind: pattern
   status: absorbed
   locators:
     - kind: url
       href: https://voyager.minedojo.org
     - kind: github
       repo: MineDojo/Voyager
       path: README.md
   ---
   ```
3. Save. `cli.mjs lint` after editing all 11: `sourcelessAtoms: 0`.

**Suggested locators per atom** (operator confirms each is accurate before saving):

| Atom slug | Suggested locator |
|---|---|
| `voyager-iterative-curriculum-absorbed` | `url: https://voyager.minedojo.org` |
| `voyager-vector-db-skill-drift-rejected` | `url: https://voyager.minedojo.org` (same source, opposite verdict) |
| `hermes-3-tier-light-index-recall-absorbed` | `url: https://github.com/InstadeepAI/Hermes` |
| `hermes-frontmatter-skill-routing-absorbed` | `url: https://github.com/InstadeepAI/Hermes` |
| `hermes-system-wide-rollback-absorbed` | `url: https://github.com/InstadeepAI/Hermes` |
| `evoskill-proposerevaluator-loop-absorbed` | `url: <evoskill paper / repo URL>` |
| `evoskill-git-branched-skill-versioning-absorbed` | `url: <evoskill paper / repo URL>` |
| `openclaw-tool-switchboard-fragility-rejected` | `github: pinnacleadvisors/nexus`, `path: services/claude-gateway/README.md` |
| `mimo-pro-25-cheap-top-performer-trial` | `url: https://mimo.ai` |
| `lean-mode-pivot-via-feature-flag-not-branch-fork-nexus-pattern` | `github: pinnacleadvisors/nexus`, `path: docs/adr/006-lean-mode-pivot.md` |
| `rootless-podman-sandbox-for-closed-upskilling-loop-nexus-pattern` | `github: pinnacleadvisors/nexus`, `path: services/nexus-sandbox/README.md` |

### Path B — Fill emptyEntities

For `higgsfield.md` and `openswarm.md`:
1. Open `memory/molecular/entities/<slug>.md`
2. Add a body section after the frontmatter:
   ```markdown
   # Higgsfield

   Long-form physical-motion video model. Used by the Nexus content team for [[atoms/higgsfield-cinematic-clip-render-default]].

   ## Key facts
   - URL: https://higgsfield.ai
   - API surface: REST + webhook callback
   - Pricing: ~$0.02/sec generated (as of 2026-05)

   ## Linked work
   - [[mocs/content-team-higgsfield]]
   - [[atoms/higgsfield-cinematic-clip-render-default]]
   ```
3. `cli.mjs lint`: `emptyEntities: 0`.

After both paths complete, regenerate the graph:
```
node .claude/skills/molecularmemory_local/cli.mjs graph
node .claude/skills/molecularmemory_local/cli.mjs reindex
```

---

## Using the new AI provider on/off toggle

**Shipped in PR #392** alongside this runbook. The toggle lets you disable individual AI providers (Anthropic, OpenAI, Google, xAI, DeepSeek, Replicate, Meta, Mistral, OpenRouter) even when they're connected — the recommender + chat-fallback then route to the next available provider.

**Use cases:**
- **Cost ceiling reached on Anthropic** — flip Anthropic off while keeping the gateway configured. Chat falls back to OpenAI (via Codex gateway) or OpenRouter.
- **Provider misbehaving (rate limits, downtime)** — turn off temporarily without removing the API key. Flip back on once the upstream recovers.
- **A/B testing the recommender on a smaller provider set** — disable everything except OpenRouter to force every recommendation through the unified router.

**UI:**
1. Open `/settings/ai-providers` (or `/settings?tab=ai`).
2. Each provider card has a small **On / Off** pill in the top-right corner. Green-tinted "On" = enabled (default). Grey "Off" = disabled.
3. Click the pill — toggle is optimistic (flips immediately), commits to the DB in the background.
4. When disabled, the card mutes its colors and shows an inline banner: *"Routing skips <provider>. The platform falls back to the next available provider"*.

**API:**
- `PATCH /api/models/providers/<provider>` with `{ "disabled": true }` (or `false`).
- `GET /api/models/providers` lists currently-disabled providers.

**Storage:** Migration 082 added `ai_provider_disabled (user_id, provider, reason, disabled_at)`. Presence in the table = disabled. The settings toggle reads / writes this table directly via `lib/models/provider-toggle.ts`.

**Routing impact:**
- `lib/models/providers.ts:detectAvailableProviders(userId)` subtracts the disabled set before returning.
- `lib/models/recommender.ts` reads the filtered list — disabled providers' models never appear in recommendations.
- `app/api/chat/route.ts` fallback chain skips disabled providers when resolving the LLM at request time.

**Important:** the toggle does NOT remove the connection. Your API keys + gateway tokens stay in Doppler. Flipping back to "On" is instant — no reconnect step.

---

## Quick-reference UI paths

| What you need | URL | Notes |
|---|---|---|
| AI provider toggle | `/settings?tab=ai` | Per-provider On/Off pill; see above |
| Connected accounts | `/settings/accounts` | OAuth + API key connections via Composio |
| Run a cron manually | `/manage-platform?tab=health` | Each cron row has a "Run now" button |
| Clean orphan board cards | `/manage-platform?tab=health` | "Orphan-card sweep" section near the bottom |
| Promote a draft skill | `/settings?tab=skills` | Each draft skill has a "Promote" button next to the status pill |
| Recommend a model for a skill | `/settings?tab=skills` | "Recommend" button on each skill row |
| Disable a kill-switch | `/manage-platform?tab=switches` | One row per switch; toggle activates within 60s |
| Audit log (every MCP tool call) | `/audit` | Filterable by `mcp_server`, `tool_name`, `result_status` |
| Inbox (alerts + tasks) | `/inbox` | Cron failures, simulation completions, etc. |
| Per-business config | `/businesses/<slug>` | Today's plan, simulation, kill switch, Slack settings |
| All businesses | `/businesses` | Cards grid |
| Forge (idea curation chatbot) | `/forge` | Multi-turn chat → board cards |
| Kanban board | `/board` | Filterable by business slug |
| Knowledge graph | `/graph` | Reads from `pinnacleadvisors/memory-hq` via Supabase mirror |
| Doppler (secrets) | https://dashboard.doppler.com → nexus project | One source of truth; Coolify pulls via `DOPPLER_TOKEN` |
| Coolify (deploys) | https://coolify.<your-kvm4-host> | nexus-app + claude-gateway + codex-gateway + n8n + nexus-sandbox + qa-runner |
| Stripe dashboard | https://dashboard.stripe.com | Per-business attribution via `metadata.business_slug` |
| Clerk users | https://dashboard.clerk.com | Add operator ID to `ALLOWED_USER_IDS` Doppler var |
| Supabase Studio | https://supabase.com/dashboard | Table editor + SQL editor for direct DB access |
| Cloudflare Tunnel | https://one.dash.cloudflare.com → Networks → Tunnels | Routes nexus.coolifycloudtunnel.uk → KVM4 |
| cron-job.org | https://console.cron-job.org | Scheduler post-lean-mode; every cron entry mirrors `vercel.json` |

---

## When in doubt

1. **Take a screenshot** of the failing surface and drop it into the operator chat.
2. **Run the topology check:** `npm run check:topology` confirms the codebase still matches the documented "what runs where" paragraph at the top of `AGENTS.md`.
3. **Read the latest atoms:** `memory_search "incident"` surfaces every `kind:incident` atom written by past operator + agent sessions.
4. **Write your own atom** when you finish an operator action. The next session reads it via `memory_search` and doesn't have to re-discover what you did. Template:
   ```
   memory_atom({
     scope:    { repo: "pinnacleadvisors/nexus" },
     payload:  { title: "<what you did> YYYY-MM-DD", body: "<symptoms · what you tried · what worked>", kind: "incident", importance: "normal" },
     locators: [{ kind: "github", repo: "pinnacleadvisors/nexus", path: "<file you touched>" }],
     links:    ["[[mocs/<topic>]]"],
   })
   ```
