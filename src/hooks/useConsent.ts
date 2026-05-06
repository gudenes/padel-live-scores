'use client'
// useConsent — read/write the pn_consent localStorage entry.
//
// SSR safety: useState defaults to null + hasDecided=false, so the
// server-rendered HTML never includes consent-gated tracker markup.
// On mount, the effect reads localStorage (incl. legacy migration)
// and re-renders with the real state.

import { useCallback, useEffect, useState } from 'react'
import {
  parseConsent,
  serializeConsent,
  isExpired,
  migrateLegacy,
  type ConsentState,
} from '@/lib/consent'

const STORAGE_KEY = 'pn_consent'
const LEGACY_KEY = 'pn_analytics_opt_out'

// Custom event so multiple instances of the hook stay in sync after a
// banner save. Avoids prop-drilling or context for what's effectively
// a global singleton state.
const CONSENT_EVENT = 'pn-consent-changed'

export function useConsent(): {
  consent: ConsentState | null
  hasDecided: boolean
  setConsent: (next: ConsentState) => void
  isAnalyticsAllowed: () => boolean
  isPushAllowed: () => boolean
} {
  const [consent, setConsentState] = useState<ConsentState | null>(null)
  const [hydrated, setHydrated] = useState(false)

  const readFromStorage = useCallback((): ConsentState | null => {
    if (typeof window === 'undefined') return null
    let raw: string | null = null
    let legacy: string | null = null
    try {
      raw = localStorage.getItem(STORAGE_KEY)
      legacy = localStorage.getItem(LEGACY_KEY)
    } catch {
      /* localStorage blocked → treat as no consent */
    }

    const parsed = parseConsent(raw)
    if (parsed) return parsed

    const migrated = migrateLegacy(raw, legacy)
    if (migrated) {
      try {
        localStorage.setItem(STORAGE_KEY, serializeConsent(migrated))
      } catch {
        /* storage blocked → state lives in memory only */
      }
      return migrated
    }
    return null
  }, [])

  // Initial read on mount + listen for cross-component updates.
  useEffect(() => {
    setConsentState(readFromStorage())
    setHydrated(true)

    function onChanged() {
      setConsentState(readFromStorage())
    }
    window.addEventListener(CONSENT_EVENT, onChanged)
    // Also catch updates from other tabs.
    window.addEventListener('storage', onChanged)
    return () => {
      window.removeEventListener(CONSENT_EVENT, onChanged)
      window.removeEventListener('storage', onChanged)
    }
  }, [readFromStorage])

  const setConsent = useCallback((next: ConsentState) => {
    try {
      localStorage.setItem(STORAGE_KEY, serializeConsent(next))
    } catch {
      /* storage blocked → state lives in memory only */
    }
    setConsentState(next)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(CONSENT_EVENT))
    }
  }, [])

  const hasDecided =
    hydrated &&
    consent !== null &&
    !isExpired(consent.decided_at, Date.now())

  const isAnalyticsAllowed = useCallback(() => {
    return hasDecided && consent !== null && consent.analytics === true
  }, [hasDecided, consent])

  const isPushAllowed = useCallback(() => {
    return hasDecided && consent !== null && consent.push === true
  }, [hasDecided, consent])

  return { consent, hasDecided, setConsent, isAnalyticsAllowed, isPushAllowed }
}
