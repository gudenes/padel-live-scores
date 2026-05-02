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
// purged on activate. Match cards / score data are network-only —
// cache-first would serve stale scores, which is worse than an
// offline banner. /offline is precached for every supported locale
// (next-intl `localePrefix: 'as-needed'` — English has no prefix).
const CACHE_VERSION = 'pn-shell-v2'
const PRECACHE_URLS = [
  '/offline',         // en (default — no prefix)
  '/es/offline',
  '/pt/offline',
  '/it/offline',
  '/fr/offline',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/padelnachos-logo-v2.png',
]
const PRECACHE_SET = new Set(PRECACHE_URLS)

self.addEventListener('install', (event) => {
  // Use Promise.allSettled so a single 404 (e.g. a locale page that
  // hasn't been built yet) doesn't take down the whole install — which
  // would also break push notifications.
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] precache miss:', url, err)
          }),
        ),
      ),
    ).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// Pick the precached /offline page that matches the request's locale
// prefix. Falls back to the English page when there's no prefix.
function offlineUrlFor(reqUrl) {
  const path = new URL(reqUrl).pathname
  const m = path.match(/^\/(es|pt|it|fr)(\/|$)/)
  return m ? `/${m[1]}/offline` : '/offline'
}

// ── Fetch handler ──────────────────────────────────────────────
// Navigation requests: network first, fall back to the locale-aware
// precached /offline page. Precached static assets: cache-first.
// Everything else: pass through (no SW interference) — we deliberately
// don't cache match scores or API responses, staleness is worse than
// no offline.
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  // Navigation request = top-level page load
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(offlineUrlFor(req.url)).then((res) =>
          res || caches.match('/offline').then((res2) =>
            res2 || new Response('Offline', {
              status: 503,
              headers: { 'Content-Type': 'text/html' },
            })
          )
        )
      )
    )
    return
  }
  // Static assets we precached — serve from cache when available.
  // Guard the URL parse against cross-origin requests that could throw.
  if (req.url.startsWith(self.location.origin)) {
    const path = new URL(req.url).pathname
    if (PRECACHE_SET.has(path)) {
      event.respondWith(caches.match(req).then((res) => res || fetch(req)))
      return
    }
  }
  // Everything else: pass through. No SW interference.
})
