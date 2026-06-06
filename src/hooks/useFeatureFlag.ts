'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchFeatureFlag, resolveFlag, type FlagKey } from '@/lib/feature-flags'

/**
 * Client hook for a DB-backed feature flag. Reads the `feature_flags` row
 * (public-read RLS) and resolves production vs local by hostname via
 * resolveFlag(). Returns false until the fetch resolves (safe default).
 */
export function useFeatureFlag(key: FlagKey): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetchFeatureFlag(supabase, key).then((row) => {
      if (!cancelled) setEnabled(resolveFlag(row))
    })
    return () => {
      cancelled = true
    }
  }, [key])
  return enabled
}
