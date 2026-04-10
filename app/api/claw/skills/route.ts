/**
 * GET /api/claw/skills
 *
 * Returns the list of OpenClaw skills with permission scopes.
 * Tries to fetch from the gateway first; falls back to the built-in registry.
 */
import { NextRequest, NextResponse } from 'next/server'
import type { ClawSkill } from '@/lib/types'

export const runtime = 'nodejs'

function resolveConfig(req: NextRequest): { gatewayUrl: string; token: string } | null {
  const envUrl   = process.env.OPENCLAW_GATEWAY_URL
  const envToken = process.env.OPENCLAW_BEARER_TOKEN
  if (envUrl && envToken) return { gatewayUrl: envUrl, token: envToken }

  const cookie = req.cookies.get('nexus_claw_cfg')
  if (!cookie) return null
  try {
    const { gatewayUrl, hookToken } = JSON.parse(cookie.value) as Record<string, string>
    if (gatewayUrl && hookToken) return { gatewayUrl, token: hookToken }
  } catch { /* fall through */ }
  return null
}

// ── Built-in skill registry ───────────────────────────────────────────────────
export const DEFAULT_SKILLS: ClawSkill[] = [
  {
    id:          'web-search',
    name:        'Web Search',
    description: 'Search the web for current information, competitor analysis, market data.',
    scope:       'read:web',
    risk:        'low',
    status:      'active',
    category:    'research',
  },
  {
    id:          'code-gen',
    name:        'Code Generation (Claude Code CLI)',
    description: 'Generate and write code files, run tests, and create PRs via Claude Code CLI.',
    scope:       'write:code',
    risk:        'medium',
    status:      'active',
    category:    'code',
  },
  {
    id:          'github-pr',
    name:        'GitHub Pull Request',
    description: 'Create branches, commit code, and open pull requests on GitHub repositories.',
    scope:       'write:github',
    risk:        'medium',
    status:      'requires_oauth',
    oauthProvider: 'github',
    category:    'code',
  },
  {
    id:          'notion-write',
    name:        'Notion Write',
    description: 'Create and update Notion pages, databases, and append research notes.',
    scope:       'write:notion',
    risk:        'low',
    status:      'requires_oauth',
    oauthProvider: 'notion',
    category:    'content',
  },
  {
    id:          'google-docs',
    name:        'Google Docs',
    description: 'Create and edit Google Docs for business plans, reports, and content.',
    scope:       'write:drive',
    risk:        'low',
    status:      'requires_oauth',
    oauthProvider: 'google',
    category:    'content',
  },
  {
    id:          'google-sheets',
    name:        'Google Sheets',
    description: 'Create financial models, revenue projections, and data spreadsheets.',
    scope:       'write:drive',
    risk:        'low',
    status:      'requires_oauth',
    oauthProvider: 'google',
    category:    'finance',
  },
  {
    id:          'slack-post',
    name:        'Slack Post',
    description: 'Post messages and updates to Slack channels on task completion.',
    scope:       'write:slack',
    risk:        'low',
    status:      'requires_oauth',
    oauthProvider: 'slack',
    category:    'communication',
  },
  {
    id:          'email-send',
    name:        'Email Outreach (Resend)',
    description: 'Send transactional emails, cold outreach sequences, and alert emails via Resend.',
    scope:       'write:email',
    risk:        'high',
    status:      'requires_config',
    category:    'communication',
  },
  {
    id:          'stripe-read',
    name:        'Stripe Analytics',
    description: 'Read revenue, subscription, and payment data from Stripe for reporting.',
    scope:       'read:stripe',
    risk:        'low',
    status:      'requires_config',
    category:    'finance',
  },
  {
    id:          'pdf-export',
    name:        'PDF Generation',
    description: 'Generate business plans, reports, and proposals as PDF documents.',
    scope:       'write:local',
    risk:        'low',
    status:      'active',
    category:    'content',
  },
  {
    id:          'seo-audit',
    name:        'SEO Analysis',
    description: 'Keyword research, on-page optimisation audits, and competitor SEO analysis.',
    scope:       'read:web',
    risk:        'low',
    status:      'active',
    category:    'research',
  },
  {
    id:          'social-draft',
    name:        'Social Media Drafts',
    description: 'Generate post drafts for LinkedIn, X (Twitter), and Instagram.',
    scope:       'write:content',
    risk:        'low',
    status:      'active',
    category:    'content',
  },
]

export async function GET(req: NextRequest) {
  const cfg = resolveConfig(req)

  // Try fetching live skills from the gateway
  if (cfg) {
    try {
      const res = await fetch(`${cfg.gatewayUrl.replace(/\/$/, '')}/api/skills`, {
        headers: { Authorization: `Bearer ${cfg.token}` },
        signal:  AbortSignal.timeout(6_000),
      })
      if (res.ok) {
        const data = await res.json() as { skills?: ClawSkill[] } | ClawSkill[]
        const skills: ClawSkill[] = Array.isArray(data) ? data : (data.skills ?? DEFAULT_SKILLS)
        return NextResponse.json({ skills, source: 'gateway' })
      }
    } catch { /* gateway unreachable — fall through to built-in */ }
  }

  return NextResponse.json({ skills: DEFAULT_SKILLS, source: 'builtin' })
}
