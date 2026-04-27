/**
 * Single-worker FIFO queue. The Max plan is one identity, so we serialise
 * concurrent dispatches into a single claude CLI process at a time. When the
 * queue is full we reject with QueueFullError so callers fail fast rather
 * than holding sockets open.
 */

export class QueueFullError extends Error {
  constructor(public depth: number, public maxDepth: number) {
    super(`gateway queue full (${depth}/${maxDepth})`)
    this.name = 'QueueFullError'
  }
}

interface PendingItem<T> {
  fn:       () => Promise<T>
  resolve:  (v: T) => void
  reject:   (err: unknown) => void
}

export class WorkQueue {
  private pending: PendingItem<unknown>[] = []
  private running = false
  private inFlight = 0

  constructor(private readonly maxDepth: number) {}

  get depth(): number {
    return this.pending.length + this.inFlight
  }

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    if (this.depth >= this.maxDepth) {
      return Promise.reject(new QueueFullError(this.depth, this.maxDepth))
    }
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ fn: fn as () => Promise<unknown>, resolve: resolve as (v: unknown) => void, reject })
      void this.drain()
    })
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.pending.length) {
        const next = this.pending.shift()!
        this.inFlight = 1
        try {
          const value = await next.fn()
          next.resolve(value)
        } catch (err) {
          next.reject(err)
        } finally {
          this.inFlight = 0
        }
      }
    } finally {
      this.running = false
    }
  }
}
