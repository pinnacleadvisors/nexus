/**
 * Adapter interface — Paperclip absorption Task 4a.
 *
 * One adapter per runtime. The strategist (solopreneur-loop, business-operator,
 * platform-copilot) emits adapter-agnostic dispatches; the registry resolves
 * the adapter by type and the adapter handles the runtime-specific call.
 *
 * Three-method contract per Paperclip doc/SPEC.md §4 (heartbeat protocol):
 *   - invoke: start the agent's cycle, return a handle the registry can poll
 *   - status: ask the adapter whether the run is still alive / what state
 *   - cancel: graceful termination signal (paused agent, USD cap tripped, etc)
 *
 * Adapters live at lib/adapters/<type>.ts and self-register with the registry
 * at module init. No core dispatch route knows about specific adapter types.
 *
 * See: docs/research/paperclip-audit-2026-05.md §6 (the absorbable concept)
 *      docs/adr/007-paperclip-absorption.md
 */

export type AdapterType =
  | 'claude_gateway'
  | 'codex_gateway'
  | 'coolify_business'
  | 'n8n'
  | 'inngest'
  | (string & {})

export type AgentState =
  | 'idle'
  | 'queued'
  | 'running'
  | 'completed'
  | 'errored'
  | 'cancelled'

export interface InvokeContext {
  business_slug:     string
  user_id:           string
  agent_slug:        string
  issue_id?:         string | null
  goal_id?:          string | null
  ancestry_prompt?:  string | null   // pre-rendered ancestry block from lib/goals/ancestry.ts
  run_id?:           string | null
  // Open extension point — adapters MAY consume additional keys but must not
  // require them. Keep this object small and serialisable; nothing here gets
  // logged to memory-hq without explicit redaction.
  inputs?:           Record<string, unknown>
}

export interface RunHandle {
  adapter_type:   AdapterType
  adapter_run_id: string             // adapter-internal id (e.g. claude session id, n8n execution id)
  business_slug:  string
  agent_slug:     string
  started_at:     string             // ISO timestamp
}

export interface RunStatus {
  state:        AgentState
  detail?:      string | null         // adapter-supplied summary
  cost_usd?:    number | null         // optional cost report
  completed_at?: string | null        // ISO timestamp when state ∈ {completed, errored, cancelled}
}

export interface Adapter {
  type:    AdapterType
  invoke:  (ctx: InvokeContext) => Promise<RunHandle>
  status:  (handle: RunHandle) => Promise<RunStatus>
  cancel:  (handle: RunHandle) => Promise<void>
}
