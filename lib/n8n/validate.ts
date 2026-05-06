/**
 * Lightweight structural validator for AI-generated n8n workflows.
 *
 * NOT a full schema check — n8n itself validates against its own schema when
 * a workflow is POSTed. This catches the most common AI-generation errors
 * up-front so we don't import a broken workflow:
 *
 *   - Top-level shape ({ nodes, connections, settings })
 *   - Each node has required fields
 *   - Node names are unique (connections key on names, dupes are ambiguous)
 *   - Every connection target references an existing node
 *   - There's at least one trigger node and at least one non-trigger node
 *   - Dispatch nodes carry a non-empty `inputs.tools` budget
 *
 * Returns a list of error strings; empty list means structurally valid.
 *
 * Used by lib/n8n/finalize.ts before the live-n8n write step.
 */

import type { N8nWorkflow, N8nNode } from './types'

export interface ValidationResult {
  ok:     boolean
  errors: string[]
  /** Non-fatal observations the caller may want to log but not fail on. */
  warnings: string[]
}

const TRIGGER_TYPE_PREFIXES = [
  'n8n-nodes-base.manualTrigger',
  'n8n-nodes-base.scheduleTrigger',
  'n8n-nodes-base.webhook',
  'n8n-nodes-base.cronTrigger',
]

const DISPATCH_URL_FRAGMENT = '/api/claude-session/dispatch'
const AGENT_URL_FRAGMENT    = '/api/agent'

function isTriggerNode(node: N8nNode): boolean {
  return TRIGGER_TYPE_PREFIXES.some(prefix => node.type.startsWith(prefix))
}

function extractDispatchBody(node: N8nNode): Record<string, unknown> | null {
  const url = node.parameters?.url
  if (typeof url !== 'string' || !url.includes(DISPATCH_URL_FRAGMENT)) return null
  const raw = node.parameters?.jsonBody
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

export function validateWorkflow(wf: unknown): ValidationResult {
  const errors:   string[] = []
  const warnings: string[] = []

  if (typeof wf !== 'object' || wf === null) {
    return { ok: false, errors: ['workflow is not an object'], warnings }
  }
  const w = wf as Partial<N8nWorkflow>

  if (typeof w.name !== 'string' || w.name.length === 0) {
    errors.push('workflow.name must be a non-empty string')
  }
  if (!Array.isArray(w.nodes) || w.nodes.length === 0) {
    errors.push('workflow.nodes must be a non-empty array')
    return { ok: false, errors, warnings } // can't validate further without nodes
  }
  if (typeof w.connections !== 'object' || w.connections === null) {
    errors.push('workflow.connections must be an object')
  }

  const nodeNames = new Set<string>()
  let triggerCount = 0
  let nonTriggerCount = 0
  let dispatchCount = 0
  let dispatchWithBudget = 0

  for (const [i, node] of w.nodes.entries()) {
    const path = `nodes[${i}]`
    if (typeof node.id !== 'string' || node.id.length === 0) errors.push(`${path}.id required`)
    if (typeof node.name !== 'string' || node.name.length === 0) errors.push(`${path}.name required`)
    if (typeof node.type !== 'string' || node.type.length === 0) errors.push(`${path}.type required`)
    if (typeof node.typeVersion !== 'number') errors.push(`${path}.typeVersion required`)
    if (!Array.isArray(node.position) || node.position.length !== 2) {
      errors.push(`${path}.position must be [x,y]`)
    }
    if (typeof node.parameters !== 'object' || node.parameters === null) {
      errors.push(`${path}.parameters must be an object`)
    }

    if (typeof node.name === 'string' && node.name.length > 0) {
      if (nodeNames.has(node.name)) errors.push(`duplicate node name: "${node.name}"`)
      nodeNames.add(node.name)
    }

    if (isTriggerNode(node)) triggerCount++
    else nonTriggerCount++

    const dispatchBody = extractDispatchBody(node)
    if (dispatchBody) {
      dispatchCount++
      const inputs = dispatchBody.inputs as Record<string, unknown> | undefined
      const tools = inputs?.tools
      if (Array.isArray(tools) && tools.length >= 1) {
        if (tools.length >= 2) dispatchWithBudget++
        else warnings.push(`${path}: dispatch "${node.name}" has tools=[${tools.length}], expected ≥2 for runtime choice`)
      } else {
        warnings.push(`${path}: dispatch "${node.name}" has no inputs.tools budget — agent will lack tool guidance`)
      }
    }

    // Plain agent capability nodes — sanity-check that they at least have a capabilityId.
    const url = node.parameters?.url
    if (typeof url === 'string' && url.includes(AGENT_URL_FRAGMENT) && !url.includes(DISPATCH_URL_FRAGMENT)) {
      const raw = node.parameters?.jsonBody
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw) as { capabilityId?: unknown }
          if (typeof parsed.capabilityId !== 'string' || !parsed.capabilityId) {
            warnings.push(`${path}: capability node "${node.name}" missing capabilityId`)
          }
        } catch {
          warnings.push(`${path}: capability node "${node.name}" has invalid jsonBody`)
        }
      }
    }
  }

  if (triggerCount === 0)    errors.push('workflow must have at least one trigger node (manual / schedule / webhook)')
  if (nonTriggerCount === 0) errors.push('workflow must have at least one non-trigger node')

  // Validate connection targets reference existing nodes.
  if (w.connections && typeof w.connections === 'object') {
    for (const [sourceName, edges] of Object.entries(w.connections)) {
      if (!nodeNames.has(sourceName)) {
        errors.push(`connection source "${sourceName}" not in nodes list`)
        continue
      }
      const main = (edges as { main?: unknown[][] }).main
      if (!Array.isArray(main)) {
        errors.push(`connections["${sourceName}"].main must be an array`)
        continue
      }
      for (const [outIdx, outputs] of main.entries()) {
        if (!Array.isArray(outputs)) {
          errors.push(`connections["${sourceName}"].main[${outIdx}] must be an array`)
          continue
        }
        for (const [edgeIdx, edge] of outputs.entries()) {
          const e = edge as { node?: unknown }
          if (typeof e.node !== 'string' || !nodeNames.has(e.node)) {
            errors.push(`connections["${sourceName}"].main[${outIdx}][${edgeIdx}].node "${String(e.node)}" not in nodes list`)
          }
        }
      }
    }
  }

  if (dispatchCount > 0 && dispatchWithBudget < dispatchCount) {
    warnings.push(
      `${dispatchCount - dispatchWithBudget}/${dispatchCount} dispatch nodes lack a tool budget — see n8n-strategist.md "Tool budget" section`,
    )
  }

  return { ok: errors.length === 0, errors, warnings }
}
