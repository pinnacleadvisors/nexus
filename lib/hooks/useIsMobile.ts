'use client'

/**
 * useIsMobile — viewport-width hook with Tailwind-matched breakpoints.
 *
 * Recommendation H from the agent-process audit. Replaces the four
 * scattered `window.matchMedia('(max-width: NNNpx)')` calls in
 * Sidebar, ViewsPanel, ApprovalCard, and MobileAwareSessionSidebar
 * with one named-breakpoint API.
 *
 * Pixel values match Tailwind 4's default breakpoints. If we ever
 * customise them in `app/globals.css` `@theme inline`, update here
 * in lockstep — the hook is the single bridge between CSS responsive
 * classes and JS conditional rendering.
 *
 * SSR-safe: returns `false` on the server render (mobile vs desktop
 * isn't knowable without a browser), then flips to the real value
 * once mounted. Components that NEED the right answer on first paint
 * (e.g. Vaul drawer vs. desktop panel) should follow ViewsPanel's
 * pattern — render a stable wrapper, swap presentation post-mount.
 */

import { useEffect, useState } from 'react'

/**
 * Tailwind 4 breakpoint pixel values. Matches the default values
 * documented at https://tailwindcss.com/docs/responsive-design and
 * the tokens declared in `app/globals.css @theme inline`.
 *
 * Used by the hook to build the `(max-width: <px-1>px)` query.
 */
export const BREAKPOINT_PX = {
  sm: 640,   // ≥ sm: phone landscape / tablet portrait
  md: 768,   // ≥ md: tablet landscape / small laptop
  lg: 1024,  // ≥ lg: laptop
  xl: 1280,  // ≥ xl: desktop
} as const

export type Breakpoint = keyof typeof BREAKPOINT_PX

/**
 * Returns true when `window.innerWidth < BREAKPOINT_PX[breakpoint]`.
 * Defaults to `'md'` (true when width < 768px) — the operator's
 * canonical mobile split for the chat surfaces.
 *
 * Re-fires on resize via `matchMedia('change')` — no `resize` event
 * polling, no debouncing required.
 *
 * Use named breakpoints (`'sm' | 'md' | 'lg' | 'xl'`) rather than raw
 * pixel values so changes to the Tailwind theme flow through one place.
 */
export function useIsMobile(breakpoint: Breakpoint = 'md'): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const px = BREAKPOINT_PX[breakpoint]
    // `(max-width: Npx)` is inclusive: it matches viewport widths ≤ N.
    // So to mean "less than the breakpoint" we use px - 1 — matches the
    // pre-hook callsites which used 639px and 767px (one below sm/md).
    const mq = window.matchMedia(`(max-width: ${px - 1}px)`)
    function update() { setIsMobile(mq.matches) }
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [breakpoint])

  return isMobile
}
