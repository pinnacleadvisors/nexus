/**
 * lib/neuro-content/types.ts
 * Type definitions for the Tribe v2 neuro-optimised content engine.
 */

// ── 12 Cognitive engagement principles ───────────────────────────────────────
export interface NeuroPrinciple {
  id:          string
  name:        string
  description: string
  /** How to apply this principle in practice */
  application: string
  /** Signal words/phrases that indicate strong use of this principle */
  signals:     string[]
}

// ── Content scoring ───────────────────────────────────────────────────────────
export interface PrincipleScore {
  principleId:  string
  principleName:string
  score:        number   // 0–100
  rationale:    string
  improvement:  string   // specific suggestion if score < 75
}

export interface ContentScore {
  overallScore:     number             // 0–100, weighted average
  grade:            'A' | 'B' | 'C' | 'D' | 'F'
  principles:       PrincipleScore[]
  topStrengths:     string[]           // top 3 principle names
  topWeaknesses:    string[]           // bottom 3 principle names
  suggestions:      string[]           // 3 concrete rewrite suggestions
  wordCount:        number
}

// ── Format templates ──────────────────────────────────────────────────────────
export type FormatId =
  | 'linkedin-post'
  | 'x-thread'
  | 'instagram-caption'
  | 'long-form-blog'
  | 'cold-email'
  | 'landing-page-hero'
  | 'vsl-script'
  | 'youtube-description'

export interface FormatTemplate {
  id:             FormatId
  name:           string
  description:    string
  icon:           string
  maxCharacters?: number
  structure:      string    // describes the required format structure
  neuroGuidelines:string    // format-specific neuro application notes
  example:        string    // brief structural example
}

// ── Tone profiles ─────────────────────────────────────────────────────────────
export type ToneId = 'authority' | 'peer' | 'challenger' | 'storyteller' | 'data-driven'

export interface ToneProfile {
  id:          ToneId
  name:        string
  tagline:     string
  description: string
  voice:       string     // paragraph describing the voice character
  doList:      string[]   // concrete writing dos
  dontList:    string[]   // concrete writing don'ts
  samplePhrase:string     // example sentence in this tone
}

// ── Content generation request ────────────────────────────────────────────────
export interface GenerateContentRequest {
  topic:           string
  businessContext: string
  format:          FormatId
  tone:            ToneId
  targetScore?:    number     // default 75 — min score before accepting draft
  maxIterations?:  number     // default 3
}

// ── A/B variant ───────────────────────────────────────────────────────────────
export interface ContentVariant {
  id:           string
  triggerFocus: string        // which cognitive trigger is emphasised
  content:      string
  score?:       number
}

export interface VariantsResponse {
  variants: ContentVariant[]
  original: string
}
