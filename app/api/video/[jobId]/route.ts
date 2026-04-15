/**
 * app/api/video/[jobId]/route.ts
 *
 * GET /api/video/[jobId]
 * Returns a Server-Sent Events stream that polls the upstream provider
 * (Kling or Runway) until the job succeeds, fails, or times out.
 *
 * Events emitted:
 *   data: { status, progress, videoUrl?, error? }
 *
 * The client should close the connection on "succeeded" or "failed".
 */

import { NextRequest } from 'next/server'
import { jobStore } from '../generate/route'
import type { VideoJob, VideoJobStatus } from '../generate/route'
import { getTask as klingGetTask }  from '@/lib/video/kling'
import { getTask as runwayGetTask } from '@/lib/video/runway'

export const runtime = 'nodejs'
export const maxDuration = 300  // 5 min — long enough for most generations

const POLL_INTERVAL_MS = 5_000
const MAX_WAIT_MS      = 600_000  // 10 min hard ceiling

function sseEvent(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params
  const job = jobStore.get(jobId)

  if (!job) {
    return new Response(
      sseEvent({ status: 'failed', error: 'Job not found' }),
      {
        status:  200,
        headers: {
          'Content-Type':  'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection:      'keep-alive',
        },
      },
    )
  }

  // If already terminal (cached from a previous poll), return immediately
  if (job.status === 'succeeded' || job.status === 'failed') {
    return new Response(
      sseEvent({ status: job.status, videoUrl: job.videoUrl, error: job.error }),
      {
        status:  200,
        headers: {
          'Content-Type':  'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection:      'keep-alive',
        },
      },
    )
  }

  // ── Streaming SSE loop ────────────────────────────────────────────────────
  const encoder  = new TextEncoder()
  const deadline = Date.now() + MAX_WAIT_MS

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(sseEvent(data)))
      }

      // Use a mutable reference so TypeScript doesn't narrow the status type
      const mutableJob: VideoJob = { ...job, status: 'processing' as VideoJobStatus }
      jobStore.set(jobId, mutableJob)

      while (Date.now() < deadline) {
        try {
          if (mutableJob.provider === 'kling') {
            const t = await klingGetTask(mutableJob.taskId)
            mutableJob.status   = t.status === 'succeed' ? 'succeeded'
                                : t.status === 'failed'  ? 'failed'
                                : 'processing'
            mutableJob.videoUrl = t.videoUrl
            mutableJob.error    = t.error
          } else {
            const t = await runwayGetTask(mutableJob.taskId)
            mutableJob.status   = t.status === 'SUCCEEDED'                            ? 'succeeded'
                                : (t.status === 'FAILED' || t.status === 'CANCELLED') ? 'failed'
                                : 'processing'
            mutableJob.videoUrl = t.videoUrl
            mutableJob.progress = t.progress
            mutableJob.error    = t.error
          }

          jobStore.set(jobId, mutableJob)

          send({
            status:   mutableJob.status,
            progress: mutableJob.progress,
            videoUrl: mutableJob.videoUrl,
            error:    mutableJob.error,
          })

          if (mutableJob.status === 'succeeded' || mutableJob.status === 'failed') break

        } catch (err) {
          send({ status: 'processing', error: String(err) })
        }

        // Wait before next poll
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
      }

      // Timed out
      if (mutableJob.status !== 'succeeded' && mutableJob.status !== 'failed') {
        mutableJob.status = 'failed'
        mutableJob.error  = 'Polling timed out after 10 minutes'
        jobStore.set(jobId, mutableJob)
        send({ status: 'failed', error: mutableJob.error })
      }

      controller.close()
    },
  })

  return new Response(stream, {
    status:  200,
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection:      'keep-alive',
    },
  })
}
