'use client'
// src/lib/predictions/api-client.ts
//
// Thin fetch wrappers used by the auth-aware useMatchPrediction hook.
// Throws on network errors and on non-2xx so the hook can fall back.

import type { Prediction, Pair, Margin } from './types'

interface ServerPredictionRow {
  match_id: string
  pair: number
  margin: string
  probability: number
  multiplier: number
  is_fallback: boolean
  result: string | null
  reward: number | null
  resolved_at: string | null
  created_at: string
}

function toPrediction(r: ServerPredictionRow): Prediction {
  return {
    matchId: r.match_id,
    pair: r.pair as Pair,
    margin: r.margin as Margin,
    probability: r.probability,
    multiplier: r.multiplier,
    isFallback: r.is_fallback,
    createdAt: r.created_at,
  }
}

export async function fetchAllPredictions(): Promise<Prediction[]> {
  const res = await fetch('/api/predictions', { cache: 'no-store' })
  if (!res.ok) throw new Error(`fetch_predictions_${res.status}`)
  const body = await res.json() as { items: ServerPredictionRow[] }
  return body.items.map(toPrediction)
}

export async function postPrediction(input: { matchId: string; pair: Pair; margin: Margin }): Promise<Prediction> {
  const res = await fetch('/api/predictions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `post_prediction_${res.status}`)
  }
  return toPrediction(await res.json())
}

export async function deletePrediction(matchId: string): Promise<void> {
  const res = await fetch(`/api/predictions/${encodeURIComponent(matchId)}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `delete_prediction_${res.status}`)
  }
}
