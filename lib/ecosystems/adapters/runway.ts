/**
 * lib/ecosystems/adapters/runway.ts — `video` adapter for Runway Gen-4.
 *
 * Thin ecosystem wrapper over the existing client at lib/video/runway.ts.
 * Same async contract as the kling adapter: `render_clip` returns a task
 * handle, `get_clip_status` polls. This is the default `video` binding for
 * the `saas` niche (lib/teams/default-bindings.ts).
 *
 * Env: RUNWAY_API_KEY (see lib/video/runway.ts).
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'
import {
  generateClip,
  getTask,
  isRunwayConfigured,
  type RunwayAspectRatio,
  type RunwayDuration,
  type RunwayModel,
} from '@/lib/video/runway'

const VERBS = ['render_clip', 'get_clip_status'] as const
type Verb = (typeof VERBS)[number]

interface RenderClipPayload {
  prompt:           string
  duration_s?:      number
  aspect_ratio?:    RunwayAspectRatio
  model?:           RunwayModel
  reference_image?: string
}

interface GetClipStatusPayload {
  task_id: string
}

function snapDuration(s: number | undefined): RunwayDuration {
  return (s ?? 5) > 5 ? 10 : 5
}

export const runwayAdapter: EcosystemAdapter = {
  kind:         'video',
  name:         'runway',
  label:        'Runway Gen-4 (stylised video)',
  capabilities: VERBS,
  available:    () => isRunwayConfigured(),
  invoke:       invokeRunway,
}

async function invokeRunway(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!runwayAdapter.available()) {
    return unavailable('runway', verb, 'Set RUNWAY_API_KEY to enable Runway video generation.')
  }
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('runway', verb, VERBS)

  try {
    if (verb === 'render_clip') {
      const p = (payload ?? {}) as RenderClipPayload
      if (typeof p.prompt !== 'string' || !p.prompt.trim()) {
        return { ok: false, adapter: 'runway', verb, error: 'upstream_error', message: 'render_clip requires non-empty `prompt`' }
      }
      const t0 = Date.now()
      const taskId = await generateClip({
        prompt:         p.prompt,
        duration:       snapDuration(p.duration_s),
        aspectRatio:    p.aspect_ratio ?? '720:1280',
        model:          p.model ?? 'gen4_turbo',
        referenceImage: p.reference_image,
      })
      const latency = Date.now() - t0
      if (!taskId) {
        return { ok: false, adapter: 'runway', verb, error: 'upstream_error', message: 'runway render_clip kickoff failed', telemetry: { latency_ms: latency } }
      }
      return { ok: true, adapter: 'runway', verb, result: { task_id: taskId, status: 'submitted' }, telemetry: { latency_ms: latency } }
    }

    const p = (payload ?? {}) as GetClipStatusPayload
    if (!p.task_id) {
      return { ok: false, adapter: 'runway', verb, error: 'upstream_error', message: 'get_clip_status requires `task_id`' }
    }
    const t0 = Date.now()
    const task = await getTask(p.task_id)
    const latency = Date.now() - t0
    const done = task.status === 'SUCCEEDED'
    const failed = task.status === 'FAILED' || task.status === 'CANCELLED'
    return {
      ok:        !failed,
      adapter:   'runway',
      verb,
      result:    { status: task.status, video_url: done ? task.videoUrl : undefined, progress: task.progress },
      error:     failed ? 'upstream_error' : undefined,
      message:   task.error,
      telemetry: { latency_ms: latency },
    }
  } catch (e) {
    return { ok: false, adapter: 'runway', verb, error: 'upstream_error', message: e instanceof Error ? e.message : 'runway call failed' }
  }
}
