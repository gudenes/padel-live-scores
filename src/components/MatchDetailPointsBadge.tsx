'use client'

import { useEffect, useState } from 'react'
import MatchPointsBadge from './MatchPointsBadge'
import { matchRoundPoints } from '@/lib/live-race/engine'
import type { MatchPoints } from '@/lib/live-race/qualifying'

/** Uses the same main-draw table and validated qualifying draw as today's cards. */
export default function MatchDetailPointsBadge({ matchId, tournamentId, level, round, season }: {
  matchId: string; tournamentId?: string; level?: string | null; round: string | null; season: string;
}) {
  const [draw, setDraw] = useState<{ tournamentId: string; matches: Record<string, MatchPoints> } | null>(null)
  const qualifying = /^(q\d|qual)/i.test(round ?? '')
  useEffect(() => {
    if (!qualifying || !tournamentId) return
    const controller = new AbortController()
    const refresh = async () => {
      try {
        const response = await fetch(`/api/rankings/match-points?tournament=${tournamentId}`, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error('Draw unavailable')
        const data = await response.json()
        if (!controller.signal.aborted) setDraw({ tournamentId, matches: data.matches ?? {} })
      } catch { if (!controller.signal.aborted) setDraw(null) }
    }
    void refresh()
    const timer = setInterval(() => { if (!document.hidden) void refresh() }, 60_000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [qualifying, tournamentId])
  const award: MatchPoints | null | undefined = qualifying ? draw?.tournamentId === tournamentId ? draw?.matches[matchId] : null : matchRoundPoints(level, round, season)
  if (!award) return null
  return <MatchPointsBadge round={award.currentRound ?? round} nextRound={award.nextRound} points={award.winner} loserPoints={award.loser} qualifying={qualifying} qualificationBonus={award.qualificationBonus} />
}
