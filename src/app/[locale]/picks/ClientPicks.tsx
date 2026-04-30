'use client'

import { useEffect, useState } from 'react'
import { readAllPredictions } from '@/hooks/useMatchPrediction'
import type { Prediction } from '@/lib/predictions/types'
import type { Match } from '@/types/match'
import { classifyResult, computeReward } from '@/lib/predictions/scoring'
import { StatsHeader } from './StatsHeader'
import { PicksList } from './PicksList'

export function ClientPicks({ displayName }: { displayName: string }) {
  const [picks, setPicks] = useState<Array<{ prediction: Prediction; match: Match }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const all = readAllPredictions()
      if (all.length === 0) { setLoading(false); return }
      const ids = all.map(p => p.matchId)
      const res = await fetch(`/api/matches/by-ids?ids=${ids.join(',')}`)
      const matches: Match[] = res.ok ? await res.json() : []
      const byId = new Map(matches.map(m => [m.id, m]))
      const enriched = all
        .map(p => ({ prediction: p, match: byId.get(p.matchId) }))
        .filter((e): e is { prediction: Prediction; match: Match } => !!e.match)
      if (!cancelled) { setPicks(enriched); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Compute stats using the updated classifyResult API
  const totalGuacas = picks.reduce((sum, { prediction, match }) => {
    const classified = classifyResult(prediction, match)
    if (!classified) return sum
    return sum + computeReward(prediction, classified)
  }, 0)

  const resolvedRight = picks.filter(({ prediction, match }) => {
    const r = classifyResult(prediction, match)?.result
    return r === 'right' || r === 'perfect' || r === 'upset'
  }).length

  const resolvedWrong = picks.filter(({ prediction, match }) =>
    classifyResult(prediction, match)?.result === 'wrong'
  ).length

  const accuracyPct = (resolvedRight + resolvedWrong > 0)
    ? Math.round((resolvedRight / (resolvedRight + resolvedWrong)) * 100)
    : 0

  // Streak — count from most recent resolved backward
  const sorted = picks
    .map(p => ({ p, r: classifyResult(p.prediction, p.match)?.result ?? null }))
    .filter(x => x.r !== null && x.r !== 'invalidated')
    .sort((a, b) => new Date(b.p.prediction.createdAt).getTime() - new Date(a.p.prediction.createdAt).getTime())

  let currentStreak = 0
  for (const { r } of sorted) {
    if (r === 'right' || r === 'perfect' || r === 'upset') currentStreak++
    else break
  }

  let bestStreak = 0, run = 0
  for (const { r } of sorted) {
    if (r === 'right' || r === 'perfect' || r === 'upset') { run++; bestStreak = Math.max(bestStreak, run) }
    else run = 0
  }

  if (loading) return <p style={{ color: '#6B7280' }}>Loading…</p>

  return (
    <>
      <StatsHeader
        displayName={displayName}
        rank={null}
        totalGuacas={totalGuacas}
        accuracyPct={accuracyPct}
        currentStreak={currentStreak}
        bestStreak={bestStreak}
      />
      <PicksList picks={picks} />
    </>
  )
}
