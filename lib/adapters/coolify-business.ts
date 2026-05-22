/**
 * coolify_business adapter — wraps lib/coolify/client.ts to treat a
 * per-business Coolify app as a runtime target. Useful when the strategist
 * wants to start/stop/redeploy a business's container as part of a heartbeat
 * (e.g. wake-from-idle before dispatch, scale-down after).
 *
 * invoke: startApp(uuid)  + log a heartbeat row
 * status: getApp(uuid)    → state mapping
 * cancel: stopApp(uuid)
 *
 * The container itself runs its own claude-gateway internally; this adapter
 * is the orchestration shim AROUND that container, not the dispatcher to the
 * agent inside it (that's claude_gateway adapter).
 *
 * inputs.coolify_app_uuid must be set — without it invoke throws. The
 * solopreneur-loop resolves uuid via business_operators.metadata when this
 * adapter is wired in.
 *
 * NOT YET WIRED — same status as claude_gateway adapter.
 */

import type { Adapter, InvokeContext, RunHandle, RunStatus } from './types'
import * as coolify from '@/lib/coolify/client'

function getAppUuid(ctx: InvokeContext): string {
  const v = (ctx.inputs as { coolify_app_uuid?: unknown } | undefined)?.coolify_app_uuid
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error('coolify_business adapter: inputs.coolify_app_uuid is required')
  }
  return v
}

export const coolifyBusinessAdapter: Adapter = {
  type: 'coolify_business',

  async invoke(ctx: InvokeContext): Promise<RunHandle> {
    if (!coolify.isConfigured()) {
      throw new Error('coolify_business adapter: Coolify is not configured (COOLIFY_API_URL / COOLIFY_API_TOKEN)')
    }
    const uuid = getAppUuid(ctx)
    await coolify.startApp(uuid)
    return {
      adapter_type:   'coolify_business',
      adapter_run_id: uuid,
      business_slug:  ctx.business_slug,
      agent_slug:     ctx.agent_slug,
      started_at:     new Date().toISOString(),
    }
  },

  async status(handle: RunHandle): Promise<RunStatus> {
    if (!coolify.isConfigured()) return { state: 'errored', detail: 'coolify unconfigured' }
    const app = await coolify.getApp(handle.adapter_run_id).catch(() => null)
    if (!app) return { state: 'errored', detail: 'app not found' }
    // Coolify status values vary; map common ones. Anything we don't recognise
    // gets reported as 'running' (caller can drill into detail for raw value).
    const raw = String((app as { status?: string }).status ?? '').toLowerCase()
    const state: RunStatus['state'] =
      raw.includes('running') ? 'running' :
      raw.includes('exited') || raw.includes('stopped') ? 'completed' :
      raw.includes('starting') || raw.includes('queued') ? 'queued' :
      raw.includes('error') || raw.includes('failed') ? 'errored' :
      'running'
    return { state, detail: raw || null }
  },

  async cancel(handle: RunHandle): Promise<void> {
    if (!coolify.isConfigured()) return
    await coolify.stopApp(handle.adapter_run_id).catch(() => undefined)
  },
}
