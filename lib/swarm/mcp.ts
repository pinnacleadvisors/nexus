/**
 * lib/swarm/mcp.ts
 *
 * MCP (Model Context Protocol) tool definitions for the swarm.
 * These are exposed as HTTP endpoints that OpenClaw / Claude Code can call
 * as MCP tools via the Vercel AI SDK tool-calling format.
 *
 * Tool endpoints live at /api/swarm/mcp/:tool
 * Use with: claude mcp add nexus-swarm <your-vercel-url>/api/swarm/mcp
 */

export const SWARM_MCP_TOOLS = [
  {
    name:        'create_swarm',
    description: 'Start a new multi-agent swarm to accomplish a complex goal. Returns a swarm ID and streams execution events.',
    inputSchema: {
      type: 'object',
      properties: {
        goal:          { type: 'string',  description: 'The goal or task for the swarm to accomplish.' },
        context:       { type: 'string',  description: 'Additional context, background, or constraints.' },
        consensusType: { type: 'string',  enum: ['raft', 'bft', 'gossip'], description: 'Consensus protocol. Use bft for financial/legal tasks, gossip for fast content tasks, raft (default) for everything else.' },
        queenType:     { type: 'string',  enum: ['strategic', 'tactical', 'adaptive'], description: 'Queen orchestration type. Default: strategic.' },
        budgetUsd:     { type: 'number',  description: 'Maximum spend in USD (default: 5.00).' },
      },
      required: ['goal'],
    },
  },
  {
    name:        'get_swarm_status',
    description: 'Get the current status, phases, and task results of a swarm run.',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string', description: 'The swarm ID returned by create_swarm.' },
      },
      required: ['swarmId'],
    },
  },
  {
    name:        'abort_swarm',
    description: 'Stop a running swarm immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string', description: 'The swarm ID to abort.' },
      },
      required: ['swarmId'],
    },
  },
  {
    name:        'list_agents',
    description: 'List all available specialist agents with their roles, descriptions, and preferred models.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Optional tag or keyword to filter agents.' },
      },
    },
  },
]

// ── MCP manifest for claude mcp add ──────────────────────────────────────────
export function getMcpManifest(baseUrl: string) {
  return {
    name:        'nexus-swarm',
    version:     '1.0.0',
    description: 'Nexus multi-agent swarm orchestration — dispatch complex goals to specialist AI agent swarms',
    tools:       SWARM_MCP_TOOLS.map(tool => ({
      ...tool,
      endpoint: `${baseUrl}/api/swarm/mcp/${tool.name}`,
    })),
  }
}
