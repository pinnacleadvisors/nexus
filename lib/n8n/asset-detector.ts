/**
 * lib/n8n/asset-detector.ts
 *
 * Pure, dependency-free classifiers used by the n8n workflow generator.
 * Given an idea step, answer three questions:
 *
 *   1. Does this step produce a reviewable asset? → `detectAsset`
 *      (website, image, video, app, ad, landing, email, content, listing)
 *      Used to place Review: <asset> manual-trigger nodes.
 *
 *   2. Is this step complex enough to benefit from a Claude managed agent?
 *      → `needsManagedAgent`
 *
 *   3. Is this step complex enough to warrant SWARM mode (Agent Teams)?
 *      → `needsSwarm`
 *      When true, the session-dispatch node must carry `swarm: true` so the
 *      dispatcher injects CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1.
 */

export type AssetKind =
  | 'website'
  | 'image'
  | 'video'
  | 'app'
  | 'ad'
  | 'landing'
  | 'email'
  | 'content'
  | 'listing'

export interface AssetMatch {
  kind:  AssetKind
  /** Title to use for the Review node, e.g. "Review: website" */
  reviewTitle: string
  /** Notes for the manual-trigger node so the owner knows what to check. */
  reviewNotes: string
}

// Ordered by specificity. First match wins so that "landing page" is classified
// as `landing`, not `website`, and "product listing" is `listing`, not `content`.
const ASSET_RULES: ReadonlyArray<{
  rx:    RegExp
  kind:  AssetKind
  title: string
  notes: string
}> = [
  {
    rx:    /\b(landing\s*page|lander|lead\s*magnet|squeeze\s*page)\b/i,
    kind:  'landing',
    title: 'Review: landing page',
    notes: 'Confirm headline, sub-head, CTA, lead-capture form, mobile layout, analytics.',
  },
  {
    rx:    /\b(website|web\s*site|marketing\s*site|homepage|home\s*page|site\s*build|site\s*launch)\b/i,
    kind:  'website',
    title: 'Review: website',
    notes: 'Confirm the live URL, navigation, copy, mobile layout, CTA, analytics wiring.',
  },
  {
    rx:    /\b(mobile\s*app|web\s*app|saas|application\b|app\s*build|app\s*launch|dashboard\s*app)\b/i,
    kind:  'app',
    title: 'Review: app',
    notes: 'Confirm golden-path UX, auth, error states, deploy target, tracked events.',
  },
  {
    rx:    /\b(video|reel\b|tiktok\s*clip|youtube\s*short|ad\s*creative\s*video|video\s*ad|trailer)\b/i,
    kind:  'video',
    title: 'Review: video',
    notes: 'Confirm hook in first 3s, pacing, captions, export size, platform aspect ratio.',
  },
  {
    rx:    /\b(image|logo|mockup|graphic|illustration|thumbnail|banner|cover\s*art|hero\s*image)\b/i,
    kind:  'image',
    title: 'Review: image',
    notes: 'Confirm composition, brand match, resolution, export sizes, licence clear.',
  },
  {
    rx:    /\b(ad\s*(set|campaign|copy|creative)?|adwords|google\s*ads|meta\s*ads|facebook\s*ads|linkedin\s*ads|tiktok\s*ads|paid\s*promo|ppc|sem)\b/i,
    kind:  'ad',
    title: 'Review: ad',
    notes: 'Confirm audience, budget cap, creative variants, UTM tags, conversion pixel.',
  },
  {
    rx:    /\b(email\s*(sequence|campaign|blast|flow)?|newsletter|cold\s*email|drip|auto-responder)\b/i,
    kind:  'email',
    title: 'Review: email',
    notes: 'Confirm subject, preview text, unsubscribe, renders in Gmail/Outlook, links tested.',
  },
  {
    rx:    /\b(product\s*listing|etsy\s*listing|amazon\s*listing|shopify\s*listing|storefront\s*listing)\b/i,
    kind:  'listing',
    title: 'Review: listing',
    notes: 'Confirm title keywords, bullet points, images, price, structured data / schema.',
  },
  {
    rx:    /\b(blog\s*post|article|white\s*paper|whitepaper|case\s*study|long-?form\s*post|seo\s*post)\b/i,
    kind:  'content',
    title: 'Review: content',
    notes: 'Confirm headline, factual accuracy, SEO meta, internal links, CTA.',
  },
]

export function detectAsset(stepTitle: string, stepOutputs?: string): AssetMatch | null {
  const haystack = `${stepTitle} ${stepOutputs ?? ''}`
  for (const rule of ASSET_RULES) {
    if (rule.rx.test(haystack)) {
      return { kind: rule.kind, reviewTitle: rule.title, reviewNotes: rule.notes }
    }
  }
  return null
}

// ── Managed-agent detection ──────────────────────────────────────────────────

/**
 * A step needs a Claude managed agent when the work involves specialist
 * judgement or multi-tool use, not just a data transform or provider call.
 * The conservative rule: automatable step + a non-trivial verb +
 * (no explicit simple-provider keyword).
 */
const SIMPLE_PROVIDER_KEYWORDS = /\b(send\s*(email|slack|dm)|post\s*to\s*slack|create\s*invoice|update\s*row|read\s*sheet|append\s*row|forward\s*email|webhook|fetch\s*json|get\s*api|post\s*api|parse\s*csv)\b/i

const SPECIALIST_VERBS = /\b(write|design|generate|draft|compose|produce|architect|refactor|plan|strategi[sz]e|research|analy[sz]e|review|edit|optimi[sz]e|build|launch|curate|film|film|shoot|outline|script|storyboard|model|forecast|investigate|evaluate)\b/i

export function needsManagedAgent(
  step: { title: string; automatable: boolean; tools?: string[] },
): boolean {
  if (!step.automatable) return false
  if (SIMPLE_PROVIDER_KEYWORDS.test(step.title)) return false
  if (SPECIALIST_VERBS.test(step.title)) return true
  // If the step carries tools (e.g. "claude + vercel + github") that implies
  // multi-tool coordination → managed agent.
  return (step.tools?.length ?? 0) >= 2
}

// ── Swarm detection ──────────────────────────────────────────────────────────

/**
 * Swarm mode (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1) is only worth enabling
 * when the task clearly decomposes into ≥3 independent sub-tasks that a lead
 * agent would want to dispatch in parallel.
 *
 * Conservative rule: the step title or tool list has at least one "swarm signal"
 * (a phrase implying multi-asset / multi-domain work) AND the step is already
 * marked as needing a managed agent.
 */
const SWARM_SIGNALS: ReadonlyArray<RegExp> = [
  /\bfull\s+(website|marketing\s*site|app|saas|product|launch|campaign)\b/i,
  /\bbuild\s+the\s+(site|app|product|platform|backend|frontend)\b/i,
  /\b(refactor|overhaul|rebuild|redesign)\s+(the\s+)?(auth|backend|api|pipeline|stack)\b/i,
  /\blaunch\s+(a|the)\s+(product|brand|campaign|company)\b/i,
  /\b(multi|cross)[-\s]?(page|channel|platform|asset|stack)\b/i,
  /\bend[-\s]to[-\s]end\b/i,
  /\bweekly\s+cycle\b/i,
  /\b(produce|ship)\s+\d+\s+(posts|pieces|assets|videos|images)\b/i,
]

export function needsSwarm(
  step: { title: string; automatable: boolean; tools?: string[] },
): boolean {
  if (!needsManagedAgent(step)) return false
  const haystack = `${step.title} ${(step.tools ?? []).join(' ')}`
  return SWARM_SIGNALS.some(rx => rx.test(haystack))
}

// ── Suggested agent slug (keyed off capability id + asset kind) ───────────────

/**
 * Given a capability id and optional asset kind, suggest a portable slug for
 * the Claude managed agent that should own the step. The dispatcher uses this
 * slug to look up (or create) a `.claude/agents/<slug>.md` file.
 */
export function suggestAgentSlug(capabilityId: string, asset: AssetKind | null): string {
  if (!asset) return `${capabilityId}-specialist`
  return `${capabilityId}-${asset}-specialist`
}
