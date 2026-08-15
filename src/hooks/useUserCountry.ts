'use client'
// src/hooks/useUserCountry.ts
//
// Resolves the current user's region for region-specific features
// (broadcaster lists, content recommendations, etc.).
//
// Resolution order:
//   1. Logged-in user's profile.preferred_country (manual override)
//   2. geo-country cookie (set by proxy from Cloudflare/Vercel geo headers)
//   3. null (= "global only", page falls back to non-regional content)
//
// All return values are normalized to lowercase 2-letter ISO codes.

import { useMemo } from 'react'
import { useAuth } from '@/components/AuthProvider'

export function useUserCountry(): string | null {
  const { profile } = useAuth()

  return useMemo(() => {
    // 1. Profile override wins (only available for logged-in users)
    const profileCountry = (profile as { preferred_country?: string | null } | null)?.preferred_country
    if (profileCountry && typeof profileCountry === 'string') {
      return profileCountry.toLowerCase()
    }

    // 2. geo-country cookie from middleware
    if (typeof document !== 'undefined') {
      const match = document.cookie.match(/(?:^|;\s*)geo-country=([^;]+)/)
      if (match) return match[1].toLowerCase()
    }

    // 3. Unknown
    return null
  }, [profile])
}
