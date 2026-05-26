/**
 * Minimal Nexus service worker — PWA shell + offline fallback.
 *
 * v1 strategy (intentionally conservative):
 *   • PRE-CACHE the manifest, icon, and offline fallback page on install.
 *   • Network-first for everything else; cache the latest version of
 *     static assets opportunistically.
 *   • If a navigation request fails offline, serve the offline.html
 *     fallback so the PWA never lands on the browser's broken-page UI.
 *   • API routes are NEVER cached — they always go to the network and
 *     surface errors honestly (operator decisions should be made on
 *     fresh data, not stale).
 *
 * Versioning: bump CACHE_NAME on every meaningful SW change so old
 * clients self-evict. The "activate" handler purges anything not in
 * the current version.
 */

const CACHE_NAME = 'nexus-pwa-v1'
const PRECACHE = [
  '/manifest.webmanifest',
  '/icon.svg',
  '/offline.html',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
    )).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request

  // Only intercept GET; everything else (POST etc.) goes straight to network.
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // Never cache API routes — agents make decisions on fresh data.
  if (url.pathname.startsWith('/api/')) return

  // Network-first for navigation requests; fall back to offline shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/offline.html').then((r) => r ?? new Response('Offline', { status: 503 }))),
    )
    return
  }

  // Stale-while-revalidate for everything else (Next.js static chunks etc.)
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((networkRes) => {
        if (networkRes.ok) {
          const copy = networkRes.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy))
        }
        return networkRes
      }).catch(() => cached)
      return cached ?? fetchPromise
    }),
  )
})
