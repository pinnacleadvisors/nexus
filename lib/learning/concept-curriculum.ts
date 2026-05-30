/**
 * lib/learning/concept-curriculum.ts — hand-authored "platform internals"
 * lessons for the /learn concept track (Phase 24).
 *
 * Each lesson teaches a concept the agents embody — how an LLM works, the
 * harness h2–h5 layers, what a skill / sub-harness / agent is, and how memory
 * is structured. Paraphrased from AGENTS.md (the harness taxonomy) + the
 * agent-framework MOC. Provider-agnostic by rule: NO model-version names in the
 * prose (the `check:provider-agnostic` gate enforces this).
 *
 * A `concept` card rides the same FSRS scheduler + Feynman grader as atom
 * cards; the lesson `body` is stored in `reference_context`, so the grader
 * uses it as the answer key with zero new plumbing.
 */

export interface ConceptLesson {
  /** Stable kebab-case key — becomes atom_slug `concept:<slug>`. */
  slug:    string
  /** Lesson title — the card front ("Explain: <title>"). */
  title:   string
  /** One-line gist — the card back. */
  summary: string
  /** The explainer (markdown) — shown as the lesson + used as the grader reference. */
  body:    string
}

export const CONCEPT_CURRICULUM: ConceptLesson[] = [
  {
    slug:    'how-an-llm-works',
    title:   'How a large language model works',
    summary: 'An LLM predicts the next token from context; it has no memory between calls, so everything it "knows" for a task must be in the prompt.',
    body: [
      'A large language model is a next-token predictor. Given a sequence of tokens (word fragments), it outputs a probability distribution over the next token, samples one, appends it, and repeats. "Reasoning" is this loop conditioned on everything already in the context window.',
      '',
      'Two consequences drive everything in Nexus:',
      '- **No memory between calls.** Each request starts blank. Anything the model should "know" — prior decisions, file contents, platform rules — must be placed in the prompt. This is why the platform has a memory architecture and injects a platform brief into agent dispatches.',
      '- **The context window is finite.** Tokens cost money and attention degrades as the window fills, so good harness design feeds the model *only* the relevant slice (memory search, tool budgets) rather than everything.',
      '',
      'The model is frozen — we never change its weights. Every improvement we ship adapts the *interface* around it, not the model.',
    ].join('\n'),
  },
  {
    slug:    'harness-layers-h2-h5',
    title:   'The harness layers (h2–h5)',
    summary: 'A harness is the interface around a frozen model: h2 realizes actions, h3 declares what tools exist, h4 regulates the trajectory, h5 packages reusable procedures.',
    body: [
      'Most agent failures are interface mismatches, not model limits — so Nexus adapts the *harness* (the interface around a frozen model) in four layers:',
      '',
      '- **h2 — action realization.** Turns the model\'s stated action into a real call: tool wrappers, retries on malformed arguments, MCP shims.',
      '- **h3 — environment contract.** Tells the agent at runtime what tools, accounts, and scopes exist for this step (tool budgets, the MCP manifest, connected accounts).',
      '- **h4 — trajectory regulation.** Bounds the multi-step path: when to ask for approval, when to stop, when to roll back. The operator-gated loop invariants live here.',
      '- **h5 — procedural skill.** Reusable named procedures the agent can invoke, each independently evaluable.',
      '',
      'When proposing a fix, ask which layer it belongs to. The right layer is usually obvious; the wrong one leaks across the others.',
    ].join('\n'),
  },
  {
    slug:    'what-is-a-skill',
    title:   'What a skill is',
    summary: 'A skill is a reusable, named, evaluable procedure (an h5 unit) defined in a SKILL.md, promoted from draft to verified before the routing layer can invoke it.',
    body: [
      'A skill is the h5 layer made concrete: a small, named, *evaluable* procedure the agent can invoke — like "send a Stripe payment intent" or "scrape a product page". Each lives in its own `SKILL.md` describing what it does and how to run it.',
      '',
      'Skills are acquired in a closed loop: an agent proposes code, runs it in a sandbox, grades the output against success criteria, and retries until it passes consistently. The result is written as `status: draft`.',
      '',
      'A human flips `draft → verified` before the routing layer will call it. This gate matters: the agent never grades its own work into production — verification is the reward signal, and a person confirms it crossed the bar.',
      '',
      'The test of a good skill: would it still make sense if the underlying model were swapped? If yes, it belongs in h5; if it only works for one model, it belongs in that agent\'s prompt instead.',
    ].join('\n'),
  },
  {
    slug:    'what-is-a-sub-harness',
    title:   'What a sub-harness is',
    summary: 'A sub-harness is a composite h5: a bundle of skills + agent refs + a tool manifest + tests + a review spec, crystallized into a replayable unit for a novel goal.',
    body: [
      'A skill is one procedure. A **sub-harness** is the next level up: a *composite* h5 that bundles several skills, the agent references that use them, a tool manifest, tests, and a review spec into one replayable unit aimed at a novel goal.',
      '',
      'It is produced by a "synthesize" loop: an explorer writes and runs tests in a sandbox to prove a sub-harness works *before* any expensive verification spend, then the bundle is crystallized into a `HARNESS.md` plus a database row.',
      '',
      'Like skills, a sub-harness is gated draft → verified before it can be replayed by the platform. Once verified, it is invokable as a single step — the platform replays the whole bundle instead of re-deriving the procedure each time.',
      '',
      'Sub-harnesses are how the platform turns a one-off success into durable, reusable capability without changing the model.',
    ].join('\n'),
  },
  {
    slug:    'what-is-an-agent',
    title:   'What an agent is',
    summary: 'An agent is a spec (role + instructions) bound to a tool set and a model; the platform spawns it to do one kind of work, gated by the harness layers.',
    body: [
      'An agent in Nexus is not the model — it is a *spec* the platform spawns: a markdown file giving the agent a role, instructions, a tool list, and a bound model. The same frozen model runs every agent; what differs is the harness around it.',
      '',
      'Specialist agents (architect, tester, memory-writer, web-scraper) are auto-discovered and delegated to when a task matches their description. Each carries a tool budget (at least two plausible tools per step) so it reacts to the brief rather than being hard-wired to one tool.',
      '',
      'Agents compose: a specialist produces, a second verifies, and both write to the shared memory graph with provenance so divergence is auditable. The per-agent model picked in settings is the agent\'s default; an explicit per-turn model overrides it.',
      '',
      'An agent is, in short, an interface configuration — role + tools + model + memory — wrapped around the same underlying model everything else uses.',
    ].join('\n'),
  },
  {
    slug:    'memory-architecture',
    title:   'How platform memory is structured',
    summary: 'Memory is layered by volatility: stable rules, evolving state, a cross-project atomic graph (memory-hq + its Postgres mirror), and volatile session scratch.',
    body: [
      'Because the model has no memory between calls, the platform keeps an external one, organized by *volatility*:',
      '',
      '- **Brief (rarely changes):** persistent rules, stack decisions, ADRs — per-repo docs.',
      '- **State (evolves across sessions):** the roadmap, the active plan, run history.',
      '- **Cross-project graph (the durable knowledge):** atomic facts, entities, and Maps of Content, one fact per file, linked by wiki-style references. The canonical store is a git repo; a Postgres mirror gives fast vector + full-text + graph search.',
      '- **Session (volatile):** the current chat\'s scratch context.',
      '',
      'A fact becomes durable by being copied to the graph, re-read to confirm the write, then dropped from scratch. The point: a fact one agent learns becomes available to every other agent on every later task — the closest thing the fleet has to shared, persistent understanding.',
    ].join('\n'),
  },
]
