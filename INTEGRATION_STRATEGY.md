# Nexus Integration Strategy — Building Synergistic Features

**Version:** 1.0  
**Date:** 2026-04-16  
**Philosophy:** Transform Nexus from isolated features into a cohesive idea-to-execution platform where each component amplifies the others. n8n is the automation backbone; OpenClaw/browser automation is optional and manual for now.

---

## North Star: The Idea-to-Revenue Loop

```
Idea (Forge) 
  ↓
Research & Strategy (Swarm + Tavily)
  ↓
Workflow Design (Consultant Agent)
  ↓
Implementation (n8n Automation)
  ↓
Content Production (Tribe v2 + Video)
  ↓
Approval & Publishing (Board)
  ↓
Revenue Tracking (Dashboard)
```

Every step is **automated as much as possible**, with **human approval gates** at critical junctures. **n8n orchestrates** the technical implementation; agents provide intelligence.

---

## Integration Patterns by Phase

### Pattern 1: Idea → Automation (Phases 2, 13, 11)

**Goal:** User describes an idea in Forge. System designs and drafts n8n automation.

**Flow:**

1. **Forge (Phase 2)** — User converses with consulting chatbot; describes business idea, pain points, target audience, current tools
2. **Context injection (Phase 20)** — System searches `nexus-memory` for similar past ideas; injects prior context as "learnings from last time"
3. **Swarm orchestration (Phase 11)** — If complexity is high (5+ stakeholders), dispatch to multi-agent swarm:
   - **Strategist Queen** — decomposes into implementable phases
   - **Researcher agent** — Tavily search for best tools/approaches (Phase 17c)
   - **Analyst agent** — cost-benefit analysis
   - **Result:** Structured decomposition saved to memory
4. **Consultant Agent (Phase 13a)** — Takes Forge context + swarm decomposition → generates ranked automation recommendations with tool combinations
5. **n8n Blueprint Generator (Phase 13b)** — For each recommendation, auto-generate n8n workflow template with setup checklist
6. **Gap Detection (Phase 13c)** — Flag steps that require browser automation (fallback to manual task for user, optional OpenClaw dispatch)
7. **Board Integration** — Create cards:
   - **Backlog:** n8n setup tasks (one per workflow)
   - **Review:** Consultant report with recommendations
   - **Linked to Notion/Memory:** Full decomposition for future reference

**Result:** User has a prioritized, buildable automation plan ready for implementation.

---

### Pattern 2: Workflow Generation at Scale (Phases 13, 11, 15)

**Goal:** Generate high-quality n8n workflows using agent intelligence + learned patterns.

**Flow:**

1. **User input** → `/tools/n8n` "Generate Workflow" panel
2. **Library check (Phase 15)** — Query code/prompt library for similar workflows (e.g., "lead capture → CRM")
3. **Reasoning bank retrieval (Phase 11)** — If this workflow type was done before, fetch the `reasoning_patterns` that worked best (model used, consensus type, token efficiency)
4. **Swarm generation** — If high complexity:
   - **Tactical Queen** assigns: Architect (design workflow), Coder (write JSON), Reviewer (test logic), Tester (dry-run checks)
   - All operate on the n8n API
5. **Template search (Phase 13b)** — Check 8 pre-built templates first; if match found, propose template + customizations
6. **Gap analysis (Phase 13c)** — Scan workflow for browser automation / complex API requirements:
   - ✅ API-native → full n8n workflow
   - ⚠️ Hybrid → split into n8n + manual steps (marked as Board cards)
   - 🔴 Browser-heavy → offer as manual task or optional OpenClaw dispatch
7. **Setup checklist** → Auto-generated per workflow:
   - API keys to add
   - Account creation steps
   - Test data setup
   - Activation checklist
8. **Board card** → Backlog card per step; user works through checklist

**Cost:** 1–3 API calls per workflow generation. Library hits save ~200 tokens.

---

### Pattern 3: Content → Video Pipeline (Phases 12, 18, 13)

**Goal:** Tribe v2 generates neuro-optimised content; n8n pipes it into video production.

**Flow:**

1. **Tribe v2 Content (Phase 12)** — User requests LinkedIn post / VSL script / email copy
   - Generates with neuro-scoring (A–F grade)
   - Stores in library (Phase 15) if score ≥ B
2. **Content approval (Board)** — Review card with inline editor; user can iterate scoring
3. **Format detection** — If format = `vsl-script`:
   - **Offer:** "Export to Video"
4. **n8n video workflow (Phase 13b + 18)** — Automated flow:
   - Script → Scene breakdown (agent)
   - Scene breakdown → Kling/Runway prompt (Claude Sonnet)
   - Per-scene: call Kling API → poll for completion → collect video
   - **FFmpeg node (in n8n):** stitch scenes → add timestamps
   - **ElevenLabs node:** voiceover generation (agent-selected voice from `voice_profiles`)
   - **Suno/Udio node:** background music generation
   - **FFmpeg mix:** audio sync + ducking
   - Final MP4 → R2 storage → presigned URL
5. **Asset review (Board)** — Review card with embedded video player:
   - Watch final video
   - Cost breakdown (per-scene rendering costs)
   - One-click platform export (9:16, 1:1, 16:9 crop via FFmpeg)
6. **Memory log (Phase 20)** — Script + video stored in `nexus-memory/content/<business-id>/`

**Cost:** ~$2–8 per 60s video (Kling + ElevenLabs + music).

---

### Pattern 4: Swarm Intelligence Improving n8n Decisions (Phases 11, 13, 15)

**Goal:** Swarm agents learn which tool combinations work best; improve future workflow generation.

**Flow:**

1. **n8n workflow executes** — results logged to Supabase `swarm_tasks` table
2. **Feedback loop** — User marks workflow as "worked great," "ok," or "broke"
3. **Reasoning bank update** — Result quality + tokens used → inserted into `reasoning_patterns`:
   ```
   {
     task_type: "lead_capture",
     agent_role: "architect",
     model: "sonnet-4-6",
     result_quality: 9,     // user score
     tokens_used: 1240,
     tool_combination: "zapier + segment + salesforce"
   }
   ```
4. **Router learning (Phase 11)** — Q-Learning router sees this success:
   - **Reward** = quality / normalized tokens = 9 / 1240 = high
   - **Routing decision** saved
5. **Next time user requests lead capture** → Router favours the tool combo that worked before
6. **Library auto-save** — If result was exceptional, auto-save the n8n workflow JSON + prompt to library (Phase 15)

**Result:** Platform gets smarter with every workflow. Second-time cost is 70% lower (cached patterns + library reuse).

---

### Pattern 5: Research → Automation (Phases 17c, 13, 11)

**Goal:** Swarm researcher generates insights; platform auto-designs automation based on findings.

**Flow:**

1. **Researcher agent task** → "Analyse top SaaS tools for [market segment]"
2. **Tavily live search (Phase 17c)** — Multi-hop research across Tool website, review sites, G2
3. **Research report** → Saved to memory + Board card
4. **Consultant agent reads report** → "Based on this market research, here's the optimal tech stack"
5. **n8n generation** → Auto-draft workflows using tools from research
6. **Chain of trust** → Research citations linked in memory; every automation has source trail

**Example:** Research finds Segment is best CDP for e-commerce.
- Consultant proposes: Shopify (source) → Segment (via Zapier) → Amplitude (analytics)
- n8n blueprint auto-generated with Segment auth template
- Board card created; user reviews

---

## Integration Checklist

### Immediate (This Month)

- [x] **Wire Tavily into researcher agent** — `lib/swarm/agents/registry.ts` researcher system prompt updated with multi-hop search instructions; runtime injection via `/api/agent` already live
- [x] **Consultant Agent dashboard** — `/tools/consultant` standalone page with opportunity cards, Tavily source count badge, Board card confirmation, streaming output; added to sidebar
- [x] **n8n webhook receiver** — `POST /api/webhooks/n8n` implemented with HMAC verification, card updates, error handling
- [x] **Gap analysis display** — `GapAnalysisCard` in `/tools/n8n` shows n8n-native vs OpenClaw steps with dispatch button

### Short Term (Next 2 Months)

- [ ] **Swarm + Consultant orchestration** — High-complexity ideas route through swarm first, then consultant
- [ ] **Library auto-population** — Every successful n8n workflow saved to code library
- [ ] **Reasoning bank feedback loop** — User quality ratings → router learning → next generation improves
- [ ] **Content → Video pipeline** — Tribe v2 "Export to Video" button functional
- [ ] **Voice profiles table** — Store user's brand voice(s); agents recall for consistency

### Medium Term (Next Quarter)

- [ ] **Notion/Memory sync (Phase 20)** — GitHub `nexus-memory` as primary; optional Notion mirror
- [ ] **DeerFlow fast-track (Phase 17)** — Deploy on Railway; researcher + coder agents gain sandboxed execution
- [ ] **Video analytics** — Track published video performance; feed back to Tribe v2 scoring weights
- [ ] **Swarm telemetry dashboard** — Visualise swarm reasoning, reasoning bank hits, token efficiency gains

---

## n8n as Automation Backbone

### Why n8n First, Not OpenClaw?

| Criterion | n8n | OpenClaw |
|-----------|-----|----------|
| **Cost** | Free (self-host) | Included with Claude Pro (~$20/mo) |
| **Speed** | ~500ms per workflow step | ~3–5s per agent round-trip |
| **Integration coverage** | 500+ node types (APIs, databases, files) | Limited to tasks agent can instruct Claude to do |
| **Repeatability** | Deterministic; same input → same output | Non-deterministic; agent may deviate |
| **Learning curve** | Drag-and-drop UI; easy to debug | Requires prompt engineering |
| **Browser automation** | Can't interact with JavaScript-rendered sites | Can via Playwright |
| **When to use** | CRM sync, data pipelines, scheduled jobs, multi-step API chains | Complex logic, browser automation, context-aware decisions |

**Our approach:**
- **Default:** Design in n8n (100% of capability)
- **Blockers:** If workflow requires browser automation or 2FA → propose as manual task, optional OpenClaw dispatch
- **Future:** When budget allows, add OpenClaw for the 5–10% of workflows that need it

---

## Feature Dependency Graph

```
Forge (2)
  ↓
  Consulant Agent (13a) ← Swarm (11) + Tavily (17c)
  ↓
  n8n Blueprint (13b) ← Templates (13b) + Library (15)
  ↓
  Gap Detection (13c) ← [Manual fallback for OpenClaw steps]
  ↓
  Board Cards (4) ← Review + Approval
  ↓
  Execution + Logging (13)
  ↓
  Memory Update (20)
  ↓
  Reasoning Bank (11) ← Learn for next time
  ↓
  Library Update (15) ← Reuse code/prompts
```

---

## Example User Journey: "Automate Our Lead Funnel"

### Day 1: Ideation (1 hour)

```
User → Forge chat:
"We get leads via LinkedIn, Google Ads, and a typeform. 
They land in a CSV. We want them auto-qualified, sent to Salesforce, 
and get a welcome email. Budget: free."

Claude (Consulting mode):
"Perfect. I see 4 steps:
1. Ingest leads (n8n can read CSV, watch Google Ads via API, Zapier integration for typeform)
2. Qualify leads (Claude Haiku scoring → Slack notification if high-value)
3. Push to Salesforce (n8n native Salesforce node)
4. Send welcome email (Resend node)

I'm generating 3 workflows for you. Review on the Board."
```

**System behind the scenes:**
- Swarm Strategist breaks down goal
- Tavily researcher finds: Salesforce has native CSV import, Typeform has Zapier integration
- Consultant generates 3 options (CSV + Zapier, CSV + Make, CSV + n8n HTTP polling)
- Gap analysis: all n8n-native, no browser automation needed
- Board: 3 Review cards, one per workflow

### Day 2: Setup (2 hours)

```
User clicks "Import to n8n" on workflow #1.
Workflow template opens in n8n.

Checklist:
☐ Paste Google Ads API key (Doppler → Env var)
☐ Connect Typeform via OAuth (button in n8n UI)
☐ Create Salesforce Connected App (link + instructions)
☐ Test with sample lead
☐ Activate workflow
☐ Monitor first 10 runs
```

**System:**
- Setup checklist auto-generated from workflow
- Board Backlog card per step (5 cards)
- User moves cards to In Progress → Completed as they work

### Day 3: Execution & Learning

```
Workflow runs 24/7.

After 100 leads processed:
- 87 auto-qualified ✅
- 13 marked for manual review
- All landed in Salesforce
- 78 opened welcome email

User marks workflow: "Great! It's working."
```

**System:**
- `swarm_tasks` logs execution
- Reasoning bank records: consultant + n8n choice = success + cost breakdown
- Router learns: "For lead qualification tasks in B2B, Salesforce + n8n is good choice"
- Code library stores: the working workflow JSON
- Next time user asks for lead funnel → system suggests this workflow

### Month 1: Expansion

```
User: "Now we want to send cold emails to unqualified leads."

Claude: "I found a workflow you built last month. 
Suggesting: reuse Salesforce query + add Resend email sequences + delay node.
Setup time: 15 min instead of 1 hour."
```

**System:**
- Library hit: similar workflow
- Reasoning bank hit: n8n Salesforce node known to work
- Estimated setup time cut by 75%

---

## Testing the Integration: Quick Wins

### Test 1: Consultant Agent Alone (2 hours)

1. Go to `/tools/agents` → launch Consultant capability
2. Input: "I want to automate social media posting"
3. Output should be: 3 ranked recommendations with tool combos
4. Verify: output includes `openClawEscalations: []` (all n8n-native)

**Success criteria:** Recommendations are specific (Zapier + Buffer, or n8n + YouTube node) not generic.

---

### Test 2: Workflow Generation (3 hours)

1. Go to `/tools/n8n`
2. Describe: "Send Slack message when Google Forms response arrives"
3. Verify:
   - Template match? "No template, generating…"
   - Gap analysis? "100% n8n-native"
   - Setup checklist? "Connect Google Forms OAuth, test, activate"
4. Import to n8n (if running locally)

**Success criteria:** Generated workflow is valid n8n JSON, zero browser automation steps.

---

### Test 3: Swarm + Consultant (4 hours)

1. Dispatch high-complexity task to Swarm: "Design our full SaaS onboarding automation"
2. Swarm should:
   - Strategist: Break into 5 phases
   - Researcher: Find best onboarding tools
   - Analyst: Cost breakdown
3. Results saved to memory
4. Route to Consultant: auto-generate 3 n8n workflows from decomposition

**Success criteria:** Workflows reference findings from research (e.g., "Use Segment because researcher found it best-reviewed").

---

## Roadmap Dependencies

**Required for full synergy:**

1. ✅ **Phase 13 (Consultant + n8n)** — Core automation engine
2. ✅ **Phase 17c (Tavily)** — Research context for smarter recommendations
3. ✅ **Phase 11 (Swarm)** — Multi-agent decomposition for complex ideas
4. ✅ **Phase 15 (Library)** — Code/prompt reuse, token savings
5. ✅ **Phase 20 (Memory)** — Context injection from prior runs
6. 🔧 **Phase 4 (Board)** — Review/approve automation; already exists, needs Board → n8n wiring
7. 🔧 **Phase 18 (Video)** — Content → video pipeline; needs Tribe v2 + n8n integration
8. ⏳ **Phase 17 (DeerFlow)** — Sandboxed execution for coder workflows (fallback: manual)

**OpenClaw dependency:**
- ✅ **Phase 19 (Dev Console)** — Optional for "build-yourself" mode
- ⏳ **All browser-automation steps** — Currently marked as manual tasks; user can request OpenClaw dispatch

---

## Success Metrics

### Month 1

- [ ] Consultant agent generates valid n8n blueprints for ≥80% of business ideas
- [ ] Average setup time per workflow: <1 hour
- [ ] Zero browser-automation surprises (gap analysis flags them before user starts)

### Month 2

- [ ] Workflow reuse rate: 3rd workflow is 50% faster than 1st (library + reasoning bank hits)
- [ ] Swarm recommendations are cited with research sources
- [ ] Video pipeline produces ≥1 video/week at <$5 cost

### Quarter 1

- [ ] Platform can design & deploy 10-step automation from natural language
- [ ] Users submit feature requests → Swarm research → n8n blueprints (autonomous improvement loop)
- [ ] n8n cost savings vs Zapier: >40%

---

## Risk Mitigation

### Risk: Swarm agents generate hallucinated workflows

**Mitigation:**
- All swarm outputs reviewed by Consultant agent before n8n generation
- Gaps flagged: unknown API endpoints, missing authentication
- Library search first: if similar workflow exists, offer it

### Risk: n8n doesn't support a key tool integration

**Fallback:**
- HTTP Request node + API docs (covers ~95% of SaaS)
- Marked as "Expert setup required" in checklist
- Manual task option: user handles via Zapier / Make

### Risk: User expects OpenClaw browser automation by default

**Education:**
- Every workflow shows gap analysis
- Browser-automation steps clearly marked in checklist
- Offer: "This step requires browser interaction. [Set up manually] or [Request OpenClaw dispatch]"

---

## Next Steps

1. **This week:** Verify Tavily injection works in researcher agent
2. **Next week:** Test Consultant → n8n generation end-to-end
3. **Following week:** Wire n8n webhook to Board; test workflow execution logging
4. **Following week:** Build Swarm + Consultant orchestration for high-complexity ideas
5. **Following week:** Test full loop: Forge → Swarm → Consultant → n8n → Board → Execution → Memory

---

**Questions?** This brief is the source of truth for how features should interconnect. Update it as you discover new patterns or blockers.
