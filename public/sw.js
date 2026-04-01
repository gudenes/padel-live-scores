// public/sw.js
// Service worker for PadelNacho — handles web push notifications.

self.addEventListener('push', (event) => {
  if (!event.data) return

  const data = event.data.json()

  const options = {
    body: data.body ?? '',
    icon: '/padel-nacho-logo.png',
    badge: '/padel-nacho-logo.png',
    data: { url: data.url ?? '/v2' },
    vibrate: [100, 50, 100],
    tag: data.tag ?? 'match-live',
    renotify: true,
  }

  event.waitUntil(
    self.registration.showNotification(data.title ?? 'PadelNacho', options)
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const url = event.notification.data?.url ?? '/v2'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing tab if open
      for (const client of windowClients) {
        if (client.url.includes('/v2') || client.url.includes('/match/')) {
          client.navigate(url)
          return client.focus()
        }
      }
      // Otherwise open new tab
      return clients.openWindow(url)
    })
  )
})
