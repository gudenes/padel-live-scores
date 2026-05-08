'use client'

import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { readAllPredictionsAsync } from '@/hooks/useMatchPrediction'
import type { Prediction } from '@/lib/predictions/types'
import type { Match } from '@/types/match'
import { classifyResult, computeReward } from '@/lib/predictions/scoring'
import { StatsHeader } from './StatsHeader'
import { PicksList } from './PicksList'
import { PicksTabs } from '@/components/picks/PicksTabs'
import { SeasonLeaderboard } from '@/components/picks/SeasonLeaderboard'
import { TournamentLeaderboard } from '@/components/picks/TournamentLeaderboard'

interface Props {
  displayName: string
  seasonId: number
  tournaments: Array<{ id: string; name: string; level: string | null }>
  defaultTournamentId: string | null
}

export function ClientPicks({ displayName, seasonId, tournaments, defaultTournamentId }: Props) {
  const locale = useLocale()
  const [picks, setPicks] = useState<Array<{ prediction: Prediction; match: Match }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const all = await readAllPredictionsAsync(true)  // /picks is auth-gated
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

  // Stats for the My picks tab header (logic unchanged from previous version)
  const totalGuacas = picks.reduce((sum, { prediction, match }) => {
    const c = classifyResult(prediction, match); if (!c) return sum
    return sum + computeReward(prediction, c)
  }, 0)
  const resolvedRight = picks.filter(({ prediction, match }) => {
    const r = classifyResult(prediction, match)?.result
    return r === 'right' || r === 'perfect' || r === 'upset'
  }).length
  const resolvedWrong = picks.filter(({ prediction, match }) =>
    classifyResult(prediction, match)?.result === 'wrong'
  ).length
  const accuracyPct = (resolvedRight + resolvedWrong > 0)
    ? Math.round((resolvedRight / (resolvedRight + resolvedWrong)) * 100) : 0

  const sorted = picks
    .map(p => ({ p, r: classifyResult(p.prediction, p.match)?.result ?? null }))
    .filter(x => x.r !== null && x.r !== 'invalidated')
    .sort((a, b) => new Date(b.p.prediction.createdAt).getTime() - new Date(a.p.prediction.createdAt).getTime())
  let currentStreak = 0
  for (const { r } of sorted) { if (r === 'right' || r === 'perfect' || r === 'upset') currentStreak++; else break }
  let bestStreak = 0, run = 0
  for (const { r } of sorted) {
    if (r === 'right' || r === 'perfect' || r === 'upset') { run++; bestStreak = Math.max(bestStreak, run) }
    else run = 0
  }

  if (loading) return <p style={{ color: '#6B7280' }}>Loading…</p>

  return (
    <PicksTabs
      myPicks={
        <>
          <StatsHeader
            displayName={displayName}
            rank={null}
            totalGuacas={totalGuacas}
            accuracyPct={accuracyPct}
            currentStreak={currentStreak}
            bestStreak={bestStreak}
          />
          <PicksList picks={picks} locale={locale} />
        </>
      }
      season={<SeasonLeaderboard seasonId={seasonId} />}
      tournaments={
        <TournamentLeaderboard
          tournaments={tournaments}
          defaultTournamentId={defaultTournamentId}
        />
      }
    />
  )
}
