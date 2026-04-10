import type {
  RevenueDataPoint,
  AgentRow,
  KanbanColumn,
  KpiCard,
  Tool,
} from './types'

// ── Revenue chart (12 months) ─────────────────────────────────────────────────
export const REVENUE_DATA: RevenueDataPoint[] = [
  { month: 'Jan', revenue: 0, cost: 1200 },
  { month: 'Feb', revenue: 800, cost: 1350 },
  { month: 'Mar', revenue: 2400, cost: 1500 },
  { month: 'Apr', revenue: 4100, cost: 1800 },
  { month: 'May', revenue: 6200, cost: 2100 },
  { month: 'Jun', revenue: 9500, cost: 2400 },
  { month: 'Jul', revenue: 11200, cost: 2700 },
  { month: 'Aug', revenue: 14800, cost: 3100 },
  { month: 'Sep', revenue: 17300, cost: 3400 },
  { month: 'Oct', revenue: 21000, cost: 3800 },
  { month: 'Nov', revenue: 25500, cost: 4200 },
  { month: 'Dec', revenue: 31200, cost: 4600 },
]

// ── KPI cards ─────────────────────────────────────────────────────────────────
export const KPI_DATA: KpiCard[] = [
  { label: 'Total Revenue', value: '$31,200', delta: 22.4, color: 'green' },
  { label: 'Total Cost', value: '$4,600', delta: 9.5, color: 'red' },
  { label: 'Net Profit', value: '$26,600', delta: 24.1, color: 'purple' },
  { label: 'Active Agents', value: '7', delta: 2, color: 'default' },
  { label: 'Tokens Used', value: '4.2M', delta: 18.3, color: 'default' },
  { label: 'Tasks Completed', value: '143', delta: 31, color: 'default' },
]

// ── Agent rows ────────────────────────────────────────────────────────────────
export const AGENT_ROWS: AgentRow[] = [
  {
    id: 'a1',
    name: 'ResearchBot-Alpha',
    status: 'active',
    tasksCompleted: 38,
    tokensUsed: 920000,
    costUsd: 13.8,
    lastActive: new Date(Date.now() - 1000 * 60 * 3).toISOString(),
  },
  {
    id: 'a2',
    name: 'ContentWriter-Beta',
    status: 'active',
    tasksCompleted: 27,
    tokensUsed: 1100000,
    costUsd: 16.5,
    lastActive: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
  },
  {
    id: 'a3',
    name: 'MarketAnalyst-Gamma',
    status: 'idle',
    tasksCompleted: 19,
    tokensUsed: 540000,
    costUsd: 8.1,
    lastActive: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
  },
  {
    id: 'a4',
    name: 'DevOps-Delta',
    status: 'active',
    tokensUsed: 780000,
    tasksCompleted: 31,
    costUsd: 11.7,
    lastActive: new Date(Date.now() - 1000 * 60 * 1).toISOString(),
  },
  {
    id: 'a5',
    name: 'SEO-Epsilon',
    status: 'error',
    tasksCompleted: 12,
    tokensUsed: 310000,
    costUsd: 4.65,
    lastActive: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
  },
  {
    id: 'a6',
    name: 'SalesOutreach-Zeta',
    status: 'active',
    tasksCompleted: 16,
    tokensUsed: 550000,
    costUsd: 8.25,
    lastActive: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
  },
]

// ── Kanban columns ────────────────────────────────────────────────────────────
export const INITIAL_COLUMNS: KanbanColumn[] = [
  {
    id: 'backlog',
    label: 'Backlog',
    cards: [
      {
        id: 'k1',
        title: 'Competitor analysis report',
        description: 'Deep-dive into top 5 competitors — pricing, positioning, weaknesses.',
        columnId: 'backlog',
        assignee: 'MarketAnalyst-Gamma',
        priority: 'medium',
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
      },
      {
        id: 'k2',
        title: 'Brand identity guidelines',
        description: 'Logo variants, color palette, typography system, usage rules.',
        columnId: 'backlog',
        assignee: 'ContentWriter-Beta',
        priority: 'low',
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString(),
      },
    ],
  },
  {
    id: 'in-progress',
    label: 'In Progress',
    cards: [
      {
        id: 'k3',
        title: 'Landing page copy & SEO',
        description: 'Write all landing page sections optimised for target keywords.',
        columnId: 'in-progress',
        assignee: 'SEO-Epsilon',
        priority: 'high',
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
      },
      {
        id: 'k4',
        title: 'Infrastructure setup (Vercel + Supabase)',
        description: 'Configure prod environment, env vars via Doppler, CI/CD pipeline.',
        columnId: 'in-progress',
        assignee: 'DevOps-Delta',
        priority: 'high',
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
      },
      {
        id: 'k5',
        title: 'Email outreach sequence (cold)',
        description: '5-step drip campaign targeting early adopters.',
        columnId: 'in-progress',
        assignee: 'SalesOutreach-Zeta',
        priority: 'medium',
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
      },
    ],
  },
  {
    id: 'review',
    label: 'Review',
    cards: [
      {
        id: 'k6',
        title: 'Market research PDF',
        description: '42-page market sizing and opportunity analysis.',
        columnId: 'review',
        assignee: 'ResearchBot-Alpha',
        priority: 'high',
        assetUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/pdf/pdf-sample.pdf',
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 1).toISOString(),
      },
      {
        id: 'k7',
        title: 'Social media content calendar',
        description: '30 days of posts across LinkedIn, X, and Instagram.',
        columnId: 'review',
        assignee: 'ContentWriter-Beta',
        priority: 'medium',
        assetUrl: 'https://docs.google.com/spreadsheets/d/example',
        createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
      },
    ],
  },
  {
    id: 'completed',
    label: 'Completed',
    cards: [
      {
        id: 'k8',
        title: 'Business model canvas',
        description: 'Full BMC covering value props, channels, revenue streams.',
        columnId: 'completed',
        assignee: 'ResearchBot-Alpha',
        priority: 'high',
        assetUrl: 'https://miro.com/app/board/example',
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
      },
    ],
  },
]

// ── Tools directory ───────────────────────────────────────────────────────────
export const TOOLS: Tool[] = [
  // AI
  {
    id: 't1',
    name: 'Claude (Anthropic)',
    description: 'Primary intelligence layer — reasoning, writing, and agent orchestration.',
    icon: 'Bot',
    category: 'AI',
    status: 'available',
    href: 'https://console.anthropic.com',
  },
  {
    id: 't2',
    name: 'OpenAI GPT-4o',
    description: 'Fallback LLM and vision tasks.',
    icon: 'Sparkles',
    category: 'AI',
    status: 'available',
    href: 'https://platform.openai.com',
  },
  {
    id: 't3',
    name: 'LangGraph',
    description: 'Stateful multi-agent workflow orchestration with parallel execution.',
    icon: 'Network',
    category: 'AI',
    status: 'beta',
    href: 'https://langchain-ai.github.io/langgraphjs',
  },
  // Database
  {
    id: 't4',
    name: 'Supabase',
    description: 'Postgres database with realtime subscriptions and file storage.',
    icon: 'Database',
    category: 'Database',
    status: 'available',
    href: 'https://supabase.com',
  },
  // DevOps
  {
    id: 't5',
    name: 'GitHub',
    description: 'All code versioned here. Agents commit and open PRs automatically.',
    icon: 'GitBranch',
    category: 'DevOps',
    status: 'available',
    href: 'https://github.com',
  },
  {
    id: 't6',
    name: 'Vercel',
    description: 'Zero-config hosting with preview deployments on every push.',
    icon: 'Rocket',
    category: 'DevOps',
    status: 'available',
    href: 'https://vercel.com',
  },
  {
    id: 't7',
    name: 'Doppler',
    description: 'Centralised secrets management — API keys, credentials, env vars.',
    icon: 'KeyRound',
    category: 'DevOps',
    status: 'available',
    href: 'https://doppler.com',
  },
  // Analytics
  {
    id: 't8',
    name: 'PostHog',
    description: 'Product analytics, session replay, and feature flags.',
    icon: 'BarChart2',
    category: 'Analytics',
    status: 'available',
    href: 'https://posthog.com',
  },
  {
    id: 't9',
    name: 'Sentry',
    description: 'Error tracking and performance monitoring across agents and web.',
    icon: 'ShieldAlert',
    category: 'Analytics',
    status: 'coming-soon',
  },
  // Finance
  {
    id: 't10',
    name: 'Stripe',
    description: 'Payment processing and subscription billing for revenue tracking.',
    icon: 'CreditCard',
    category: 'Finance',
    status: 'available',
    href: 'https://stripe.com',
  },
  // Communication
  {
    id: 't11',
    name: 'Resend',
    description: 'Transactional email — agent alerts, approvals, and reports.',
    icon: 'Mail',
    category: 'Communication',
    status: 'available',
    href: 'https://resend.com',
  },
  {
    id: 't12',
    name: 'Slack',
    description: 'Agent update notifications piped directly to your workspace.',
    icon: 'MessageSquare',
    category: 'Communication',
    status: 'coming-soon',
  },
  // Automation
  {
    id: 't13',
    name: 'OpenClaw (MyClaw)',
    description: 'Cloud-hosted AI agent that autonomously executes business tasks via messaging channels. Connect your MyClaw.ai instance to dispatch milestones for hands-free implementation.',
    icon: 'Cpu',
    category: 'Automation',
    status: 'available',
    href: '/tools/claw',
  },
]
