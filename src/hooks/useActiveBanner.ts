// src/hooks/useActiveBanner.ts
'use client'

import { useEffect, useState } from 'react'
import type { AdBanner, AdNetworkConfig } from '@/lib/ad-banner-resolver'

interface ActiveAds {
  banners: AdBanner[]
  network: AdNetworkConfig | null
}

// Module-level cache per slot so navigation between pages doesn't refetch.
const cache = new Map<string, ActiveAds>()
const inflight = new Map<string, Promise<ActiveAds>>()

function load(slot: string): Promise<ActiveAds> {
  const cached = cache.get(slot)
  if (cached) return Promise.resolve(cached)
  const existing = inflight.get(slot)
  if (existing) return existing
  const p = fetch(`/api/ads/active?slot=${encodeURIComponent(slot)}`)
    .then((r) => (r.ok ? r.json() : { banners: [], network: null }))
    .then((data: ActiveAds) => {
      cache.set(slot, data)
      inflight.delete(slot)
      return data
    })
    .catch(() => {
      inflight.delete(slot)
      return { banners: [], network: null } as ActiveAds
    })
  inflight.set(slot, p)
  return p
}

/** Fetch active banners + network config for a slot. Returns null until loaded. */
export function useActiveBanner(slot: string): ActiveAds | null {
  const [data, setData] = useState<ActiveAds | null>(() => cache.get(slot) ?? null)
  useEffect(() => {
    if (data) return
    let alive = true
    void load(slot).then((d) => {
      if (alive) setData(d)
    })
    return () => {
      alive = false
    }
  }, [slot, data])
  return data
}
