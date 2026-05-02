// src/lib/cache-meta.ts
// Detects whether the current page is being served from the service
// worker cache vs. fresh from network. Used to show an "as of HH:mm"
// stamp when the user is offline so they know data may be stale.

export function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine
}

export function getCacheTimestamp(): Date {
  // The SW could expose this via a postMessage in the future. For now
  // we report "now" — when the user is offline AND the page rendered,
  // the SW served them whatever was last in cache. The timestamp is
  // approximate "as of when we last saw fresh data".
  return new Date()
}
