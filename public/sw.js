// public/sw.js
// Service worker for Padel Nachos — handles web push notifications.

self.addEventListener('push', (event) => {
  if (!event.data) return

  const data = event.data.json()

  const options = {
    body: data.body ?? '',
    icon: '/padelnachos-logo-v2.png',
    badge: '/padelnachos-logo-v2.png',
    data: { url: data.url ?? '/v3' },
    vibrate: [100, 50, 100],
    tag: data.tag ?? 'match-live',
    renotify: true,
  }

  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Padel Nachos', options)
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const url = event.notification.data?.url ?? '/v3'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing tab if open
      for (const client of windowClients) {
        if (client.url.includes('/v3') || client.url.includes('/match/')) {
          client.navigate(url)
          return client.focus()
        }
      }
      // Otherwise open new tab
      return clients.openWindow(url)
    })
  )
})

// ── Precache ────────────────────────────────────────────────────
// Hard-coded list of brand assets we want available offline. Bump
// CACHE_VERSION any time a new asset is added so old caches are
// purged on activate. Keep this list short — it ships every SW
// install. Match cards / score data are network-only (cache-first
// would serve stale scores, which is worse than an offline banner).
const CACHE_VERSION = 'pn-shell-v1'
const PRECACHE_URLS = [
  '/offline',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/padelnachos-logo-v2.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// ── Fetch handler ──────────────────────────────────────────────
// Strategy:
//  - Navigation requests (HTML pages): network first, fall back to
//    the precached /offline page when network fails.
//  - All other requests (assets, API, images): just pass through to
//    the network. We deliberately do NOT cache match scores, API
//    responses, etc. — staleness here is worse than no offline.
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  // Navigation request = top-level page load
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('/offline').then((res) => res || new Response('Offline', { status: 503 }))
      )
    )
    return
  }
  // Static assets we precached — serve from cache when available
  if (PRECACHE_URLS.includes(new URL(req.url).pathname)) {
    event.respondWith(caches.match(req).then((res) => res || fetch(req)))
    return
  }
  // Everything else: pass through. No SW interference.
})
