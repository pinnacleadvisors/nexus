/**
 * lib/n8n/managed-agent-builder.ts
 *
 * Builds the n8n node JSON that dispatches work to a Claude managed agent via
 * Nexus' `/api/claude-session/dispatch` endpoint. The dispatch endpoint is
 * responsible for:
 *
 *   1. Ensuring the agent markdown spec exists under `.claude/agents/<slug>.md`.
 *      If missing, it invokes the agent-generator to emit a minimal spec.
 *   2. Assembling the session env (including
 *      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 when `swarm: true`).
 *   3. Forwarding the request to the OpenClaw gateway so a real Claude Code
 *      session is spawned with the agent loaded.
 *
 * Keeping this node-builder pure (no side-effects, no imports from next/server)
 * means the same helper can be reused inside `/api/n8n/generate` and in ad-hoc
 * scripts that rebuild workflows from idea cards.
 */

import type { N8nNode } from './types'
import type { AssetKind } from './asset-detector'

export interface BuildSessionDispatchNodeOptions {
  id:           string
  name:         string
  position:     [number, number]
  agentSlug:    string
  capabilityId: string
  swarm:        boolean
  autoCreateAgent?: boolean
  asset?:       AssetKind | null
  inputs: {
    task:            string
    description?:    string
    howItMakesMoney?: string
    tools?:          string[]
    [extra: string]: unknown
  }
}

export function buildSessionDispatchNode(opts: BuildSessionDispatchNodeOptions): N8nNode {
  const body = {
    agentSlug:       opts.agentSlug,
    capabilityId:    opts.capabilityId,
    swarm:           opts.swarm,
    autoCreateAgent: opts.autoCreateAgent ?? true,
    asset:           opts.asset ?? null,
    inputs: {
      ...opts.inputs,
      upstream: '={{$json}}',
    },
  }

  return {
    id:          opts.id,
    name:        opts.name,
    type:        'n8n-nodes-base.httpRequest',
    typeVersion: 4,
    position:    opts.position,
    parameters:  {
      method: 'POST',
      url:    '={{$vars.NEXUS_BASE_URL}}/api/claude-session/dispatch',
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: 'Content-Type', value: 'application/json' }],
      },
      sendBody: true,
      bodyContentType: 'json',
      jsonBody: JSON.stringify(body, null, 2),
    },
  }
}

/**
 * Returns the env overrides a session needs depending on whether swarm is on.
 * Consumed by both the dispatch route and anywhere else that materialises a
 * Claude Code session config.
 */
export function buildSessionEnv(opts: { swarm: boolean }): Record<string, string> {
  const env: Record<string, string> = {}
  if (opts.swarm) {
    // See https://docs.anthropic.com/en/docs/claude-code/sub-agents#experimental-agent-teams
    env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'
  }
  return env
}
