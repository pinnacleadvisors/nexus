/**
 * lib/audit/sources.ts — the /audit terminal source registry.
 *
 * One declarative entry per pane. The generic <AuditStreamTable> renders any
 * of these; the Server Action (actions.ts) reads table-kinds; Group B's
 * streams.ts subscribes realtime-kinds + polls poll-kinds. Adding a pane =
 * one entry here, not a new component.
 *
 * Source → backing data (grounded in REAL schema, not the plan's assumptions):
 *   agents     → `agents` table (live fleet snapshot; anon-readable, in pub)
 *   crons      → GET /api/cron-health/status (existing owner endpoint, poll)
 *   skills     → `audit_log` rows for automation/skill-class resources
 *   tools      → `tool_call_audit` (every MCP tool call: status + latency)
 *   mcp        → `tool_call_audit` viewed by mcp_server (a lens on the same)
 *   gateway    → `gateway_turns` (RLS service-role-only → refresh, not live)
 *   approvals  → `approvals` (approval lifecycle; anon-readable)
 *   heartbeats → GET /api/health/deep (existing owner endpoint, poll)
 *   errors     → `tool_call_audit` where result_status='error'
 *
 * audit_log has NO RLS (anon-readable); approvals + tool_call_audit use
 * `using(true)`. run_events (JWT-sub) + gateway_turns (service_role) are NOT
 * anon-readable, so gateway is refresh-only and run_events is omitted.
 */

import type { AuditRecord, AuditSource } from './types'
import {
  cell, rel, relAhead, str, num, money, ms, clip,
  statusTone, approvalTone, agentTone, cronTone,
} from './format'

/** audit_log resources that represent skill / automation-class work. */
const SKILL_RESOURCES = [
  'content', 'workflow', 'signal', 'memory', 'memory_atom',
  'mol_atoms', 'automation', 'swarm', 'warroom',
]

const SOURCES: AuditSource[] = [
  {
    id: 'agents', label: 'Agent activity', icon: 'Bot', kind: 'realtime-table',
    table: 'agents', idField: 'id', tsField: 'last_active',
    realtime: true, realtimeEvent: '*',
    description: 'Live fleet — every agent\'s status, throughput and spend.',
    columns: [
      { key: 'name',            header: 'Agent',   className: 'min-w-[10rem]', cell: r => cell(str(r, 'name')) },
      { key: 'status',          header: 'Status',  cell: r => cell(str(r, 'status'), { badge: true, tone: agentTone(r.status) }) },
      { key: 'model',           header: 'Model',   cell: r => cell(str(r, 'model'), { mono: true, tone: 'muted' }) },
      { key: 'current_task',    header: 'Task',    className: 'min-w-[12rem]', cell: r => cell(clip(r.current_task, 40), { tone: 'muted' }) },
      { key: 'tasks_completed', header: 'Done',    className: 'text-right', cell: r => cell(num(r.tasks_completed), { mono: true }) },
      { key: 'cost_usd',        header: 'Cost',    className: 'text-right', cell: r => cell(money(r.cost_usd), { mono: true, tone: 'muted' }) },
      { key: 'error_count',     header: 'Err',     className: 'text-right', cell: r => cell(num(r.error_count), { mono: true, tone: Number(r.error_count) > 0 ? 'error' : 'muted', badge: Number(r.error_count) > 0 }) },
      { key: 'last_active',     header: 'Seen',    className: 'text-right', cell: (r, now) => cell(rel(r.last_active, now), { mono: true, tone: 'muted' }) },
    ],
    filters: [
      { kind: 'window', field: 'last_active' },
      { kind: 'agent', field: 'name' },
      { kind: 'outcome', outcomeOf: r => Number(r.error_count) > 0 ? 'error' : (String(r.status) === 'paused' ? 'warn' : 'ok') },
    ],
  },
  {
    id: 'crons', label: 'Cron activity', icon: 'Clock', kind: 'poll-endpoint',
    endpoint: '/api/cron-health/status', idField: 'job_id', tsField: 'last_execution',
    realtime: false,
    mapResponse: json => ((json as { jobs?: AuditRecord[] }).jobs ?? []),
    description: 'Scheduled jobs on cron-job.org — health, last run, next run.',
    columns: [
      { key: 'title',            header: 'Job',      className: 'min-w-[12rem]', cell: r => cell(str(r, 'title')) },
      { key: 'health',           header: 'Health',   cell: r => cell(str(r, 'health'), { badge: true, tone: cronTone(r.health) }) },
      { key: 'last_status_text', header: 'Last',     cell: r => cell(str(r, 'last_status_text'), { badge: true, tone: r.last_status_text === 'ok' ? 'ok' : r.last_status_text === 'fail' ? 'error' : 'muted' }) },
      { key: 'last_status',      header: 'Code',     className: 'text-right', cell: r => cell(str(r, 'last_status'), { mono: true, tone: 'muted' }) },
      { key: 'schedule_cron',    header: 'Schedule', cell: r => cell(str(r, 'schedule_cron'), { mono: true, tone: 'muted' }) },
      { key: 'last_execution',   header: 'Ran',      className: 'text-right', cell: (r, now) => cell(rel(r.last_execution, now), { mono: true, tone: 'muted' }) },
      { key: 'next_execution',   header: 'Next',     className: 'text-right', cell: (r, now) => cell(relAhead(r.next_execution, now), { mono: true, tone: 'muted' }) },
    ],
    filters: [
      { kind: 'outcome', outcomeOf: r => r.health === 'green' ? 'ok' : r.health === 'red' ? 'error' : r.health === 'yellow' ? 'warn' : 'pending' },
    ],
  },
  {
    id: 'skills', label: 'Skill invocations', icon: 'Sparkles', kind: 'realtime-table',
    table: 'audit_log', idField: 'id', tsField: 'created_at',
    realtime: true, realtimeEvent: 'INSERT',
    read: { in: { field: 'resource', values: SKILL_RESOURCES } },
    description: 'audit_log entries for content / workflow / memory / swarm work.',
    columns: [
      { key: 'created_at',  header: 'Time',     className: 'text-right', cell: (r, now) => cell(rel(r.created_at, now), { mono: true, tone: 'muted' }) },
      { key: 'resource',    header: 'Resource', cell: r => cell(str(r, 'resource'), { badge: true, tone: 'info' }) },
      { key: 'action',      header: 'Action',   className: 'min-w-[10rem]', cell: r => cell(str(r, 'action'), { mono: true }) },
      { key: 'resource_id', header: 'Target',   cell: r => cell(clip(r.resource_id, 28), { mono: true, tone: 'muted' }) },
      { key: 'user_id',     header: 'Actor',    cell: r => cell(clip(r.user_id, 18), { mono: true, tone: 'muted' }) },
    ],
    filters: [{ kind: 'window', field: 'created_at' }],
  },
  {
    id: 'tools', label: 'Tool calls', icon: 'Wrench', kind: 'realtime-table',
    table: 'tool_call_audit', idField: 'id', tsField: 'ts',
    realtime: true, realtimeEvent: 'INSERT',
    description: 'Every MCP tool call — agent, tool, business, status, latency.',
    columns: [
      { key: 'ts',            header: 'Time',     className: 'text-right', cell: (r, now) => cell(rel(r.ts, now), { mono: true, tone: 'muted' }) },
      { key: 'agent_slug',    header: 'Agent',    cell: r => cell(str(r, 'agent_slug')) },
      { key: 'tool_name',     header: 'Tool',     className: 'min-w-[10rem]', cell: r => cell(str(r, 'tool_name'), { mono: true }) },
      { key: 'mcp_server',    header: 'Server',   cell: r => cell(str(r, 'mcp_server'), { tone: 'muted' }) },
      { key: 'business_slug', header: 'Business', cell: r => cell(str(r, 'business_slug'), { tone: 'muted' }) },
      { key: 'result_status', header: 'Status',   cell: r => cell(str(r, 'result_status'), { badge: true, tone: statusTone(r.result_status) }) },
      { key: 'latency_ms',    header: 'Latency',  className: 'text-right', cell: r => cell(ms(r.latency_ms), { mono: true, tone: 'muted' }) },
    ],
    filters: [
      { kind: 'window', field: 'ts' },
      { kind: 'business', field: 'business_slug' },
      { kind: 'agent', field: 'agent_slug' },
      { kind: 'outcome', outcomeOf: r => statusTone(r.result_status) === 'ok' ? 'ok' : statusTone(r.result_status) === 'error' ? 'error' : statusTone(r.result_status) === 'warn' ? 'warn' : null },
    ],
  },
  {
    id: 'mcp', label: 'MCP calls', icon: 'Plug', kind: 'realtime-table',
    table: 'tool_call_audit', idField: 'id', tsField: 'ts',
    realtime: true, realtimeEvent: 'INSERT',
    description: 'Tool-call audit grouped by MCP server — per-server health.',
    columns: [
      { key: 'ts',            header: 'Time',    className: 'text-right', cell: (r, now) => cell(rel(r.ts, now), { mono: true, tone: 'muted' }) },
      { key: 'mcp_server',    header: 'Server',  className: 'min-w-[10rem]', cell: r => cell(str(r, 'mcp_server')) },
      { key: 'tool_name',     header: 'Tool',    cell: r => cell(str(r, 'tool_name'), { mono: true, tone: 'muted' }) },
      { key: 'agent_slug',    header: 'Agent',   cell: r => cell(str(r, 'agent_slug'), { tone: 'muted' }) },
      { key: 'result_status', header: 'Status',  cell: r => cell(str(r, 'result_status'), { badge: true, tone: statusTone(r.result_status) }) },
      { key: 'latency_ms',    header: 'Latency', className: 'text-right', cell: r => cell(ms(r.latency_ms), { mono: true, tone: 'muted' }) },
    ],
    filters: [
      { kind: 'window', field: 'ts' },
      { kind: 'mcp', field: 'mcp_server' },
      { kind: 'agent', field: 'agent_slug' },
      { kind: 'outcome', outcomeOf: r => statusTone(r.result_status) === 'ok' ? 'ok' : statusTone(r.result_status) === 'error' ? 'error' : statusTone(r.result_status) === 'warn' ? 'warn' : null },
    ],
  },
  {
    id: 'gateway', label: 'Gateway turns', icon: 'Cpu', kind: 'action-table',
    table: 'gateway_turns', idField: 'id', tsField: 'created_at',
    realtime: false,
    description: 'Claude/Codex dispatch turns — tokens, cost, duration (refresh).',
    columns: [
      { key: 'created_at',        header: 'Time',     className: 'text-right', cell: (r, now) => cell(rel(r.created_at, now), { mono: true, tone: 'muted' }) },
      { key: 'plan',              header: 'Plan',     cell: r => cell(str(r, 'plan'), { badge: true, tone: 'info' }) },
      { key: 'model',             header: 'Model',    className: 'min-w-[10rem]', cell: r => cell(str(r, 'model'), { mono: true, tone: 'muted' }) },
      { key: 'input_tokens',      header: 'In',       className: 'text-right', cell: r => cell(num(r.input_tokens), { mono: true }) },
      { key: 'output_tokens',     header: 'Out',      className: 'text-right', cell: r => cell(num(r.output_tokens), { mono: true }) },
      { key: 'cost_estimate_usd', header: 'Cost',     className: 'text-right', cell: r => cell(money(r.cost_estimate_usd), { mono: true, tone: 'muted' }) },
      { key: 'duration_ms',       header: 'Duration', className: 'text-right', cell: r => cell(ms(r.duration_ms), { mono: true, tone: 'muted' }) },
    ],
    filters: [{ kind: 'window', field: 'created_at' }],
  },
  {
    id: 'approvals', label: 'Approvals', icon: 'CheckCheck', kind: 'realtime-table',
    table: 'approvals', idField: 'id', tsField: 'created_at',
    realtime: true, realtimeEvent: '*',
    description: 'Approval lifecycle — pending gates and decisions per business.',
    columns: [
      { key: 'created_at',       header: 'Raised',   className: 'text-right', cell: (r, now) => cell(rel(r.created_at, now), { mono: true, tone: 'muted' }) },
      { key: 'business_slug',    header: 'Business', cell: r => cell(str(r, 'business_slug')) },
      { key: 'type',             header: 'Type',     cell: r => cell(str(r, 'type'), { badge: true, tone: 'info' }) },
      { key: 'status',           header: 'Status',   cell: r => cell(str(r, 'status'), { badge: true, tone: approvalTone(r.status) }) },
      { key: 'created_by_agent', header: 'By',       cell: r => cell(str(r, 'created_by_agent'), { tone: 'muted' }) },
      { key: 'decided_at',       header: 'Decided',  className: 'text-right', cell: (r, now) => cell(rel(r.decided_at, now), { mono: true, tone: 'muted' }) },
      { key: 'decision_note',    header: 'Note',     className: 'min-w-[10rem]', cell: r => cell(clip(r.decision_note, 36), { tone: 'muted' }) },
    ],
    filters: [
      { kind: 'window', field: 'created_at' },
      { kind: 'business', field: 'business_slug' },
      { kind: 'outcome', outcomeOf: r => approvalTone(r.status) === 'ok' ? 'ok' : approvalTone(r.status) === 'error' ? 'error' : approvalTone(r.status) === 'pending' ? 'pending' : null },
    ],
  },
  {
    id: 'heartbeats', label: 'Heartbeats', icon: 'Activity', kind: 'poll-endpoint',
    endpoint: '/api/health/deep', idField: 'provider', tsField: 'fetched_at',
    realtime: false,
    mapResponse: json => {
      const j = json as { checks?: Record<string, { ok: boolean; latency_ms?: number; error?: string; skipped?: string }>; fetched_at?: string }
      return Object.entries(j.checks ?? {}).map(([provider, c]) => ({
        provider, ok: c.ok, latency_ms: c.latency_ms ?? null,
        detail: c.skipped ?? c.error ?? '', state: c.skipped ? 'skipped' : c.ok ? 'up' : 'down',
        fetched_at: j.fetched_at ?? new Date().toISOString(),
      }))
    },
    description: 'Deep liveness — claude/codex gateways, Supabase, Redis.',
    columns: [
      { key: 'provider',   header: 'Provider', className: 'min-w-[10rem]', cell: r => cell(str(r, 'provider'), { mono: true }) },
      { key: 'state',      header: 'State',    cell: r => cell(str(r, 'state'), { badge: true, tone: r.state === 'up' ? 'ok' : r.state === 'down' ? 'error' : 'muted' }) },
      { key: 'latency_ms', header: 'Latency',  className: 'text-right', cell: r => cell(ms(r.latency_ms), { mono: true, tone: 'muted' }) },
      { key: 'detail',     header: 'Detail',   className: 'min-w-[12rem]', cell: r => cell(clip(r.detail, 48), { tone: 'muted' }) },
    ],
    filters: [
      { kind: 'outcome', outcomeOf: r => r.state === 'up' ? 'ok' : r.state === 'down' ? 'error' : null },
    ],
  },
  {
    id: 'errors', label: 'Errors', icon: 'TriangleAlert', kind: 'realtime-table',
    table: 'tool_call_audit', idField: 'id', tsField: 'ts',
    realtime: true, realtimeEvent: 'INSERT',
    read: { eq: { field: 'result_status', value: 'error' } },
    description: 'Failed tool calls — the error excerpt, agent and business.',
    columns: [
      { key: 'ts',             header: 'Time',     className: 'text-right', cell: (r, now) => cell(rel(r.ts, now), { mono: true, tone: 'muted' }) },
      { key: 'agent_slug',     header: 'Agent',    cell: r => cell(str(r, 'agent_slug')) },
      { key: 'tool_name',      header: 'Tool',     cell: r => cell(str(r, 'tool_name'), { mono: true, tone: 'muted' }) },
      { key: 'business_slug',  header: 'Business', cell: r => cell(str(r, 'business_slug'), { tone: 'muted' }) },
      { key: 'result_excerpt', header: 'Error',    className: 'min-w-[16rem]', cell: r => cell(clip(r.result_excerpt, 64), { tone: 'error' }) },
      { key: 'latency_ms',     header: 'Latency',  className: 'text-right', cell: r => cell(ms(r.latency_ms), { mono: true, tone: 'muted' }) },
    ],
    filters: [
      { kind: 'window', field: 'ts' },
      { kind: 'business', field: 'business_slug' },
      { kind: 'agent', field: 'agent_slug' },
    ],
  },
]

export const AUDIT_SOURCES = SOURCES
export const SOURCE_MAP: Record<string, AuditSource> =
  Object.fromEntries(SOURCES.map(s => [s.id, s]))

/** Panes shown on first visit (operator can add/remove/reorder). */
export const DEFAULT_TAB_IDS = ['agents', 'crons', 'errors']

/** Rows fetched per pane (initial + refresh). */
export const ROW_LIMIT = 100

export function getSource(id: string): AuditSource | undefined {
  return SOURCE_MAP[id]
}
