/**
 * lib/ecosystems/adapters/kling.ts — `video` adapter for Kling 2.0.
 *
 * Thin ecosystem wrapper over the existing client at lib/video/kling.ts —
 * does NOT re-implement the HTTP surface. Exposes the registry verbs the
 * content dept's asset-builder dispatches (`render_clip`) plus an async
 * status poll (`get_clip_status`), because video generation is async: the
 * upstream returns a task id immediately and the caller polls.
 *
 * Env: KLING_API_KEY (see lib/video/kling.ts).
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'
import {
  generateClip,
  getTask,
  isKlingConfigured,
  type KlingAspectRatio,
  type KlingDuration,
} from '@/lib/video/kling'

const VERBS = ['render_clip', 'get_clip_status'] as const
type Verb = (typeof VERBS)[number]

interface RenderClipPayload {
  prompt:         string
  duration_s?:    number
  aspect_ratio?:  KlingAspectRatio
  model?:         'kling-v2' | 'kling-v1-5' | 'kling-v1'
  reference_image?: string
}

interface GetClipStatusPayload {
  task_id: string
}

/** Kling only supports 5s or 10s clips. Snap the requested duration. */
function snapDuration(s: number | undefined): KlingDuration {
  return (s ?? 5) > 5 ? 10 : 5
}

export const klingAdapter: EcosystemAdapter = {
  kind:         'video',
  name:         'kling',
  label:        'Kling 2.0 (cinematic video)',
  capabilities: VERBS,
  available:    () => isKlingConfigured(),
  invoke:       invokeKling,
}

async function invokeKling(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!klingAdapter.available()) {
    return unavailable('kling', verb, 'Set KLING_API_KEY to enable Kling video generation.')
  }
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('kling', verb, VERBS)

  try {
    if (verb === 'render_clip') {
      const p = (payload ?? {}) as RenderClipPayload
      if (typeof p.prompt !== 'string' || !p.prompt.trim()) {
        return { ok: false, adapter: 'kling', verb, error: 'upstream_error', message: 'render_clip requires non-empty `prompt`' }
      }
      const t0 = Date.now()
      const taskId = await generateClip({
        prompt:         p.prompt,
        duration:       snapDuration(p.duration_s),
        aspectRatio:    p.aspect_ratio ?? '9:16',
        model:          p.model ?? 'kling-v2',
        referenceImage: p.reference_image,
      })
      const latency = Date.now() - t0
      if (!taskId) {
        return { ok: false, adapter: 'kling', verb, error: 'upstream_error', message: 'kling render_clip kickoff failed', telemetry: { latency_ms: latency } }
      }
      // Async: return the handle. Caller polls `get_clip_status`.
      return { ok: true, adapter: 'kling', verb, result: { task_id: taskId, status: 'submitted' }, telemetry: { latency_ms: latency } }
    }

    // get_clip_status
    const p = (payload ?? {}) as GetClipStatusPayload
    if (!p.task_id) {
      return { ok: false, adapter: 'kling', verb, error: 'upstream_error', message: 'get_clip_status requires `task_id`' }
    }
    const t0 = Date.now()
    const task = await getTask(p.task_id)
    const latency = Date.now() - t0
    const done = task.status === 'succeed'
    return {
      ok:        task.status !== 'failed',
      adapter:   'kling',
      verb,
      result:    { status: task.status, video_url: done ? task.videoUrl : undefined, cover_url: task.coverUrl },
      error:     task.status === 'failed' ? 'upstream_error' : undefined,
      message:   task.error,
      telemetry: { latency_ms: latency },
    }
  } catch (e) {
    return { ok: false, adapter: 'kling', verb, error: 'upstream_error', message: e instanceof Error ? e.message : 'kling call failed' }
  }
}
