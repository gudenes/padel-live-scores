'use client'

import { Match } from '@/types/match'
import { PredictionPanel } from '@/components/prediction/PredictionPanel'

export function PredictionSection({ match }: {
  match: Match
  pair1Label?: string
  pair2Label?: string
  prediction?: unknown
  predStep?: unknown
  setPredStep?: unknown
  setPrediction?: unknown
  clearPrediction?: unknown
}) {
  return (
    <div style={{ background: '#141414', borderBottom: '0.5px solid rgba(255,255,255,0.06)', padding: 16 }}>
      <PredictionPanel match={match} />
    </div>
  )
}

export function PredictionResult({ match }: { match: Match; prediction?: unknown; pair1Label?: string; pair2Label?: string }) {
  return <PredictionPanel match={match} />
}
