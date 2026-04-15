'use client'

import { useState, useCallback, useEffect } from 'react'
const RATINGS_KEY = 'pn_match_ratings'
const DEVICE_ID_KEY = 'pn_device_id'

function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(DEVICE_ID_KEY, id)
    }
    return id
  } catch {
    return crypto.randomUUID()
  }
}

function readAllLocal(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RATINGS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeLocal(matchId: string, rating: number) {
  try {
    const all = readAllLocal()
    all[matchId] = rating
    localStorage.setItem(RATINGS_KEY, JSON.stringify(all))
  } catch {}
}

export interface RatingState {
  rating: number | null
  avgRating: number | null
  ratingCount: number
  setRating: (n: number) => void
}

export function useMatchRating(matchId: string, matchAvg?: number | null, matchCount?: number): RatingState {
  const [rating, setRatingState] = useState<number | null>(() => {
    try { return readAllLocal()[matchId] ?? null } catch { return null }
  })
  const [avgRating, setAvgRating] = useState<number | null>(matchAvg ?? null)
  const [ratingCount, setRatingCount] = useState<number>(matchCount ?? 0)

  // Sync if match-level stats change (e.g., after refetch)
  useEffect(() => {
    if (matchAvg !== undefined) setAvgRating(matchAvg ?? null)
    if (matchCount !== undefined) setRatingCount(matchCount ?? 0)
  }, [matchAvg, matchCount])

  const setRating = useCallback(async (n: number) => {
    setRatingState(n)
    writeLocal(matchId, n)

    try {
      const deviceId = getDeviceId()
      const res = await fetch('/api/match-rating', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId, rating: n, deviceId }),
      })

      if (res.ok) {
        const data = await res.json()
        setAvgRating(data.avg_rating ?? null)
        setRatingCount(data.rating_count ?? 0)
      }
    } catch (e) {
      console.error('[useMatchRating] API write failed:', e)
    }
  }, [matchId])

  return { rating, avgRating, ratingCount, setRating }
}

// Export for migration in AuthProvider
export { readAllLocal as readAllRatings, RATINGS_KEY, DEVICE_ID_KEY }
