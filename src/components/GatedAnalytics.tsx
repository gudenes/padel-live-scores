'use client'
// src/components/GatedAnalytics.tsx
// Renders <Analytics /> from @vercel/analytics/react only when the user
// has consented to analytics via the cookie banner.
//
// SSR + initial-render safety: useConsent's hasDecided defaults to false
// on the server and on the first client render before the localStorage
// read effect runs. So we never render the tracker before consent state
// is known — server-rendered HTML never includes tracker markup.

import { Analytics } from '@vercel/analytics/react'
import { useConsent } from '@/hooks/useConsent'

export function GatedAnalytics() {
  const { isAnalyticsAllowed } = useConsent()
  if (!isAnalyticsAllowed()) return null
  return <Analytics />
}
