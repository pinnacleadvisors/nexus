// ── Kanban ────────────────────────────────────────────────────────────────────
export type ColumnId = 'backlog' | 'in-progress' | 'review' | 'completed'
export type TaskType = 'manual' | 'automated'

export interface KanbanCard {
  id: string
  title: string
  description: string
  columnId: ColumnId
  assignee?: string
  priority: 'low' | 'medium' | 'high'
  assetUrl?: string
  createdAt: string
  revisionNote?: string
  /** Links card to a Forge project for board filtering */
  projectId?: string
  /** Links card to a Forge milestone; used to dispatch next task on Approve */
  milestoneId?: string
  /** Whether the task is done by an agent/n8n ('automated') or blocks the owner ('manual') */
  taskType?: TaskType
  /** IDs of tasks that must finish before this one can start */
  dependsOn?: string[]
  /** Server-computed: number of not-yet-completed automated tasks waiting on this manual task */
  dependentCount?: number
}

export interface KanbanColumn {
  id: ColumnId
  label: string
  cards: KanbanCard[]
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export interface RevenueDataPoint {
  month: string
  revenue: number
  cost: number
}

export interface KpiCard {
  label: string
  value: string
  delta?: number
  unit?: string
  color?: 'default' | 'green' | 'red' | 'purple'
}

export interface AgentRow {
  id: string
  name: string
  status: 'active' | 'idle' | 'error'
  tasksCompleted: number
  tokensUsed: number
  costUsd: number
  errorCount?: number
  lastActive: string
}

// ── Forge ─────────────────────────────────────────────────────────────────────
export interface ForgeProject {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface Milestone {
  id: string
  title: string
  description: string
  targetDate?: string
  status: 'pending' | 'in-progress' | 'done'
  phase: number
}

export interface GanttTask {
  id: string
  name: string
  startWeek: number
  durationWeeks: number
  phase: number
  status: 'pending' | 'active' | 'done'
  agent?: string
}

// ── Dashboard filters & alerts ────────────────────────────────────────────────
export type DateRange = '7d' | '30d' | '90d' | 'all'

export interface AlertThreshold {
  id: string
  metric: 'daily_cost' | 'error_rate' | 'agent_down'
  threshold: number
  channel: 'email' | 'slack'
  destination: string
  enabled: boolean
}

// ── AI Model configuration ────────────────────────────────────────────────────
export interface ModelOption {
  id: string
  label: string
  note: string
  /** USD per 1M input tokens */
  costInput: number
  /** USD per 1M output tokens */
  costOutput: number
}

export const ADVISOR_MODELS: ModelOption[] = [
  {
    id: 'claude-opus-4-6',
    label: 'Opus 4.6',
    note: 'Best quality · strategic reasoning',
    costInput: 15,
    costOutput: 75,
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    note: 'Fast · balanced cost',
    costInput: 3,
    costOutput: 15,
  },
]

export const EXECUTOR_MODELS: ModelOption[] = [
  {
    id: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    note: 'Balanced · implementation tasks',
    costInput: 3,
    costOutput: 15,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Haiku 4.5',
    note: 'Cheapest · simple tasks',
    costInput: 0.8,
    costOutput: 4,
  },
]

export interface ModelConfig {
  advisorModel: string
  executorModel: string
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  advisorModel: 'claude-opus-4-6',
  executorModel: 'claude-sonnet-4-6',
}

// ── Tools ─────────────────────────────────────────────────────────────────────
export type ToolCategory = 'AI' | 'Analytics' | 'Automation' | 'Communication' | 'DevOps' | 'Finance' | 'Database'
export type ToolStatus = 'available' | 'coming-soon' | 'beta'

export interface Tool {
  id: string
  name: string
  description: string
  icon: string
  category: ToolCategory
  status: ToolStatus
  href?: string
}

// ── OpenClaw / MyClaw ─────────────────────────────────────────────────────────
export interface ClawConfig {
  gatewayUrl: string
  hookToken: string
}

// ── Knowledge Base ────────────────────────────────────────────────────────────
export interface KnowledgeEntry {
  id:        string
  title:     string
  source:    'notion' | 'gdrive' | 'obsidian'
  url:       string
  projectId?: string
  createdAt: string
  type:      'research' | 'milestone' | 'note' | 'asset'
}

// ── OpenClaw Skills ───────────────────────────────────────────────────────────
export type SkillRisk = 'low' | 'medium' | 'high'
export type SkillStatus = 'active' | 'requires_oauth' | 'requires_config' | 'disabled'

export interface ClawSkill {
  id: string
  name: string
  description: string
  /** Permission scope, e.g. 'write:github', 'read:web' */
  scope: string
  risk: SkillRisk
  status: SkillStatus
  /** OAuth provider required (if status === 'requires_oauth') */
  oauthProvider?: string
  category: 'research' | 'code' | 'content' | 'communication' | 'finance' | 'data'
}

// ── OpenClaw Events & Sessions ────────────────────────────────────────────────
export type ClawEventType = 'task_started' | 'task_completed' | 'asset_created' | 'status_update' | 'error'

export interface ClawEvent {
  id: string
  type: ClawEventType
  sessionId: string
  timestamp: string
  payload: {
    title?: string
    description?: string
    assetUrl?: string
    agentName?: string
    projectId?: string
    milestoneId?: string
    error?: string
    [key: string]: unknown
  }
}

export interface ClawSession {
  id: string
  name: string
  status: 'idle' | 'running' | 'error' | 'completed'
  currentTask?: string
  startedAt?: string
  lastEventAt?: string
  phase?: number
}

// ── Agent Capabilities ────────────────────────────────────────────────────────
export type { AgentCapability, CapabilityInput } from '@/lib/agent-capabilities'

// ── Idea (capture → analyse → execute) ───────────────────────────────────────
export type IdeaMode = 'remodel' | 'description'

export interface IdeaStep {
  title: string
  /** true = fully automatable; false = requires manual action */
  automatable: boolean
  /** 'build' during initial setup; 'maintain' once launched */
  phase: 'build' | 'maintain'
  /** Tool(s) recommended to complete this step */
  tools?: string[]
}

export interface IdeaTool {
  name: string
  purpose: string
  url?: string
}

export interface IdeaCard {
  id: string
  createdAt: string
  mode: IdeaMode
  /** Present on 'remodel' cards */
  inspirationUrl?: string
  /** Optional twist the user supplied in Remodel mode */
  twist?: string
  /** Plain-English description (from form or summarised in remodel mode) */
  description: string
  howItMakesMoney: string
  approxMonthlyRevenueUsd: number
  approxSetupCostUsd: number
  approxMonthlyCostUsd: number
  /** 0–100 */
  automationPercent: number
  steps: IdeaStep[]
  tools: IdeaTool[]
  /** User's stated setup budget (from form), may be undefined */
  setupBudgetUsd?: number
  /** Agent's judgement on whether the idea is likely profitable */
  profitableVerdict: 'likely' | 'unlikely' | 'uncertain'
  profitableReasoning: string
}

export interface SavedAutomation {
  id: string
  ideaId?: string
  name: string
  createdAt: string
  /** 'build' = one-shot project stand-up; 'maintain' = recurring run-and-profit */
  workflowType: 'build' | 'maintain'
  /** Raw n8n workflow JSON (string so we can re-download verbatim) */
  workflowJson: string
  /** Setup checklist returned from the generator */
  checklist: string[]
  explanation: string
  /** n8n workflow id when the API import succeeded */
  importedId?: string
  /** Reason the live import failed (undefined when it succeeded) */
  importError?: string
  /** @deprecated kept for backward compatibility with older cards */
  importFailed?: boolean
}

// ── Agent Library (Claude managed agents) ────────────────────────────────────
export interface AgentDefinition {
  id?: string
  slug: string
  name: string
  description: string
  /** Tool names from the portable catalog (Read, Edit, Grep, Glob, Bash, WebFetch, WebSearch, Write) */
  tools: string[]
  /** Model hint — 'opus' | 'sonnet' | 'haiku' or a concrete model id */
  model: string
  /** When true, the spec avoids Claude-only primitives */
  transferable: boolean
  /** Required env var names (never values) */
  envVars: string[]
  /** Body of the markdown spec file */
  systemPrompt: string
  /** Relative path to `.claude/agents/<slug>.md` for round-tripping */
  sourcePath?: string
  version?: number
  createdAt?: string
  updatedAt?: string
}

export interface WorkflowFeedback {
  id: string
  cardId?: string
  agentSlug?: string
  feedback: string
  status: 'open' | 'triaged' | 'applied' | 'rejected'
  artifactUrl?: string
  createdAt: string
  resolvedAt?: string
}

export interface WorkflowChange {
  id: string
  agentSlug?: string
  feedbackId?: string
  targetPath: string
  beforeSpec?: string
  afterSpec?: string
  rationale?: string
  appliedBy: string
  createdAt: string
}

// ── OAuth ─────────────────────────────────────────────────────────────────────
export type OAuthProviderName = 'google' | 'github' | 'slack' | 'notion'

export interface OAuthProvider {
  id: OAuthProviderName
  name: string
  icon: string
  description: string
  scopes: string[]
  color: string
  authUrl: string
  envClientId: string
}

export interface OAuthConnection {
  provider: OAuthProviderName
  connectedAt: string
}

// ── Runs (persistent idea → execution → optimisation state machine) ─────────
export type RunPhase =
  | 'ideate'
  | 'spec'
  | 'decompose'
  | 'build'
  | 'review'
  | 'launch'
  | 'measure'
  | 'optimise'
  | 'done'

export type RunStatus = 'pending' | 'active' | 'blocked' | 'failed' | 'done'

/** Ordered list used for default forward transitions */
export const RUN_PHASE_ORDER: RunPhase[] = [
  'ideate', 'spec', 'decompose', 'build', 'review', 'launch', 'measure', 'optimise', 'done',
]

export interface RunMetrics {
  /** Click-through rate, 0–1, post-launch */
  ctr?: number
  /** Conversion rate, 0–1 */
  conversion?: number
  /** Total token cost in USD, aggregated from token_events rows tagged with run_id */
  tokenCostUsd?: number
  /** How many Board reviews of this run's artefacts were rejected */
  reviewRejects?: number
  /** p50 latency across all dispatches in the run, milliseconds */
  latencyP50Ms?: number
  /** Published external IDs keyed by platform ('youtube', 'tiktok', 'instagram') */
  externalIds?: Record<string, string>
}

export interface Run {
  id: string
  userId: string
  ideaId?: string
  projectId?: string
  phase: RunPhase
  status: RunStatus
  cursor: Record<string, unknown>
  metrics: RunMetrics
  createdAt: string
  updatedAt: string
}

export type RunEventKind =
  | 'phase.advance'
  | 'phase.block'
  | 'phase.fail'
  | 'dispatch.started'
  | 'dispatch.completed'
  | 'graph.retrieved'
  | 'metric.sample'
  | 'review.approved'
  | 'review.rejected'
  | 'publish.posted'
  | 'optimise.proposed'
  | 'optimise.applied'

export interface RunEvent {
  id: string
  runId: string
  kind: RunEventKind
  payload: Record<string, unknown>
  createdAt: string
}

// ── Learning System (Phase 23) ────────────────────────────────────────────────
export type CardKind = 'flip' | 'cloze' | 'multiple-choice' | 'feynman'
export type CardState = 'new' | 'learning' | 'review' | 'relearning' | 'archived'
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy'

export interface Flashcard {
  id: string
  userId: string
  kind: CardKind
  /** Source MOC slug (lesson grouping for the path UI) */
  mocSlug: string | null
  /** Source atom slug (canonical fact) */
  atomSlug: string
  /** SHA of the source atom body at generation time — drives stale detection */
  sourceSha: string
  /** Front of card / cloze sentence with `{{c1::answer}}` placeholders / MC question */
  front: string
  /** Back of card / cloze answer / MC correct option */
  back: string
  /** MC options or alternative blanks */
  options?: string[]
  /** Free-text reference for Feynman-grading */
  referenceContext?: string
  state: CardState
  /** FSRS stability (days) */
  stability: number
  /** FSRS difficulty (1–10) */
  difficulty: number
  /** Computed retrievability at last review (0–1) */
  retrievability: number
  /** ISO timestamp the card is next due */
  dueAt: string
  /** Crown level (0–5) — UI mastery indicator derived from stability buckets */
  crown: number
  /** Number of consecutive correct (≥good) reviews */
  streakCount: number
  /** ISO timestamp of last review (null for new cards) */
  lastReviewedAt: string | null
  /** When the underlying atom changed and the card was reset, why */
  staleReason?: string
  createdAt: string
  updatedAt: string
}

export interface FlashcardReview {
  id: string
  cardId: string
  userId: string
  rating: ReviewRating
  /** User's answer text (cloze input, Feynman explanation) — null for flip */
  answer: string | null
  /** Claude grade for Feynman cards, 0–100 */
  grade?: number
  gradeFeedback?: string
  /** Time spent on this card in milliseconds */
  durationMs: number
  /** XP awarded for this review */
  xp: number
  /** State the card was in BEFORE this review */
  prevState: CardState
  /** State the card transitioned to AFTER FSRS scheduling */
  newState: CardState
  /** New stability after FSRS */
  stabilityAfter: number
  /** New due_at ISO string */
  dueAtAfter: string
  createdAt: string
}

export interface LearningSession {
  id: string
  userId: string
  startedAt: string
  endedAt: string | null
  cardsReviewed: number
  correctCount: number
  xpEarned: number
  /** Average response time in ms */
  avgDurationMs: number
}

export interface DailyStreak {
  userId: string
  /** Current consecutive-day streak */
  currentStreak: number
  /** Longest streak ever */
  longestStreak: number
  /** Number of freeze tokens available (max 2) */
  freezesAvailable: number
  /** ISO date (YYYY-MM-DD) of the last day with at least 1 review */
  lastReviewDate: string | null
  /** XP earned today (resets at midnight UTC) */
  xpToday: number
  /** Cumulative XP all-time */
  xpTotal: number
  updatedAt: string
}

export interface LearnPathLesson {
  /** Atom slug — primary key for the lesson */
  atomSlug: string
  title: string
  /** Crown level 0–5 (max across all derived cards for this atom) */
  crown: number
  /** Number of derived cards in any non-archived state */
  cardCount: number
  /** Earliest dueAt across the lesson's cards (null if all reviewed) */
  nextDueAt: string | null
  /** True if any card has staleReason set */
  isStale: boolean
}

export interface LearnPathUnit {
  /** MOC slug — section header on the path */
  mocSlug: string
  title: string
  lessons: LearnPathLesson[]
  /** Aggregate progress 0–1 (sum(crown) / (lessons*5)) */
  progress: number
}

export interface LearnStats {
  streak: DailyStreak
  /** Last 90 calendar days, oldest first; each entry: { date, xp, cardsReviewed } */
  heatmap: Array<{ date: string; xp: number; cardsReviewed: number }>
  /** Per-MOC retention rate over the last 30 days */
  retentionByMoc: Array<{ mocSlug: string; title: string; retention: number; sampleSize: number }>
  /** Distribution of crowns across all active cards */
  masteryHistogram: { crown0: number; crown1: number; crown2: number; crown3: number; crown4: number; crown5: number }
  /** Top 5 lowest-retrievability atoms */
  weakestAtoms: Array<{ atomSlug: string; title: string; retrievability: number }>
  /** Cards flagged as stale because their atom changed */
  staleCount: number
  /** Daily XP goal (env-tuned) */
  dailyGoalXp: number
}
