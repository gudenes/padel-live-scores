'use client'
// src/hooks/useWakeRefresh.ts
//
// Detects when the browser tab returns from being idle/backgrounded for
// longer than a threshold and runs a refetch callback. Used to recover
// from Supabase's "tab-throttling deadlock" where queries fired immediately
// after returning to the app hang on a stuck auth refresh lock.
//
// THE PROBLEM
// When a tab is backgrounded, Chrome aggressively throttles its timers
// (after ~5 minutes the tab is essentially frozen). If Supabase's GoTrue
// auth client started a token refresh just before the tab went idle, the
// internal mutex it uses can stay held forever — its release timer is
// throttled and never fires. The next query waiting on that mutex hangs
// indefinitely.
//
// We previously mitigated this with `withTimeout` wrappers on every query
// (so the spinner doesn't spin forever — it errors out after 10s). But the
// page is still left in a broken state until the user manually refreshes.
//
// THE FIX
// On `visibilitychange` to "visible", if the tab was hidden longer than
// `idleThresholdMs`, we:
//   1. Force-call `supabase.auth.getSession()` — this releases the stuck
//      mutex (it bails out cleanly if the lock is genuinely held by an
//      in-flight refresh, but in the deadlock case it triggers a fresh
//      session check which unblocks everything).
//   2. Run the page's `refetch` callback so the UI gets fresh data.
//
// USAGE
// ```
// const fetchData = useCallback(async () => { ... }, [])
// useEffect(() => { fetchData() }, [fetchData])
// useWakeRefresh(fetchData)
// ```

import { useEffect, useRef } from 'react'
import { refreshSessionIfNeeded } from '@/lib/supabase-health'

interface UseWakeRefreshOptions {
  /** How long the tab must have been hidden before we treat the next
   *  visibilityChange as a "wake" event. Default 30 seconds. */
  idleThresholdMs?: number
  /** Whether to also refresh the auth session before refetching.
   *  Default true. Set false if your refetch handles its own auth. */
  refreshSession?: boolean
}

export function useWakeRefresh(
  refetch: () => void | Promise<void>,
  opts: UseWakeRefreshOptions = {}
) {
  const idleThresholdMs = opts.idleThresholdMs ?? 30_000
  const refreshSession = opts.refreshSession ?? true

  // Hold the latest refetch in a ref so we don't re-bind the event listener
  // every time the page rerenders (which would also reset hiddenSince).
  const refetchRef = useRef(refetch)
  useEffect(() => { refetchRef.current = refetch }, [refetch])

  useEffect(() => {
    if (typeof document === 'undefined') return

    let hiddenSince: number | null = null

    async function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        hiddenSince = Date.now()
        return
      }
      // visible
      if (hiddenSince == null) return
      const hiddenForMs = Date.now() - hiddenSince
      hiddenSince = null
      if (hiddenForMs < idleThresholdMs) return

      console.log(`[useWakeRefresh] tab visible after ${Math.round(hiddenForMs / 1000)}s — refreshing`)

      if (refreshSession) {
        // refreshSessionIfNeeded handles its own timeout and only calls
        // refreshSession() when the token is actually close to expiring.
        // Cheap when the token is fresh, important when it's not.
        await refreshSessionIfNeeded('wake')
      }

      try {
        await refetchRef.current()
      } catch (e) {
        console.warn('[useWakeRefresh] refetch failed:', e)
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [idleThresholdMs, refreshSession])
}
