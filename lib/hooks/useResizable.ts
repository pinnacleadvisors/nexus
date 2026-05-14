'use client'

/**
 * useResizable — hook for drag-to-resize panels with persistence.
 *
 * Returns:
 *   width      — current pixel width (capped to min/max)
 *   handleProps — spread onto a thin draggable strip (the handle)
 *   onSnap     — callback if width crosses the collapse threshold while
 *                dragging (parent decides what to do; usually fully collapses)
 *
 * Persistence: width is saved to localStorage under `key` after every drag.
 * Read on mount so the layout survives reloads.
 *
 * Snap-to-collapse: when the operator drags below `collapseAtPx` the snap
 * fires. The parent collapses the panel (or it stays at min — choose
 * behaviour per call-site). Dragging back above re-opens.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export type ResizeEdge = 'right' | 'left'

interface UseResizableOpts {
  /** localStorage key for persistence. */
  key:           string
  /** Default width when nothing is persisted. */
  defaultPx:     number
  /** Hard lower bound — drag below this clamps. */
  minPx:         number
  /** Hard upper bound — drag above this clamps. */
  maxPx:         number
  /** Which edge of the panel the handle sits on. Determines drag direction. */
  edge:          ResizeEdge
  /** Optional — when set, dragging below this width triggers `onSnap`. */
  collapseAtPx?: number
  /** Fired when the drag falls below `collapseAtPx`. Parent decides what to do. */
  onSnap?:       () => void
}

interface UseResizableReturn {
  width:        number
  setWidth:     (w: number) => void
  isDragging:   boolean
  handleProps:  {
    onMouseDown: (e: React.MouseEvent) => void
    onDoubleClick: () => void
    style:       React.CSSProperties
    'aria-label':  string
    'aria-orientation': 'vertical'
    role:        'separator'
  }
}

function readPersisted(key: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : fallback
  } catch { return fallback }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export function useResizable(opts: UseResizableOpts): UseResizableReturn {
  const [width, setWidthState] = useState<number>(() => clamp(readPersisted(opts.key, opts.defaultPx), opts.minPx, opts.maxPx))
  const [isDragging, setIsDragging] = useState(false)
  const startXRef     = useRef(0)
  const startWidthRef = useRef(width)
  const snappedRef    = useRef(false)

  const setWidth = useCallback((next: number) => {
    const clamped = clamp(next, opts.minPx, opts.maxPx)
    setWidthState(clamped)
    try { window.localStorage.setItem(opts.key, String(clamped)) } catch { /* quota */ }
  }, [opts.key, opts.minPx, opts.maxPx])

  // Reset to default on double-click — easy "I lost my layout" recovery.
  const resetToDefault = useCallback(() => setWidth(opts.defaultPx), [setWidth, opts.defaultPx])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    startXRef.current     = e.clientX
    startWidthRef.current = width
    snappedRef.current    = false
  }, [width])

  useEffect(() => {
    if (!isDragging) return
    function onMove(e: MouseEvent) {
      const dx = e.clientX - startXRef.current
      const delta = opts.edge === 'right' ? dx : -dx     // left-edge handle inverts
      const next = startWidthRef.current + delta
      const clamped = clamp(next, opts.minPx, opts.maxPx)
      setWidthState(clamped)
      if (opts.collapseAtPx && !snappedRef.current && next < opts.collapseAtPx) {
        snappedRef.current = true
        opts.onSnap?.()
      } else if (opts.collapseAtPx && snappedRef.current && next >= opts.collapseAtPx) {
        snappedRef.current = false   // re-arm if they drag back up
      }
    }
    function onUp() {
      setIsDragging(false)
      // Persist on release (avoids hammering localStorage on every mousemove).
      try { window.localStorage.setItem(opts.key, String(width)) } catch { /* quota */ }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
    document.body.style.cursor    = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
      document.body.style.cursor    = ''
      document.body.style.userSelect = ''
    }
  // `width` deliberately omitted — the live width is read from startWidthRef + dx,
  // not from the state value, so the closure stays stable across the drag.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, opts.edge, opts.minPx, opts.maxPx, opts.collapseAtPx, opts.onSnap, opts.key])

  return {
    width,
    setWidth,
    isDragging,
    handleProps: {
      onMouseDown,
      onDoubleClick: resetToDefault,
      role:               'separator',
      'aria-orientation': 'vertical',
      'aria-label':       'Drag to resize (double-click to reset)',
      style: {
        position:   'absolute',
        top:        0,
        bottom:     0,
        width:      '6px',
        cursor:     'col-resize',
        zIndex:     20,
        background: 'transparent',
        ...(opts.edge === 'right' ? { right: '-3px' } : { left: '-3px' }),
      },
    },
  }
}
