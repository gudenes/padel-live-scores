'use client'
// src/app/[locale]/(app)/play/_components/usePlayData.ts
//
// Thin fetch layer over the /api/play/* routes.
//
// Contract with the rest of this feature: a non-OK response, a network
// failure, or a body that does not parse all resolve to status 'error'.
// There is no sample-data fallback anywhere in Play — the mockup's
// hard-coded MARKETS / POSITIONS / ACTIVITY / LEADERS arrays were
// deliberately not ported. A market that does not exist must look like a
// market that does not exist.

import { useCallback, useEffect, useRef, useState } from 'react'

export type LoadStatus = 'loading' | 'ready' | 'error'

export interface Resource<T> {
  data: T | null
  status: LoadStatus
  reload: () => void
}

/**
 * Fetch + parse a JSON endpoint.
 *
 * `enabled` defers the request until the screen is actually opened — the
 * deck is the landing screen, and there is no reason to hit the activity
 * feed and the leaderboard for a user who never taps those tabs.
 */
export function useApiResource<T>(
  url: string | null,
  parse: (payload: unknown) => T,
  enabled = true,
  pollMs = 0,
): Resource<T> {
  const [nonce, setNonce] = useState(0)
  // One piece of state holding the result AND the request it belongs to.
  // Keeping them together is what lets "loading" be DERIVED during render
  // (`result.key !== key`) instead of being set from inside the effect —
  // which would be a cascading render, and which also used to leave the
  // previous URL's rows on screen for a frame after the URL changed.
  const [result, setResult] = useState<{ key: string; data: T | null; status: LoadStatus }>({
    key: '',
    data: null,
    status: 'loading',
  })
  const key = `${url ?? ''}|${nonce}`

  // Guards against a slow request resolving after a newer one and
  // overwriting fresher data.
  const requestRef = useRef(0)
  // Held in a ref so a caller passing an inline parse function cannot
  // re-trigger the fetch on every render. Initialised by useRef and kept
  // fresh by an effect — never assigned during render.
  const parseRef = useRef(parse)
  useEffect(() => {
    parseRef.current = parse
  }, [parse])

  useEffect(() => {
    if (!enabled || !url) return
    const seq = ++requestRef.current
    let cancelled = false

    let pending = false
    const controller = new AbortController()
    const refresh = () => {
      if (pending) return
      pending = true
      fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`${url} → ${res.status}`)
          return res.json()
        })
        .then((payload: unknown) => {
          if (cancelled || seq !== requestRef.current) return
          setResult({ key, data: parseRef.current(payload), status: 'ready' })
        })
        .catch(() => {
          if (cancelled || seq !== requestRef.current) return
          setResult(previous => previous.key === key && previous.data ? previous : { key, data: null, status: 'error' })
        }).finally(() => { pending = false })
    }
    refresh()
    const visibleRefresh = () => { if (!document.hidden) refresh() }
    const timer = pollMs ? setInterval(visibleRefresh, pollMs) : null
    if (pollMs) document.addEventListener('visibilitychange', visibleRefresh)
    return () => {
      cancelled = true
      controller.abort()
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', visibleRefresh)
    }
  }, [url, enabled, key, pollMs])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  const fresh = result.key === key
  return {
    data: fresh ? result.data : null,
    status: fresh ? result.status : 'loading',
    reload,
  }
}
