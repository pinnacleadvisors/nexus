/**
 * app/api/video/generate/route.ts
 *
 * POST /api/video/generate
 * Accepts a video brief, selects Kling or Runway, submits the generation job,
 * and returns { jobId, provider, estimatedCostUsd }.
 *
 * Job state is kept in a module-level Map for serverless-friendly polling.
 * In production, swap for a Redis / Supabase store.
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateClip as klingGenerate, estimateCost as klingCost, isKlingConfigured }
  from '@/lib/video/kling'
import { generateClip as runwayGenerate, estimateCost as runwayCost, isRunwayConfigured }
  from '@/lib/video/runway'
import type { KlingAspectRatio, KlingModel } from '@/lib/video/kling'
import type { RunwayAspectRatio, RunwayDuration, RunwayModel } from '@/lib/video/runway'

export const runtime = 'nodejs'
export const maxDuration = 30  // submitting a job is fast; polling happens separately

// ── In-process job store ──────────────────────────────────────────────────────

export type VideoJobStatus = 'queued' | 'processing' | 'succeeded' | 'failed'

export interface VideoJob {
  jobId:     string
  provider:  'kling' | 'runway'
  taskId:    string
  status:    VideoJobStatus
  videoUrl?: string
  progress?: number  // 0–1
  error?:    string
  createdAt: number
}

// Module-level store (survives across requests in the same Node process)
export const jobStore = new Map<string, VideoJob>()

function makeJobId(): string {
  return `vj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ── Request body type ─────────────────────────────────────────────────────────

interface GenerateBody {
  /** Visual prompt for the first scene or overall clip */
  prompt:          string
  /** 'kling' | 'runway' | 'auto' (default) */
  provider?:       'kling' | 'runway' | 'auto'
  duration?:       5 | 10
  aspectRatio?:    string
  negativePrompt?: string
  referenceImage?: string
  /** Kling-only tail frame */
  tailImage?:      string
  /** Kling model override */
  klingModel?:     KlingModel
  /** Runway model override */
  runwayModel?:    RunwayModel
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: GenerateBody
  try {
    body = await req.json() as GenerateBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.prompt?.trim()) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }

  const duration = (body.duration ?? 5) as 5 | 10

  // ── Provider selection ────────────────────────────────────────────────────
  let provider: 'kling' | 'runway' = 'kling'

  if (body.provider === 'runway') {
    if (!isRunwayConfigured()) {
      return NextResponse.json({ error: 'Runway is not configured (RUNWAY_API_KEY missing)' }, { status: 503 })
    }
    provider = 'runway'
  } else if (body.provider === 'kling' || body.provider === 'auto' || !body.provider) {
    if (isKlingConfigured()) {
      provider = 'kling'
    } else if (isRunwayConfigured()) {
      provider = 'runway'
    } else {
      return NextResponse.json(
        { error: 'No video provider configured. Set KLING_API_KEY or RUNWAY_API_KEY.' },
        { status: 503 },
      )
    }
  }

  // ── Submit generation task ────────────────────────────────────────────────
  let taskId: string | null = null
  let estimatedCostUsd = 0

  if (provider === 'kling') {
    const model = body.klingModel ?? 'kling-v2'
    taskId = await klingGenerate({
      prompt:         body.prompt,
      negativePrompt: body.negativePrompt,
      model,
      aspectRatio:    body.aspectRatio as KlingAspectRatio | undefined,
      duration,
      referenceImage: body.referenceImage,
      tailImage:      body.tailImage,
    })
    estimatedCostUsd = klingCost(duration, model)
  } else {
    const model = body.runwayModel ?? 'gen4_turbo'
    taskId = await runwayGenerate({
      prompt:         body.prompt,
      model,
      aspectRatio:    body.aspectRatio as RunwayAspectRatio | undefined,
      duration:       duration as RunwayDuration,
      referenceImage: body.referenceImage,
    })
    estimatedCostUsd = runwayCost(duration as RunwayDuration, model)
  }

  if (!taskId) {
    return NextResponse.json({ error: `${provider} generation failed to start` }, { status: 502 })
  }

  // ── Store job ─────────────────────────────────────────────────────────────
  const jobId = makeJobId()
  const job: VideoJob = {
    jobId,
    provider,
    taskId,
    status:    'queued',
    createdAt: Date.now(),
  }
  jobStore.set(jobId, job)

  return NextResponse.json({
    jobId,
    provider,
    taskId,
    estimatedDurationSec: duration,
    estimatedCostUsd,
  })
}
