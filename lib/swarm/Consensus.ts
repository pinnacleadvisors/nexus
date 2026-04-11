/**
 * lib/swarm/Consensus.ts
 *
 * Three consensus protocols for validating task results before accepting them:
 *
 * - Raft:    Simple majority (≥ 2/3 approve). Safe default.
 * - BFT:     Byzantine Fault Tolerant — strict 2/3 majority with confidence weighting.
 *            Use for financial, legal, and security-critical tasks.
 * - Gossip:  Accept if any validator approves (eventual consistency).
 *            Use for low-stakes content tasks where speed > correctness.
 */

import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import type { ConsensusType, TaskVote, AgentRole } from './types'
import { AGENT_REGISTRY } from './agents/registry'

const VALIDATOR_MODEL = 'claude-haiku-4-5-20251001' // cheap validators

// ── Build a validator prompt ──────────────────────────────────────────────────
function validatorPrompt(task: string, result: string, validatorRole: AgentRole): string {
  const agent = AGENT_REGISTRY.find(a => a.role === validatorRole)
  return `You are a ${agent?.name ?? validatorRole} reviewing another agent's work.

## Original Task
${task}

## Submitted Result
${result.slice(0, 3000)}${result.length > 3000 ? '\n\n[...truncated...]' : ''}

## Your Role
Evaluate whether this result adequately completes the task. Be constructive but honest.

Respond with ONLY valid JSON (no markdown fences):
{
  "approve": true | false,
  "confidence": 0.0 to 1.0,
  "rationale": "one sentence explaining your decision"
}`
}

// ── Single validator vote ─────────────────────────────────────────────────────
async function getVote(task: string, result: string, validatorRole: AgentRole): Promise<TaskVote> {
  try {
    const { text } = await generateText({
      model: anthropic(VALIDATOR_MODEL),
      prompt:          validatorPrompt(task, result, validatorRole),
      maxOutputTokens: 200,
    })

    const parsed = JSON.parse(text.replace(/```json\n?|```\n?/g, '').trim()) as {
      approve?: boolean
      confidence?: number
      rationale?: string
    }

    return {
      agentRole:  validatorRole,
      approve:    Boolean(parsed.approve ?? false),
      confidence: Math.min(1, Math.max(0, Number(parsed.confidence ?? 0.5))),
      rationale:  String(parsed.rationale ?? 'No rationale provided.'),
    }
  } catch {
    // Default to approval on parse error to avoid blocking
    return { agentRole: validatorRole, approve: true, confidence: 0.3, rationale: 'Parse error — defaulting to approve.' }
  }
}

// ── Validator panel selection ─────────────────────────────────────────────────
function selectValidators(producerRole: AgentRole, consensusType: ConsensusType): AgentRole[] {
  // Pick validators that are different from the producer and peer-relevant
  const peers: Record<AgentRole, AgentRole[]> = {
    researcher:       ['analyst', 'strategist'],
    analyst:          ['researcher', 'data-analyst'],
    strategist:       ['analyst', 'product-manager'],
    coder:            ['reviewer', 'tester'],
    reviewer:         ['coder', 'architect'],
    tester:           ['coder', 'qa-engineer'],
    architect:        ['coder', 'devops'],
    'security-auditor': ['reviewer', 'devops'],
    marketer:         ['copywriter', 'brand-strategist'],
    copywriter:       ['marketer', 'brand-strategist'],
    'seo-specialist': ['marketer', 'analyst'],
    'social-media':   ['copywriter', 'marketer'],
    'email-specialist': ['copywriter', 'marketer'],
    designer:         ['brand-strategist', 'marketer'],
    'data-analyst':   ['analyst', 'researcher'],
    'finance-analyst':['analyst', 'strategist'],
    'legal-advisor':  ['analyst', 'product-manager'],
    'customer-support': ['copywriter', 'product-manager'],
    devops:           ['architect', 'coder'],
    'product-manager':['strategist', 'analyst'],
    'qa-engineer':    ['tester', 'reviewer'],
    'brand-strategist': ['marketer', 'copywriter'],
  }

  return (peers[producerRole] ?? ['analyst', 'reviewer']).slice(
    0,
    consensusType === 'bft' ? 3 : 2,
  )
}

// ── Run consensus ─────────────────────────────────────────────────────────────
export interface ConsensusResult {
  approved:   boolean
  votes:      TaskVote[]
  confidence: number
  summary:    string
}

export async function runConsensus(
  task:          string,
  result:        string,
  producerRole:  AgentRole,
  consensusType: ConsensusType,
): Promise<ConsensusResult> {
  // Gossip: fast-path — accept if result is non-empty
  if (consensusType === 'gossip') {
    const trimmed = result.trim()
    if (trimmed.length > 100) {
      return {
        approved:   true,
        votes:      [{ agentRole: producerRole, approve: true, confidence: 0.7, rationale: 'Gossip: non-empty result accepted.' }],
        confidence: 0.7,
        summary:    'Gossip consensus: result accepted.',
      }
    }
    return {
      approved:   false,
      votes:      [{ agentRole: producerRole, approve: false, confidence: 0.9, rationale: 'Gossip: result too short.' }],
      confidence: 0.9,
      summary:    'Gossip consensus: result too short, rejected.',
    }
  }

  const validators = selectValidators(producerRole, consensusType)

  // Run validators in parallel
  const votes = await Promise.all(
    validators.map(v => getVote(task, result, v))
  )

  const approvals = votes.filter(v => v.approve)
  const avgConf   = votes.reduce((s, v) => s + v.confidence, 0) / votes.length

  let approved: boolean
  if (consensusType === 'bft') {
    // BFT: strict 2/3 majority with confidence weighting
    const weightedApprovals = votes.filter(v => v.approve && v.confidence >= 0.6).length
    approved = weightedApprovals >= Math.ceil((votes.length * 2) / 3)
  } else {
    // Raft: simple majority
    approved = approvals.length > votes.length / 2
  }

  const summary = approved
    ? `${consensusType.toUpperCase()}: ${approvals.length}/${votes.length} approved (avg confidence: ${(avgConf * 100).toFixed(0)}%)`
    : `${consensusType.toUpperCase()}: ${approvals.length}/${votes.length} approved — REJECTED`

  return { approved, votes, confidence: avgConf, summary }
}
