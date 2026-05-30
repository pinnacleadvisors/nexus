'use client'

/**
 * useRecommendAll — bounded-concurrency "do X for every item" runner.
 *
 * Extracted from the inline loop in AgentList.recommendAll so the Skills tab
 * (and any future list) can reuse the exact same fan-out discipline: a shared
 * queue drained by N workers (default 3) so a "Recommend models for all" click
 * doesn't fire one gateway request per row simultaneously. Per-item failures
 * are the caller's concern — `recommendOne` should swallow its own errors so a
 * single bad row doesn't abort the sweep (partial success is fine).
 */

import { useCallback, useState } from 'react'

export function useRecommendAll<T>(
  items: T[],
  recommendOne: (item: T) => Promise<void>,
  concurrency = 3,
): { runAll: () => Promise<void>; busy: boolean } {
  const [busy, setBusy] = useState(false)

  const runAll = useCallback(async () => {
    setBusy(true)
    try {
      const queue = [...items]
      const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
        for (;;) {
          const item = queue.shift()
          if (item === undefined) return
          await recommendOne(item)
        }
      })
      await Promise.all(workers)
    } finally {
      setBusy(false)
    }
  }, [items, recommendOne, concurrency])

  return { runAll, busy }
}
