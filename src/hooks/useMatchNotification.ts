'use client'

import { useCallback, useEffect, useState } from 'react'

export const NOTIFIED_STORAGE_KEY = 'pn_notified_matches'

export function readNotifiedMatches(): Set<string> {
  try {
    const raw = (typeof localStorage === 'undefined' ? null : localStorage.getItem(NOTIFIED_STORAGE_KEY))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is string => typeof v === 'string'))
  } catch {
    return new Set()
  }
}

export function writeNotifiedMatches(ids: Set<string>): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(NOTIFIED_STORAGE_KEY, JSON.stringify([...ids]))
  } catch {}
}

export function toggleNotifiedMatch(id: string): Set<string> {
  const next = new Set(readNotifiedMatches())
  if (next.has(id)) next.delete(id)
  else next.add(id)
  writeNotifiedMatches(next)
  return next
}

export function useMatchNotification(matchId: string): {
  isNotifying: boolean
  toggleNotify: () => void
} {
  const [ids, setIds] = useState<Set<string>>(() => new Set())

  // Hydrate after mount to avoid SSR/client mismatch
  useEffect(() => { setIds(readNotifiedMatches()) }, [])

  const toggleNotify = useCallback(() => {
    const next = toggleNotifiedMatch(matchId)
    setIds(next)
  }, [matchId])

  return { isNotifying: ids.has(matchId), toggleNotify }
}
