/**
 * lib/n8n/gap-detector.ts
 *
 * Analyses n8n workflows to detect "API gaps" — steps that cannot be
 * accomplished via a public REST/GraphQL API and therefore require
 * OpenClaw browser automation.
 *
 * Priority routing rule (Phase 13c):
 *   n8n is ALWAYS tried first.
 *   OpenClaw is only escalated when a step genuinely requires:
 *     • Browser automation (login forms, button clicks, JS-rendered pages)
 *     • Web scraping from sites without a public API
 *     • 2FA / CAPTCHA flows that block headless access
 *     • Platform DM/connection automation with no API tier
 */

import type { N8nWorkflow, N8nNode } from './types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkflowStep {
  id:              string
  description:     string
  nodeType?:       string
  canUseN8n:       boolean
  openClawReason?: string   // only set when canUseN8n = false
}

export interface GapAnalysis {
  apiNativeSteps:     WorkflowStep[]
  openClawSteps:      WorkflowStep[]
  hybridRequired:     boolean
  routingExplanation: string
  summary:            string
}

// ── n8n-native node types (always safe — no browser needed) ──────────────────

const N8N_NATIVE_TYPES = new Set([
  'n8n-nodes-base.scheduleTrigger',
  'n8n-nodes-base.webhook',
  'n8n-nodes-base.respondToWebhook',
  'n8n-nodes-base.manualTrigger',
  'n8n-nodes-base.httpRequest',
  'n8n-nodes-base.slack',
  'n8n-nodes-base.gmail',
  'n8n-nodes-base.emailSend',
  'n8n-nodes-base.notion',
  'n8n-nodes-base.hubspot',
  'n8n-nodes-base.salesforce',
  'n8n-nodes-base.pipedrive',
  'n8n-nodes-base.stripe',
  'n8n-nodes-base.quickbooks',
  'n8n-nodes-base.xero',
  'n8n-nodes-base.twitter',
  'n8n-nodes-base.linkedIn',
  'n8n-nodes-base.github',
  'n8n-nodes-base.gitlab',
  'n8n-nodes-base.googleDrive',
  'n8n-nodes-base.googleSheets',
  'n8n-nodes-base.googleDocs',
  'n8n-nodes-base.gmail',
  'n8n-nodes-base.telegram',
  'n8n-nodes-base.discord',
  'n8n-nodes-base.slack',
  'n8n-nodes-base.airtable',
  'n8n-nodes-base.postgres',
  'n8n-nodes-base.mysql',
  'n8n-nodes-base.supabase',
  'n8n-nodes-base.redis',
  'n8n-nodes-base.mongodb',
  'n8n-nodes-base.zendesk',
  'n8n-nodes-base.intercom',
  'n8n-nodes-base.typeform',
  'n8n-nodes-base.rssFeedRead',
  'n8n-nodes-base.mailchimp',
  'n8n-nodes-base.sendgrid',
  'n8n-nodes-base.resend',
  'n8n-nodes-base.code',
  'n8n-nodes-base.set',
  'n8n-nodes-base.if',
  'n8n-nodes-base.switch',
  'n8n-nodes-base.merge',
  'n8n-nodes-base.wait',
  'n8n-nodes-base.splitInBatches',
  'n8n-nodes-base.noOp',
  'n8n-nodes-base.stopAndError',
  '@n8n/n8n-nodes-langchain.lmChatAnthropic',
  '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  '@n8n/n8n-nodes-langchain.agent',
  '@n8n/n8n-nodes-langchain.chainLlm',
  '@n8n/n8n-nodes-langchain.outputParserStructured',
])

// ── Keywords that signal browser automation is needed ─────────────────────────

const BROWSER_KEYWORDS: ReadonlyArray<[string, string]> = [
  ['scrape',             'web scraping detected'],
  ['scraping',           'web scraping detected'],
  ['crawl',              'web crawling detected'],
  ['headless',           'headless browser required'],
  ['playwright',         'Playwright browser automation'],
  ['puppeteer',          'Puppeteer browser automation'],
  ['selenium',           'Selenium browser automation'],
  ['2fa',                '2FA flow requires browser'],
  ['two-factor',         'two-factor auth requires browser'],
  ['mfa',                'MFA flow requires browser'],
  ['captcha',            'CAPTCHA solving requires browser'],
  ['login form',         'form-based login requires browser'],
  ['fill form',          'form filling requires browser'],
  ['click button',       'UI interaction requires browser'],
  ['browser automation', 'browser automation explicit'],
  ['instagram dm',       'Instagram DM has no public API'],
  ['instagram direct',   'Instagram Direct has no public API'],
  ['linkedin dm',        'LinkedIn DM automation requires browser'],
  ['linkedin message',   'LinkedIn messaging requires browser'],
  ['linkedin connect',   'LinkedIn connection requests require browser'],
  ['linkedin scrape',    'LinkedIn scraping requires browser'],
  ['connection request', 'LinkedIn-style connection automation'],
  ['twitter scrape',     'Twitter scraping requires elevated API tier'],
  ['facebook scrape',    'Facebook scraping blocked by ToS'],
  ['dom extraction',     'DOM extraction requires headless browser'],
  ['screenshot',         'screenshot capture requires headless browser'],
]

// ── Node-level analysis ───────────────────────────────────────────────────────

function analyzeNode(node: N8nNode): WorkflowStep {
  const base: WorkflowStep = {
    id:        node.id,
    description: node.name,
    nodeType:  node.type,
    canUseN8n: true,
  }

  // Known-safe node types — skip further checks
  if (N8N_NATIVE_TYPES.has(node.type)) return base

  // Scan node name + serialised parameters for browser keywords
  const haystack = `${node.name} ${JSON.stringify(node.parameters ?? {})}`.toLowerCase()
  for (const [kw, reason] of BROWSER_KEYWORDS) {
    if (haystack.includes(kw)) {
      return { ...base, canUseN8n: false, openClawReason: reason }
    }
  }

  // httpRequest to a non-API URL (heuristic: no /api/, /v1/, /v2/, /graphql)
  if (node.type === 'n8n-nodes-base.httpRequest') {
    const url = String(
      node.parameters?.url ?? node.parameters?.URL ?? '',
    ).toLowerCase()
    if (
      url &&
      !url.startsWith('={{') &&  // n8n expression — can't evaluate statically
      !url.startsWith('=')       &&
      !url.includes('/api')      &&
      !url.includes('/v1')       &&
      !url.includes('/v2')       &&
      !url.includes('/v3')       &&
      !url.includes('/graphql')  &&
      !url.includes('.json')
    ) {
      return {
        ...base,
        canUseN8n: false,
        openClawReason: `HTTP request to "${url}" may be scraping a non-API page`,
      }
    }
  }

  return base
}

// ── Workflow-level analysis (from parsed N8nWorkflow JSON) ────────────────────

export function analyzeWorkflow(workflow: N8nWorkflow): GapAnalysis {
  const steps          = workflow.nodes.map(analyzeNode)
  const apiNativeSteps = steps.filter(s => s.canUseN8n)
  const openClawSteps  = steps.filter(s => !s.canUseN8n)
  const hybridRequired = openClawSteps.length > 0

  const routingExplanation = hybridRequired
    ? `${apiNativeSteps.length} step(s) handled natively by n8n. ` +
      `${openClawSteps.length} step(s) escalated to OpenClaw: ` +
      openClawSteps.map(s => `"${s.description}" (${s.openClawReason})`).join('; ') + '.'
    : `All ${steps.length} step(s) can be executed natively by n8n — no OpenClaw needed.`

  return {
    apiNativeSteps,
    openClawSteps,
    hybridRequired,
    routingExplanation,
    summary: hybridRequired
      ? `Hybrid: ${apiNativeSteps.length} n8n + ${openClawSteps.length} OpenClaw`
      : `Pure n8n: ${steps.length} steps`,
  }
}

// ── Description-level analysis (heuristic, no LLM) ───────────────────────────
// Used as a fast pre-check before calling the AI bridge, or as a fallback
// when ANTHROPIC_API_KEY is not set.

export function analyzeDescription(description: string): GapAnalysis {
  const lower       = description.toLowerCase()
  const hits: Array<{ kw: string; reason: string }> = []

  for (const [kw, reason] of BROWSER_KEYWORDS) {
    if (lower.includes(kw)) hits.push({ kw, reason })
  }

  const hybridRequired = hits.length > 0

  const openClawSteps: WorkflowStep[] = hits.map(({ kw, reason }, i) => ({
    id:             `gap-${i}`,
    description:    `Step involving "${kw}"`,
    canUseN8n:      false,
    openClawReason: reason,
  }))

  const apiNativeSteps: WorkflowStep[] = [{
    id:          'api-native',
    description: hybridRequired ? 'Remaining API-native steps (handled by n8n)' : 'All steps (API-native)',
    canUseN8n:   true,
  }]

  const routingExplanation = hybridRequired
    ? `Detected ${hits.length} browser-automation signal(s): ` +
      hits.map(h => `"${h.kw}"`).join(', ') +
      '. These steps will be escalated to OpenClaw; all other steps handled by n8n.'
    : 'No browser-automation signals detected. All steps can be handled natively by n8n.'

  return {
    apiNativeSteps,
    openClawSteps,
    hybridRequired,
    routingExplanation,
    summary: hybridRequired
      ? `Hybrid required — ${hits.length} gap(s) detected`
      : 'Pure n8n — no gaps detected',
  }
}
