'use client'

import { useState, useCallback } from 'react'

const STORAGE_KEY = 'pn_match_predictions'

export type Prediction = {
  pair: 1 | 2
  margin: '2-0' | '2-1'
}

function readAll(): Record<string, Prediction> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeAll(data: Record<string, Prediction>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {}
}

export function useMatchPrediction(matchId: string) {
  const [prediction, setPredictionState] = useState<Prediction | null>(() => {
    try {
      return readAll()[matchId] ?? null
    } catch {
      return null
    }
  })

  const setPrediction = useCallback((p: Prediction) => {
    const all = readAll()
    all[matchId] = p
    writeAll(all)
    setPredictionState(p)
  }, [matchId])

  const clearPrediction = useCallback(() => {
    const all = readAll()
    delete all[matchId]
    writeAll(all)
    setPredictionState(null)
  }, [matchId])

  return { prediction, setPrediction, clearPrediction }
}
