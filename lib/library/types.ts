/**
 * lib/library/types.ts
 * Type definitions for the Phase 15 reusable building-block library.
 */

export type LibraryType = 'code' | 'agent' | 'prompt' | 'skill'

export type CodeLanguage = 'typescript' | 'javascript' | 'python' | 'sql' | 'bash' | 'json' | 'yaml'
export type PromptFormat  = 'instruction' | 'few-shot' | 'chain-of-thought' | 'structured'
export type RiskLevel     = 'low' | 'medium' | 'high'

// ── Code snippet ──────────────────────────────────────────────────────────────
export interface CodeSnippet {
  id:                string
  user_id:           string
  title:             string
  description:       string
  language:          CodeLanguage
  purpose:           string
  code:              string
  tags:              string[]
  dependencies:      string[]
  usage_count:       number
  avg_quality_score: number
  auto_extracted:    boolean
  source_agent_run?: string
  created_at:        string
  updated_at:        string
}

// ── Agent template ────────────────────────────────────────────────────────────
export interface AgentTemplate {
  id:                string
  user_id:           string
  name:              string
  role:              string
  system_prompt:     string
  constraints:       string[]
  output_format:     string
  example_output:    string
  model:             string
  tags:              string[]
  version:           number
  usage_count:       number
  avg_quality_score: number
  auto_extracted:    boolean
  created_at:        string
  updated_at:        string
}

// ── Prompt template ───────────────────────────────────────────────────────────
export interface PromptTemplate {
  id:                string
  user_id:           string
  name:              string
  description:       string
  template:          string
  variables:         string[]
  format:            PromptFormat
  neuro_score:       number       // 0–100 (from Tribe v2)
  tags:              string[]
  usage_count:       number
  avg_quality_score: number
  created_at:        string
  updated_at:        string
}

// ── Skill definition ──────────────────────────────────────────────────────────
export interface SkillDefinition {
  id:                string
  user_id:           string
  name:              string
  description:       string
  mcp_tool_name:     string
  input_schema:      Record<string, unknown>
  output_schema:     Record<string, unknown>
  requires_openclaw: boolean
  risk_level:        RiskLevel
  tags:              string[]
  usage_count:       number
  avg_quality_score: number
  created_at:        string
  updated_at:        string
}

// ── Union type for all library entries ────────────────────────────────────────
export type LibraryEntry = CodeSnippet | AgentTemplate | PromptTemplate | SkillDefinition

// ── Search result ─────────────────────────────────────────────────────────────
export interface LibrarySearchResult<T extends LibraryEntry = LibraryEntry> {
  entry:       T
  score:       number     // 0–1 relevance
  matchedOn:   string[]   // which fields matched
}

// ── Create payload (omit generated fields) ───────────────────────────────────
export type CreateCodeSnippet    = Omit<CodeSnippet,    'id' | 'user_id' | 'usage_count' | 'avg_quality_score' | 'auto_extracted' | 'created_at' | 'updated_at'>
export type CreateAgentTemplate  = Omit<AgentTemplate,  'id' | 'user_id' | 'usage_count' | 'avg_quality_score' | 'auto_extracted' | 'created_at' | 'updated_at'>
export type CreatePromptTemplate = Omit<PromptTemplate, 'id' | 'user_id' | 'usage_count' | 'avg_quality_score' | 'created_at' | 'updated_at'>
export type CreateSkillDef       = Omit<SkillDefinition,'id' | 'user_id' | 'usage_count' | 'avg_quality_score' | 'created_at' | 'updated_at'>

// ── Visual config ─────────────────────────────────────────────────────────────
export const LANGUAGE_COLORS: Record<CodeLanguage, { bg: string; text: string }> = {
  typescript:  { bg: '#1a1a2e', text: '#818cf8' },
  javascript:  { bg: '#2e2818', text: '#fbbf24' },
  python:      { bg: '#1a2818', text: '#4ade80' },
  sql:         { bg: '#1a2e2e', text: '#22d3ee' },
  bash:        { bg: '#2e2818', text: '#f97316' },
  json:        { bg: '#2e1a2e', text: '#c084fc' },
  yaml:        { bg: '#2e2818', text: '#fb923c' },
}

export const RISK_COLORS: Record<RiskLevel, { bg: string; text: string }> = {
  low:    { bg: '#1a2e1a', text: '#4ade80' },
  medium: { bg: '#2e2818', text: '#fbbf24' },
  high:   { bg: '#2e1a1a', text: '#f87171' },
}

export const FORMAT_LABELS: Record<PromptFormat, string> = {
  'instruction':       'Instruction',
  'few-shot':          'Few-shot',
  'chain-of-thought':  'Chain-of-thought',
  'structured':        'Structured',
}

/** Estimated tokens saved per library hit (vs cold generation) */
export const TOKENS_PER_HIT: Record<LibraryType, number> = {
  code:   350,
  agent:  800,
  prompt: 250,
  skill:  150,
}
