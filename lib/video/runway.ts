/**
 * lib/video/runway.ts
 *
 * Runway Gen-4 API client — cinematic / stylised text-to-video.
 * Docs: https://docs.runwayml.com/api-reference
 *
 * Env vars required:
 *   RUNWAY_API_KEY — API key from https://runwayml.com
 */

const BASE = 'https://api.runwayml.com/v1'

function headers(): Record<string, string> {
  const key = process.env.RUNWAY_API_KEY
  if (!key) throw new Error('RUNWAY_API_KEY is not set')
  return {
    Authorization:  `Bearer ${key}`,
    'Content-Type': 'application/json',
    'X-Runway-Version': '2024-11-06',
  }
}

export function isRunwayConfigured(): boolean {
  return Boolean(process.env.RUNWAY_API_KEY)
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type RunwayModel = 'gen4_turbo' | 'gen3a_turbo'
export type RunwayAspectRatio = '1280:720' | '720:1280' | '1104:832' | '832:1104' | '960:960'
export type RunwayDuration = 5 | 10

export interface RunwayGenerateOptions {
  prompt:          string
  model?:          RunwayModel
  aspectRatio?:    RunwayAspectRatio
  duration?:       RunwayDuration
  /** Optional reference image URL for image+text-to-video */
  referenceImage?: string
  seed?:           number
}

export interface RunwayTask {
  taskId:    string
  status:    'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  videoUrl?: string
  progress?: number  // 0–1
  error?:    string
}

// ── API calls ─────────────────────────────────────────────────────────────────

/** Submit a generation task. Returns the task ID. */
export async function generateClip(opts: RunwayGenerateOptions): Promise<string | null> {
  try {
    const body: Record<string, unknown> = {
      model:         opts.model      ?? 'gen4_turbo',
      promptText:    opts.prompt,
      ratio:         opts.aspectRatio ?? '1280:720',
      duration:      opts.duration   ?? 5,
    }
    if (opts.referenceImage) body.promptImage = opts.referenceImage
    if (opts.seed)           body.seed = opts.seed

    const res = await fetch(`${BASE}/image_to_video`, {
      method:  'POST',
      headers: headers(),
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      console.error('[runway] generateClip failed:', res.status, await res.text())
      return null
    }

    const data = await res.json() as { id?: string }
    return data.id ?? null
  } catch (err) {
    console.error('[runway] generateClip error:', err)
    return null
  }
}

/** Poll a task until it completes or fails. Times out after `maxWaitMs` (default 10 min). */
export async function pollTask(
  taskId:        string,
  maxWaitMs    = 600_000,
  pollIntervalMs = 5_000,
): Promise<RunwayTask> {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    const task = await getTask(taskId)
    if (task.status === 'SUCCEEDED' || task.status === 'FAILED' || task.status === 'CANCELLED') {
      return task
    }
    await new Promise(r => setTimeout(r, pollIntervalMs))
  }
  return { taskId, status: 'FAILED', error: 'Polling timed out' }
}

/** Get the current status of a task. */
export async function getTask(taskId: string): Promise<RunwayTask> {
  try {
    const res = await fetch(`${BASE}/tasks/${taskId}`, {
      headers: headers(),
      signal:  AbortSignal.timeout(15_000),
    })
    if (!res.ok) return { taskId, status: 'FAILED', error: `HTTP ${res.status}` }

    const data = await res.json() as {
      id:       string
      status:   string
      progress?: number
      output?:  string[]
      failure?:  string
    }

    return {
      taskId,
      status:   data.status as RunwayTask['status'],
      videoUrl: data.output?.[0],
      progress: data.progress,
      error:    data.failure,
    }
  } catch (err) {
    return { taskId, status: 'FAILED', error: String(err) }
  }
}

/** Estimate cost in USD for a Runway generation. Approximate Gen-4 Turbo pricing. */
export function estimateCost(duration: RunwayDuration, model: RunwayModel = 'gen4_turbo'): number {
  // Gen-4 Turbo: ~$0.05/sec; Gen-3a Turbo: ~$0.025/sec
  const ratePerSec: Record<RunwayModel, number> = {
    gen4_turbo:   0.05,
    gen3a_turbo:  0.025,
  }
  return (ratePerSec[model] ?? 0.05) * duration
}
