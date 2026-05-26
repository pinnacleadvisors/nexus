'use client'

/**
 * Registers /sw.js on first mount. No-op in dev (LOCAL_MODE) when the
 * service worker would mostly get in the way of HMR.
 *
 * Renders nothing; mounted once in app/layout.tsx so every authenticated
 * page benefits.
 */

import { useEffect } from 'react'

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return

    // Register at the next animation frame so we don't block first paint.
    const id = window.requestAnimationFrame(() => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[pwa] sw register failed:', err)
        }
      })
    })
    return () => window.cancelAnimationFrame(id)
  }, [])

  return null
}
