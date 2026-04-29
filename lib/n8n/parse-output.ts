/**
 * Parser for the AI-generated text returned by /api/n8n/generate.
 *
 * The system prompt instructs Claude to emit:
 *   <workflow JSON>
 *   ---CHECKLIST---
 *   <numbered list>
 *   ---EXPLANATION---
 *   <free-form 2-3 sentences>
 *
 * This module parses that into structured fields. When the JSON is unparseable
 * the caller falls back to `buildFallbackWorkflow` so the user always gets a
 * usable scaffold.
 */
import type { N8nWorkflow } from './types'

export interface ParsedOutput {
  workflow:    N8nWorkflow | null
  checklist:   string[]
  explanation: string
}

export function parseGeneratedOutput(text: string): ParsedOutput {
  const checklistSep   = text.indexOf('---CHECKLIST---')
  const explanationSep = text.indexOf('---EXPLANATION---')

  const jsonPart = checklistSep > 0 ? text.slice(0, checklistSep).trim() : text
  const clPart   = checklistSep > 0 && explanationSep > 0
    ? text.slice(checklistSep + 15, explanationSep).trim()
    : ''
  const exPart   = explanationSep > 0
    ? text.slice(explanationSep + 17).trim()
    : ''

  let workflow: N8nWorkflow | null = null
  try {
    workflow = JSON.parse(jsonPart) as N8nWorkflow
  } catch {
    const match = jsonPart.match(/\{[\s\S]*\}/)
    if (match) {
      try { workflow = JSON.parse(match[0]) as N8nWorkflow } catch { /* ignore */ }
    }
  }

  const checklist = clPart
    .split('\n')
    .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
    .filter(Boolean)

  return { workflow, checklist, explanation: exPart }
}
