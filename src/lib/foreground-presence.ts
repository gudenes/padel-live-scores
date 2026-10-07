/** Client lifecycle only: no requests while a tab or native app is backgrounded. */
export function startForegroundPresence(deps: {
  document: Pick<
    Document,
    'hidden' | 'hasFocus' | 'addEventListener' | 'removeEventListener'
  >
  window: Pick<Window, 'addEventListener' | 'removeEventListener'>
  ping: () => Promise<unknown>
  native: boolean
  now?: () => number
}) {
  const now = deps.now ?? Date.now
  let stopped = false,
    pending = false,
    lastSent = -Infinity,
    nativeActive = !deps.native
  const pulse = async () => {
    if (
      stopped ||
      pending ||
      deps.document.hidden ||
      !nativeActive ||
      (!deps.native && !deps.document.hasFocus()) ||
      now() - lastSent < 60000
    )
      return
    pending = true
    try {
      await deps.ping()
      lastSent = now()
    } catch {
      /* Retry on the next visible pulse. */
    } finally {
      pending = false
    }
  }
  const visibility = () => {
    void pulse()
  }
  deps.document.addEventListener('visibilitychange', visibility)
  deps.window.addEventListener('focus', visibility)
  const timer = setInterval(visibility, 60000)
  void pulse()
  return {
    setNativeActive(active: boolean) {
      nativeActive = active
      if (active) void pulse()
    },
    stop() {
      stopped = true
      clearInterval(timer)
      deps.document.removeEventListener('visibilitychange', visibility)
      deps.window.removeEventListener('focus', visibility)
    },
  }
}
