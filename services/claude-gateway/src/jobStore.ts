/**
 * In-memory async job store for the gateway.
 *
 * The synchronous `/api/sessions/:id/messages` endpoint blocks the caller
 * until the spawned `claude` CLI returns. That works fine for short prompts
 * but a Vercel function calling it has its own ~60–300s wall-clock cap, so
 * any generation that takes longer than that times out the HTTP path even
 * though the gateway itself is happy to keep running.
 *
 * `JobStore` solves that by decoupling enqueue from result fetch:
 *   POST /api/jobs       → enqueue, return jobId immediately (~50ms)
 *   GET  /api/jobs/:id   → poll status / fetch result when done
 *
 * Jobs live in memory on the single gateway process. Completed jobs are
 * retained for `RETAIN_MS` (default 10 min) so a slow client can still pick
 * up the result, then garbage-collected. The gateway is single-machine, so
 * no Redis / external store is needed — restarts drop in-flight jobs, which
 * is acceptable because they're triggered by user actions that can simply
 * be retried.
 */
import { randomUUID } from 'node:crypto'
import type { RunResult } from './spawn.js'

export type JobStatus = 'pending' | 'running' | 'done' | 'error'

export interface JobRecord {
  jobId:       string
  status:      JobStatus
  /** The agent slug the job runs under (may be null for plain prompts). */
  agentSlug:   string | null
  /** Free-form session tag the caller supplied — copied through for logs. */
  sessionTag:  string | null
  createdAt:   number
  startedAt?:  number
  finishedAt?: number
  /** Final result once status === 'done' or 'error'. */
  result?:     RunResult
}

export interface JobStoreOptions {
  /** Default 10 min — how long to keep finished jobs before GC. */
  retainMs?: number
  /** Default 60s — how often to sweep finished jobs. */
  sweepMs?:  number
}

export class JobStore {
  private readonly jobs = new Map<string, JobRecord>()
  private readonly retainMs: number
  private readonly sweepMs:  number
  private sweepTimer?: NodeJS.Timeout

  constructor(opts: JobStoreOptions = {}) {
    this.retainMs = opts.retainMs ?? 10 * 60_000
    this.sweepMs  = opts.sweepMs  ?? 60_000
    this.startSweep()
  }

  /** Create a new pending job and return its id. */
  create(args: { agentSlug: string | null; sessionTag: string | null }): string {
    const jobId = `job_${randomUUID()}`
    this.jobs.set(jobId, {
      jobId,
      status:     'pending',
      agentSlug:  args.agentSlug,
      sessionTag: args.sessionTag,
      createdAt:  Date.now(),
    })
    return jobId
  }

  markRunning(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job || job.status !== 'pending') return
    job.status    = 'running'
    job.startedAt = Date.now()
  }

  markDone(jobId: string, result: RunResult): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    job.status     = result.ok ? 'done' : 'error'
    job.finishedAt = Date.now()
    job.result     = result
  }

  markFailed(jobId: string, error: string): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    job.status     = 'error'
    job.finishedAt = Date.now()
    job.result     = {
      ok:         false,
      content:    '',
      error,
      durationMs: job.startedAt ? Date.now() - job.startedAt : 0,
    }
  }

  get(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId)
  }

  /** Test hook + introspection for /health if we ever want to expose it. */
  size(): number {
    return this.jobs.size
  }

  /** Stops the GC timer — for clean shutdown in tests. */
  stop(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = undefined
    }
  }

  private startSweep(): void {
    this.sweepTimer = setInterval(() => this.sweep(), this.sweepMs)
    // Don't keep the event loop alive solely for GC ticks.
    this.sweepTimer.unref?.()
  }

  private sweep(): void {
    const now = Date.now()
    for (const [id, job] of this.jobs) {
      if (!job.finishedAt) continue
      if (now - job.finishedAt > this.retainMs) this.jobs.delete(id)
    }
  }
}
