/**
 * lib/video/kling.ts
 *
 * Kling 2.0 API client — text-to-video and image-to-video.
 * Docs: https://klingai.com/api-reference
 *
 * Env vars required:
 *   KLING_API_KEY — API key from https://klingai.com/api
 */

const BASE = 'https://api.klingai.com/v1'

function headers(): Record<string, string> {
  const key = process.env.KLING_API_KEY
  if (!key) throw new Error('KLING_API_KEY is not set')
  return {
    Authorization:  `Bearer ${key}`,
    'Content-Type': 'application/json',
  }
}

export function isKlingConfigured(): boolean {
  return Boolean(process.env.KLING_API_KEY)
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type KlingModel = 'kling-v2' | 'kling-v1-5' | 'kling-v1'
export type KlingAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4'
export type KlingDuration = 5 | 10

export interface KlingGenerateOptions {
  prompt:         string
  negativePrompt?: string
  model?:         KlingModel
  aspectRatio?:   KlingAspectRatio
  duration?:      KlingDuration
  /** Image URL for image-to-video mode */
  referenceImage?: string
  /** For first/last frame guidance */
  tailImage?:     string
  cfgScale?:      number  // 0–1, default 0.5
}

export interface KlingTask {
  taskId:    string
  status:    'submitted' | 'processing' | 'succeed' | 'failed'
  videoUrl?: string
  coverUrl?: string
  duration?: number
  error?:    string
}

// ── API calls ─────────────────────────────────────────────────────────────────

/** Submit a text-to-video or image-to-video generation task. Returns the task ID. */
export async function generateClip(opts: KlingGenerateOptions): Promise<string | null> {
  try {
    const endpoint = opts.referenceImage
      ? `${BASE}/videos/image2video`
      : `${BASE}/videos/text2video`

    const body: Record<string, unknown> = {
      model_name:      opts.model         ?? 'kling-v2',
      prompt:          opts.prompt,
      negative_prompt: opts.negativePrompt ?? '',
      aspect_ratio:    opts.aspectRatio   ?? '16:9',
      duration:        String(opts.duration ?? 5),
      cfg_scale:       opts.cfgScale      ?? 0.5,
    }
    if (opts.referenceImage) body.image = opts.referenceImage
    if (opts.tailImage)      body.image_tail = opts.tailImage

    const res = await fetch(endpoint, {
      method:  'POST',
      headers: headers(),
      body:    JSON.stringify(body),
    })

    if (!res.ok) {
      console.error('[kling] generateClip failed:', res.status, await res.text())
      return null
    }

    const data = await res.json() as { data?: { task_id?: string } }
    return data.data?.task_id ?? null
  } catch (err) {
    console.error('[kling] generateClip error:', err)
    return null
  }
}

/** Poll a task until it completes or fails. Times out after `maxWaitMs` (default 10 min). */
export async function pollTask(
  taskId:     string,
  maxWaitMs = 600_000,
  pollIntervalMs = 5_000,
): Promise<KlingTask> {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    const task = await getTask(taskId)
    if (task.status === 'succeed' || task.status === 'failed') return task
    await new Promise(r => setTimeout(r, pollIntervalMs))
  }
  return { taskId, status: 'failed', error: 'Polling timed out' }
}

/** Get the current status of a task. */
export async function getTask(taskId: string): Promise<KlingTask> {
  try {
    const res = await fetch(`${BASE}/videos/text2video/${taskId}`, {
      headers: headers(),
    })
    if (!res.ok) return { taskId, status: 'failed', error: `HTTP ${res.status}` }

    const data = await res.json() as {
      data?: {
        task_id:     string
        task_status: string
        task_result?: {
          videos?: Array<{ url: string; cover_image_url?: string; duration?: string }>
        }
      }
    }

    const d = data.data
    if (!d) return { taskId, status: 'failed', error: 'No data in response' }

    const statusMap: Record<string, KlingTask['status']> = {
      submitted:  'submitted',
      processing: 'processing',
      succeed:    'succeed',
      failed:     'failed',
    }

    const video = d.task_result?.videos?.[0]
    return {
      taskId,
      status:    statusMap[d.task_status] ?? 'processing',
      videoUrl:  video?.url,
      coverUrl:  video?.cover_image_url,
      duration:  video?.duration ? parseFloat(video.duration) : undefined,
    }
  } catch (err) {
    return { taskId, status: 'failed', error: String(err) }
  }
}

/** Estimate cost in USD for a Kling generation. Approximate Kling v2 pricing. */
export function estimateCost(duration: KlingDuration, model: KlingModel = 'kling-v2'): number {
  const rates: Record<KlingModel, Record<KlingDuration, number>> = {
    'kling-v2':   { 5: 0.28, 10: 0.56 },
    'kling-v1-5': { 5: 0.14, 10: 0.28 },
    'kling-v1':   { 5: 0.07, 10: 0.14 },
  }
  return rates[model][duration] ?? 0.28
}
