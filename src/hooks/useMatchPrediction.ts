'use client'

import { useState, useCallback } from 'react'
import type { Prediction, Pair, Margin } from '@/lib/predictions/types'

const STORAGE_KEY = 'pn_match_predictions'

/** Legacy shape we may find in localStorage from before the multiplier
 *  economy shipped. We migrate forward on read by treating these as
 *  toss-up fallbacks (probability 0.5, multiplier 2.0). */
type LegacyPrediction = { pair: Pair; margin: Margin }

function readAll(): Record<string, Prediction> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Prediction | LegacyPrediction>

    const migrated: Record<string, Prediction> = {}
    for (const [matchId, p] of Object.entries(parsed)) {
      if ('multiplier' in p && 'probability' in p) {
        migrated[matchId] = p as Prediction
      } else {
        // Legacy record — promote to toss-up so it remains usable.
        migrated[matchId] = {
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
    return migrated
  } catch {
    return {}
  }
}

function writeAll(data: Record<string, Prediction>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {}
}

export type SetPredictionInput = Omit<Prediction, 'matchId' | 'createdAt'>

export function useMatchPrediction(matchId: string) {
  const [prediction, setPredictionState] = useState<Prediction | null>(() => {
    return readAll()[matchId] ?? null
  })

  const setPrediction = useCallback(
    (p: SetPredictionInput) => {
      const all = readAll()
      const full: Prediction = {
        ...p,
        matchId,
        createdAt: new Date().toISOString(),
      }
      all[matchId] = full
      writeAll(all)
      setPredictionState(full)
    },
    [matchId],
  )

  const clearPrediction = useCallback(() => {
    const all = readAll()
    delete all[matchId]
    writeAll(all)
    setPredictionState(null)
  }, [matchId])

  return { prediction, setPrediction, clearPrediction }
}

/** Read all predictions across matches (used by /picks page). */
export function readAllPredictions(): Prediction[] {
  return Object.values(readAll())
}
