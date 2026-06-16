'use client'
// useAgeGate — read/write the `pn_age_verified` localStorage entry (device-level
// 18+ gate). Mirrors useConsent: SSR-safe (state null until hydrated, so the
// server HTML never includes the gated widget), cross-instance sync via a custom
// event, cross-tab sync via the storage event.

import { useCallback, useEffect, useState } from 'react'
import {
  parseAgeVerification,
  serializeAgeVerification,
  type AgeVerification,
} from '@/lib/age-gate'

const STORAGE_KEY = 'pn_age_verified'
const AGE_GATE_EVENT = 'pn-age-gate-changed'

export function useAgeGate(): {
  state: AgeVerification | null
  hydrated: boolean
  decided: boolean
  verified: boolean
  setAgeVerification: (next: AgeVerification) => void
  clear: () => void
} {
  const [state, setState] = useState<AgeVerification | null>(null)
  const [hydrated, setHydrated] = useState(false)

  const readFromStorage = useCallback((): AgeVerification | null => {
    if (typeof window === 'undefined') return null
    let raw: string | null = null
    try {
      raw = localStorage.getItem(STORAGE_KEY)
    } catch {
      /* storage blocked → treat as undecided */
    }
    return parseAgeVerification(raw)
  }, [])

  useEffect(() => {
    // One-time hydration read of localStorage after mount — the canonical
    // SSR-safe pattern (state starts null on the server, syncs on the client).
    // Same approach as useConsent; the new react-hooks heuristic flags it as a
    // false positive for this subscribe-and-seed effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(readFromStorage())
    setHydrated(true)
    function onChanged() {
      setState(readFromStorage())
    }
    window.addEventListener(AGE_GATE_EVENT, onChanged)
    window.addEventListener('storage', onChanged)
    return () => {
      window.removeEventListener(AGE_GATE_EVENT, onChanged)
      window.removeEventListener('storage', onChanged)
    }
  }, [readFromStorage])

  const setAgeVerification = useCallback((next: AgeVerification) => {
    try {
      localStorage.setItem(STORAGE_KEY, serializeAgeVerification(next))
    } catch {
      /* storage blocked → memory only */
    }
    setState(next)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AGE_GATE_EVENT))
    }
  }, [])

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    setState(null)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AGE_GATE_EVENT))
    }
  }, [])

  const decided = hydrated && state !== null
  const verified = decided && state?.verified === true

  return { state, hydrated, decided, verified, setAgeVerification, clear }
}
