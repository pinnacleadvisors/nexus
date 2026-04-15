/**
 * lib/build/research.ts
 * Types and in-memory store for Phase 19b — Research Loop.
 * Falls back to in-memory when Supabase is not configured.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ResearchCategory =
  | 'security'
  | 'performance'
  | 'cost'
  | 'dx'
  | 'deprecation'
  | 'new-tool'

export type ResearchImpact = 'high' | 'medium' | 'low'
export type ResearchWork   = 'S' | 'M' | 'L'

export interface ResearchSuggestion {
  id:            string
  title:         string
  description:   string
  category:      ResearchCategory
  impact:        ResearchImpact
  estimatedWork: ResearchWork
  sourceUrl:     string
  sourceTitle:   string
  boardCardId?:  string | null
}

export interface StackIssue {
  severity:    'critical' | 'high' | 'moderate' | 'low'
  package:     string
  description: string
  via?:        string
  fixAvailable: boolean
}

export interface ResearchDigest {
  id:             string
  runAt:          string       // ISO timestamp
  queriesRun:     string[]
  suggestions:    ResearchSuggestion[]
  stackIssues:    StackIssue[]
  rawSearchCount: number
  durationMs:     number
  error?:         string
}

// ── In-memory store (fallback when Supabase is not configured) ────────────────

const MAX_STORED = 10

const memoryStore: ResearchDigest[] = []

export function storeDigestInMemory(digest: ResearchDigest): void {
  memoryStore.unshift(digest)
  if (memoryStore.length > MAX_STORED) memoryStore.length = MAX_STORED
}

export function getDigestsFromMemory(): ResearchDigest[] {
  return [...memoryStore]
}

// ── Research queries for the Nexus stack ─────────────────────────────────────

export const RESEARCH_QUERIES = [
  'AI agent frameworks new release 2025 2026',
  'Next.js App Router performance breaking changes',
  'LLM cost optimisation techniques prompt caching',
  'TypeScript new version features migration',
  'Vercel platform updates deployment changes',
  'Supabase PostgreSQL new features changelog',
  'Tailwind CSS v4 updates plugins',
  'open source alternatives Clerk authentication',
  'Inngest background jobs serverless updates',
  'Anthropic Claude API new features models',
]

// ── Category meta for UI ──────────────────────────────────────────────────────

export const CATEGORY_META: Record<ResearchCategory, { label: string; color: string; bg: string }> = {
  'security':    { label: 'Security',     color: '#ef4444', bg: '#ef444422' },
  'performance': { label: 'Performance',  color: '#6c63ff', bg: '#6c63ff22' },
  'cost':        { label: 'Cost',         color: '#22c55e', bg: '#22c55e22' },
  'dx':          { label: 'Dev UX',       color: '#f59e0b', bg: '#f59e0b22' },
  'deprecation': { label: 'Deprecation',  color: '#f97316', bg: '#f9731622' },
  'new-tool':    { label: 'New Tool',     color: '#06b6d4', bg: '#06b6d422' },
}

export const IMPACT_META: Record<ResearchImpact, { label: string; color: string }> = {
  high:   { label: 'High',   color: '#ef4444' },
  medium: { label: 'Medium', color: '#f59e0b' },
  low:    { label: 'Low',    color: '#22c55e' },
}

export const WORK_META: Record<ResearchWork, { label: string; color: string }> = {
  S: { label: 'Small',  color: '#22c55e' },
  M: { label: 'Medium', color: '#6c63ff' },
  L: { label: 'Large',  color: '#f59e0b' },
}
