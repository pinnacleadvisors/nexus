/**
 * lib/n8n/tools-db.ts
 * Curated database of 40+ SaaS tools with n8n compatibility data.
 * Used by GET /api/tools/research and the Consultant agent.
 */

import type { ToolEntry } from './types'

export const TOOLS_DATABASE: ToolEntry[] = [
  // ── CRM & Sales ──────────────────────────────────────────────────────────
  {
    name: 'HubSpot',
    category: 'CRM',
    n8nNodes: ['n8n-nodes-base.hubspot', 'n8n-nodes-base.hubspotTrigger'],
    complexity: 'low',
    setupMinutes: 15,
    monthlyCost: '$0–$90 (free tier available)',
    requiresOpenClaw: false,
    description: 'CRM, marketing automation, and sales pipeline. Native n8n integration.',
  },
  {
    name: 'Salesforce',
    category: 'CRM',
    n8nNodes: ['n8n-nodes-base.salesforce'],
    complexity: 'medium',
    setupMinutes: 30,
    monthlyCost: '$25+/user',
    requiresOpenClaw: false,
    description: 'Enterprise CRM with full n8n CRUD support for leads, contacts, opportunities.',
  },
  {
    name: 'Pipedrive',
    category: 'CRM',
    n8nNodes: ['n8n-nodes-base.pipedrive', 'n8n-nodes-base.pipedriveTrigger'],
    complexity: 'low',
    setupMinutes: 15,
    monthlyCost: '$14+/user',
    requiresOpenClaw: false,
    description: 'Sales CRM focused on pipeline management. Excellent n8n trigger support.',
  },
  // ── Email & Communication ─────────────────────────────────────────────────
  {
    name: 'Resend',
    category: 'Email',
    n8nNodes: ['n8n-nodes-base.httpRequest'],
    complexity: 'low',
    setupMinutes: 10,
    monthlyCost: '$0–$20 (3k free emails/mo)',
    requiresOpenClaw: false,
    description: 'Developer email API. No native n8n node — use HTTP Request with API key.',
  },
  {
    name: 'Mailchimp',
    category: 'Email',
    n8nNodes: ['n8n-nodes-base.mailchimp', 'n8n-nodes-base.mailchimpTrigger'],
    complexity: 'low',
    setupMinutes: 15,
    monthlyCost: '$0–$150',
    requiresOpenClaw: false,
    description: 'Email marketing with audience segmentation. Native n8n list/campaign support.',
  },
  {
    name: 'Slack',
    category: 'Communication',
    n8nNodes: ['n8n-nodes-base.slack', 'n8n-nodes-base.slackTrigger'],
    complexity: 'low',
    setupMinutes: 10,
    monthlyCost: '$0–$12/user',
    requiresOpenClaw: false,
    description: 'Team messaging. Use for agent completion alerts, approval notifications.',
  },
  {
    name: 'Gmail',
    category: 'Email',
    n8nNodes: ['n8n-nodes-base.gmail', 'n8n-nodes-base.gmailTrigger'],
    complexity: 'low',
    setupMinutes: 15,
    monthlyCost: '$0–$12/user (Google Workspace)',
    requiresOpenClaw: false,
    description: 'Email send/receive with label filtering. Trigger on new emails in specific labels.',
  },
  // ── Project Management ────────────────────────────────────────────────────
  {
    name: 'Notion',
    category: 'Knowledge Base',
    n8nNodes: ['n8n-nodes-base.notion', 'n8n-nodes-base.notionTrigger'],
    complexity: 'low',
    setupMinutes: 20,
    monthlyCost: '$0–$16/user',
    requiresOpenClaw: false,
    description: 'Create/update Notion pages and databases. Already integrated in Nexus (Phase 6).',
  },
  {
    name: 'Linear',
    category: 'Project Management',
    n8nNodes: ['n8n-nodes-base.linear', 'n8n-nodes-base.linearTrigger'],
    complexity: 'low',
    setupMinutes: 15,
    monthlyCost: '$0–$12/user',
    requiresOpenClaw: false,
    description: 'Issue tracking and project management. Trigger on issue status changes.',
  },
  {
    name: 'Jira',
    category: 'Project Management',
    n8nNodes: ['n8n-nodes-base.jira'],
    complexity: 'medium',
    setupMinutes: 25,
    monthlyCost: '$0–$15/user',
    requiresOpenClaw: false,
    description: 'Enterprise issue tracking. Create/update issues, transitions, sprints.',
  },
  // ── Payments & Finance ────────────────────────────────────────────────────
  {
    name: 'Stripe',
    category: 'Payments',
    n8nNodes: ['n8n-nodes-base.stripe', 'n8n-nodes-base.stripeTrigger'],
    complexity: 'low',
    setupMinutes: 20,
    monthlyCost: '2.9% + 30¢ per transaction',
    requiresOpenClaw: false,
    description: 'Payment processing. Trigger on new charges, subscriptions, refunds.',
  },
  {
    name: 'QuickBooks',
    category: 'Accounting',
    n8nNodes: ['n8n-nodes-base.quickbooks'],
    complexity: 'medium',
    setupMinutes: 30,
    monthlyCost: '$30–$200',
    requiresOpenClaw: false,
    description: 'Accounting and invoicing. Create invoices, sync revenue data.',
  },
  {
    name: 'Xero',
    category: 'Accounting',
    n8nNodes: ['n8n-nodes-base.xero'],
    complexity: 'medium',
    setupMinutes: 25,
    monthlyCost: '$13–$70',
    requiresOpenClaw: false,
    description: 'Cloud accounting. Invoice creation, expense tracking, bank reconciliation.',
  },
  // ── Social Media ──────────────────────────────────────────────────────────
  {
    name: 'Buffer',
    category: 'Social Media',
    n8nNodes: ['n8n-nodes-base.httpRequest'],
    complexity: 'low',
    setupMinutes: 15,
    monthlyCost: '$0–$120',
    requiresOpenClaw: false,
    description: 'Social scheduling. Use HTTP Request node with Buffer API.',
  },
  {
    name: 'LinkedIn',
    category: 'Social Media',
    n8nNodes: ['n8n-nodes-base.linkedIn'],
    complexity: 'medium',
    setupMinutes: 20,
    monthlyCost: '$0 (personal) / varies (ads)',
    requiresOpenClaw: false,
    description: 'Post to LinkedIn pages and profiles. Engagement monitoring requires OpenClaw.',
  },
  {
    name: 'Twitter / X',
    category: 'Social Media',
    n8nNodes: ['n8n-nodes-base.twitter'],
    complexity: 'medium',
    setupMinutes: 20,
    monthlyCost: '$0–$100 (API tier)',
    requiresOpenClaw: false,
    description: 'Post tweets and threads. API tier required for automated posting.',
  },
  // ── Customer Support ──────────────────────────────────────────────────────
  {
    name: 'Intercom',
    category: 'Support',
    n8nNodes: ['n8n-nodes-base.intercom'],
    complexity: 'medium',
    setupMinutes: 25,
    monthlyCost: '$74+',
    requiresOpenClaw: false,
    description: 'Customer messaging and support. Create conversations, send messages.',
  },
  {
    name: 'Zendesk',
    category: 'Support',
    n8nNodes: ['n8n-nodes-base.zendesk', 'n8n-nodes-base.zendeskTrigger'],
    complexity: 'medium',
    setupMinutes: 25,
    monthlyCost: '$55+/agent',
    requiresOpenClaw: false,
    description: 'Helpdesk platform. Trigger on new tickets, auto-assign, auto-respond.',
  },
  // ── Analytics ─────────────────────────────────────────────────────────────
  {
    name: 'PostHog',
    category: 'Analytics',
    n8nNodes: ['n8n-nodes-base.httpRequest'],
    complexity: 'low',
    setupMinutes: 15,
    monthlyCost: '$0–variable',
    requiresOpenClaw: false,
    description: 'Product analytics. Capture events via HTTP Request. No native node.',
  },
  {
    name: 'Google Analytics',
    category: 'Analytics',
    n8nNodes: ['n8n-nodes-base.googleAnalytics'],
    complexity: 'medium',
    setupMinutes: 20,
    monthlyCost: '$0 (GA4 free)',
    requiresOpenClaw: false,
    description: 'Web analytics. Pull report data, session counts, conversion metrics.',
  },
  // ── Forms & Data Capture ──────────────────────────────────────────────────
  {
    name: 'Typeform',
    category: 'Forms',
    n8nNodes: ['n8n-nodes-base.typeform', 'n8n-nodes-base.typeformTrigger'],
    complexity: 'low',
    setupMinutes: 10,
    monthlyCost: '$0–$83',
    requiresOpenClaw: false,
    description: 'Trigger on new form submissions. Route leads to CRM, email, board cards.',
  },
  {
    name: 'Google Forms',
    category: 'Forms',
    n8nNodes: ['n8n-nodes-base.googleSheets', 'n8n-nodes-base.googleSheetsTrigger'],
    complexity: 'low',
    setupMinutes: 15,
    monthlyCost: '$0',
    requiresOpenClaw: false,
    description: 'Trigger via Google Sheets (linked sheet). Free and reliable.',
  },
  // ── Storage & Files ───────────────────────────────────────────────────────
  {
    name: 'Google Drive',
    category: 'Storage',
    n8nNodes: ['n8n-nodes-base.googleDrive', 'n8n-nodes-base.googleDriveTrigger'],
    complexity: 'low',
    setupMinutes: 15,
    monthlyCost: '$0–$12/user',
    requiresOpenClaw: false,
    description: 'File upload/download/watch. Already integrated in Nexus (Phase 7).',
  },
  {
    name: 'Dropbox',
    category: 'Storage',
    n8nNodes: ['n8n-nodes-base.dropbox'],
    complexity: 'low',
    setupMinutes: 15,
    monthlyCost: '$0–$20/user',
    requiresOpenClaw: false,
    description: 'File storage and sharing. Upload agent outputs, sync assets.',
  },
  // ── Dev & Infra ───────────────────────────────────────────────────────────
  {
    name: 'GitHub',
    category: 'DevOps',
    n8nNodes: ['n8n-nodes-base.github', 'n8n-nodes-base.githubTrigger'],
    complexity: 'low',
    setupMinutes: 15,
    monthlyCost: '$0–$21/user',
    requiresOpenClaw: false,
    description: 'Trigger on PRs, issues, pushes. Create issues from agent outputs.',
  },
  {
    name: 'Vercel',
    category: 'DevOps',
    n8nNodes: ['n8n-nodes-base.httpRequest'],
    complexity: 'medium',
    setupMinutes: 20,
    monthlyCost: '$0–$20+',
    requiresOpenClaw: false,
    description: 'Deploy previews, trigger deployments via Vercel REST API.',
  },
  {
    name: 'Supabase',
    category: 'Database',
    n8nNodes: ['n8n-nodes-base.supabase', 'n8n-nodes-base.supabaseTrigger'],
    complexity: 'low',
    setupMinutes: 15,
    monthlyCost: '$0–$25',
    requiresOpenClaw: false,
    description: 'Read/write Supabase tables. Already used in Nexus — n8n can listen to row changes.',
  },
  // ── AI ─────────────────────────────────────────────────────────────────────
  {
    name: 'OpenAI',
    category: 'AI',
    n8nNodes: ['@n8n/n8n-nodes-langchain.openAi', '@n8n/n8n-nodes-langchain.lmChatOpenAi'],
    complexity: 'low',
    setupMinutes: 10,
    monthlyCost: 'Pay per token',
    requiresOpenClaw: false,
    description: 'GPT-4o, DALL-E, embeddings. Native LangChain node in n8n.',
  },
  {
    name: 'Anthropic (Claude)',
    category: 'AI',
    n8nNodes: ['@n8n/n8n-nodes-langchain.lmChatAnthropic'],
    complexity: 'low',
    setupMinutes: 10,
    monthlyCost: 'Pay per token',
    requiresOpenClaw: false,
    description: 'Claude Sonnet/Opus via n8n LangChain node. AI steps in automation flows.',
  },
  // ── Requires OpenClaw ────────────────────────────────────────────────────
  {
    name: 'LinkedIn Scraping',
    category: 'Lead Generation',
    n8nNodes: [],
    complexity: 'high',
    setupMinutes: 60,
    monthlyCost: 'OpenClaw subscription',
    requiresOpenClaw: true,
    description: 'Scraping profiles, connection requests, message automation. Requires browser automation.',
  },
  {
    name: 'Instagram DM Automation',
    category: 'Social Media',
    n8nNodes: [],
    complexity: 'high',
    setupMinutes: 60,
    monthlyCost: 'OpenClaw subscription',
    requiresOpenClaw: true,
    description: 'DM sending and reply automation. No public API — requires browser control.',
  },
  {
    name: 'Web Scraping',
    category: 'Research',
    n8nNodes: ['n8n-nodes-base.httpRequest'],
    complexity: 'high',
    setupMinutes: 45,
    monthlyCost: '$0–$50 (proxy costs)',
    requiresOpenClaw: true,
    description: 'JS-rendered pages, login-gated content, or 2FA sites require OpenClaw.',
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
export function searchTools(query: string): ToolEntry[] {
  const q = query.toLowerCase()
  return TOOLS_DATABASE.filter(t =>
    t.name.toLowerCase().includes(q) ||
    t.category.toLowerCase().includes(q) ||
    t.description.toLowerCase().includes(q)
  )
}

export function getToolsByCategory(category: string): ToolEntry[] {
  return TOOLS_DATABASE.filter(t => t.category.toLowerCase() === category.toLowerCase())
}

export function getN8nCompatibleTools(): ToolEntry[] {
  return TOOLS_DATABASE.filter(t => t.n8nNodes.length > 0)
}

export const TOOL_CATEGORIES = [
  ...new Set(TOOLS_DATABASE.map(t => t.category))
].sort()
