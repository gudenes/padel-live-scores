'use client'
// src/components/GatedAnalytics.tsx
// Renders <Analytics /> from @vercel/analytics/react only when the user has
// NOT opted out. Opt-out state lives in localStorage under the key
// `pn_analytics_opt_out` — value `'1'` means opted out, anything else
// (including absent) means opted in. See spec §2.4 for rationale.
//
// Important: initial useState(true) means NO tracker on the first client
// render. After the effect reads localStorage, we flip to the real value.
// Server-rendered HTML never contains tracker markup, so there's no
// hydration mismatch either way.

import { useEffect, useState } from 'react'
import { Analytics } from '@vercel/analytics/react'

export function GatedAnalytics() {
  const [optOut, setOptOut] = useState(true)
  useEffect(() => {
    setOptOut(localStorage.getItem('pn_analytics_opt_out') === '1')
  }, [])
  if (optOut) return null
  return <Analytics />
}
