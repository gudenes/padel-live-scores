'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import type { Prediction, Pair, Margin } from '@/lib/predictions/types'
import { fetchAllPredictions, postPrediction, deletePrediction } from '@/lib/predictions/api-client'

const STORAGE_KEY = 'pn_match_predictions'

type LegacyPrediction = { pair: Pair; margin: Margin }

function readAllLocal(): Record<string, Prediction> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Prediction | LegacyPrediction>
    const out: Record<string, Prediction> = {}
    for (const [matchId, p] of Object.entries(parsed)) {
      if ('multiplier' in p && 'probability' in p) {
        out[matchId] = p as Prediction
      } else {
        out[matchId] = {
          matchId,
          pair: (p as LegacyPrediction).pair,
          margin: (p as LegacyPrediction).margin,
          probability: 0.5,
          multiplier: 2.0,
          isFallback: true,
          createdAt: new Date(0).toISOString(),
        }
      }
    }
    return out
  } catch { return {} }
}

function writeAllLocal(data: Record<string, Prediction>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch {}
}

// In-memory cache of authed user's predictions, keyed by match_id.
// Populated by the first useMatchPrediction call after auth load and shared
// across all hook instances on the page.
let authedCache: Record<string, Prediction> | null = null
let authedCacheLoading: Promise<Record<string, Prediction>> | null = null

async function loadAuthedCache(): Promise<Record<string, Prediction>> {
  if (authedCache) return authedCache
  if (authedCacheLoading) return authedCacheLoading
  authedCacheLoading = fetchAllPredictions().then(items => {
    authedCache = Object.fromEntries(items.map(p => [p.matchId, p]))
    authedCacheLoading = null
    return authedCache
  }).catch(err => {
    authedCacheLoading = null
    throw err
  })
  return authedCacheLoading
}

export type SetPredictionInput = Pick<Prediction, 'pair' | 'margin'>

export function useMatchPrediction(matchId: string) {
  const { status } = useSession()
  const isAuthed = status === 'authenticated'

  const [prediction, setPredictionState] = useState<Prediction | null>(() => {
    if (typeof window === 'undefined') return null
    return readAllLocal()[matchId] ?? null
  })

  // After auth resolves, prefer the DB cache. Falls back to local if fetch fails.
  useEffect(() => {
    let cancelled = false
    if (status === 'loading') return
    if (isAuthed) {
      loadAuthedCache()
        .then(cache => { if (!cancelled) setPredictionState(cache[matchId] ?? null) })
        .catch(() => { /* fall back to whatever's in local state */ })
    } else {
      // Logged out — read from localStorage.
      setPredictionState(readAllLocal()[matchId] ?? null)
    }
    return () => { cancelled = true }
  }, [status, isAuthed, matchId])

  const setPrediction = useCallback(
    async (p: SetPredictionInput) => {
      if (isAuthed) {
        try {
          const saved = await postPrediction({ matchId, pair: p.pair, margin: p.margin })
          if (authedCache) authedCache[matchId] = saved
          setPredictionState(saved)
          return
        } catch {
          // fall through to localStorage so the click isn't lost
        }
      }
      const all = readAllLocal()
      const full: Prediction = {
        matchId,
        pair: p.pair,
        margin: p.margin,
        probability: 0.5,        // overwritten by server on next fetch when authed
        multiplier: 2.0,
        isFallback: true,
        createdAt: new Date().toISOString(),
      }
      all[matchId] = full
      writeAllLocal(all)
      setPredictionState(full)
    },
    [matchId, isAuthed],
  )

  const clearPrediction = useCallback(async () => {
    if (isAuthed) {
      try {
        await deletePrediction(matchId)
        if (authedCache) delete authedCache[matchId]
        setPredictionState(null)
        return
      } catch {
        // fall through
      }
    }
    const all = readAllLocal()
    delete all[matchId]
    writeAllLocal(all)
    setPredictionState(null)
  }, [matchId, isAuthed])

  return { prediction, setPrediction, clearPrediction }
}

/** Read all predictions across matches (used by /picks). Synchronous for
 *  unauthed (localStorage); fetches DB for authed callers. */
export function readAllLocalPredictions(): Prediction[] {
  return Object.values(readAllLocal())
}

export async function readAllPredictionsAsync(isAuthed: boolean): Promise<Prediction[]> {
  if (!isAuthed) return readAllLocalPredictions()
  const cache = await loadAuthedCache()
  return Object.values(cache)
}

// Backward-compat alias used by any callers that haven't migrated yet.
export const readAllPredictions = readAllLocalPredictions
