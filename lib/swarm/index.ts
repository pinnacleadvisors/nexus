/**
 * lib/swarm/index.ts
 * Public API surface for the swarm orchestration layer.
 */

export type {
  SwarmConfig,
  SwarmRun,
  SwarmTask,
  SwarmPhase,
  SwarmEvent,
  SwarmEventType,
  SwarmStatus,
  TaskStatus,
  TaskVote,
  AgentRole,
  ConsensusType,
  QueenType,
  ReasoningPattern,
  EventEmitter,
} from './types'

export { MODEL_COSTS, estimateCostUsd } from './types'
export { AGENT_REGISTRY, getAgent, findAgentByTags, AGENT_ROLES } from './agents/registry'
export { runSwarm, strategicDecompose } from './Queen'
export { routeTask, inferComplexity, getQTableStats } from './Router'
export { runConsensus } from './Consensus'
export { optimiseContext, buildSwarmContext, approxTokens } from './TokenOptimiser'
export { tryFastPath, detectFastPathOp } from './WasmFastPath'
export { storePattern, getBestPattern, getRoutingStats, hashText } from './ReasoningBank'
