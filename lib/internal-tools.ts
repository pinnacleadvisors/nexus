/**
 * Internal tools registry — the non-OAuth, non-API-key surfaces that
 * /settings/accounts links out to.
 *
 * These are NOT connections to authenticate to (that's lib/oauth/providers.ts).
 * They're navigation cards for first-party features that previously lived on
 * the deleted /tools page (commit ce29955). When that page was removed the
 * child routes (`/tools/claw`, `/tools/n8n`, etc.) survived as deep links —
 * this registry surfaces them again under Connectors so they don't become
 * URL-only orphans.
 *
 * Adding a tool:
 *   1. Append a row below. `href` must point at an existing route under app/.
 *   2. Pick a lucide-react icon name that's present in the bundled icon set
 *      (verify with: `node -e "const l=require('./node_modules/lucide-react');
 *      console.log('IconName' in l)"`).
 *   3. Keep `description` short — it's the only thing the card body shows.
 *
 * The card is admin-only by design (these are platform-wide features, not
 * per-business connections). AccountList filters by scope; see that file
 * for the render logic.
 */

export type InternalToolStatus = 'live' | 'beta' | 'experimental'

export interface InternalTool {
  /** Stable id — used as React key. */
  id: string
  /** Display name on the card header. */
  name: string
  /** One-sentence description shown in the card body. */
  description: string
  /** App route the card links to. Must start with `/`. */
  href: string
  /** Lucide-react icon component name. */
  icon: string
  /** Rough maturity label, drives the status pill on the card. */
  status: InternalToolStatus
}

export const INTERNAL_TOOLS: readonly InternalTool[] = [
  {
    id:          'openclaw',
    name:        'OpenClaw (MyClaw)',
    description: 'Legacy gateway config for the Claude Pro CLI fallback. Connect a MyClaw instance to dispatch milestones without API-billed Anthropic keys.',
    href:        '/tools/claw',
    icon:        'Cpu',
    status:      'live',
  },
  {
    id:          'memory-engine',
    name:        'Memory Engine',
    description: 'Browse and edit the molecular memory graph — atoms, entities, MOCs, and synthesis pages mirrored from the memory-hq repo.',
    href:        '/tools/memory',
    icon:        'Brain',
    status:      'live',
  },
  {
    id:          'knowledge-base',
    name:        'Knowledge Base',
    description: 'Link Notion pages and Google Drive folders to a Forge project so agents read prior research before each session.',
    href:        '/tools/knowledge',
    icon:        'BookMarked',
    status:      'beta',
  },
  {
    id:          'n8n-workflows',
    name:        'n8n Workflows',
    description: 'AI-powered workflow generator. Paste an idea, get importable JSON for your n8n instance.',
    href:        '/tools/n8n',
    icon:        'Workflow',
    status:      'live',
  },
  {
    id:          'ai-consultant',
    name:        'AI Consultant',
    description: 'Paste a business URL — Claude returns the highest-ROI automation opportunities ranked by setup effort and impact.',
    href:        '/tools/consultant',
    icon:        'Lightbulb',
    status:      'beta',
  },
  {
    id:          'content-engine',
    name:        'Content Engine',
    description: 'Neuro-optimised content generator with format templates, tone profiles, and psychological-principle scoring.',
    href:        '/tools/content',
    icon:        'PenLine',
    status:      'experimental',
  },
] as const
