'use client'
// Live feed tab — point-by-point game log, set filter sub-tabs.
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Match, Game } from '@/types/match'
import { parseSetScore, parseSetFromGames } from '@/types/match'
import { extractGamePoints, computeGameWinner } from './lib/score-helpers'
import {
  GREEN, LIVE_RED, ORANGE, MUTED, BORDER,
  PAIR1_COLOR, PAIR2_COLOR, PAIR1_BORDER, PAIR2_BORDER,
  CHUNKY,
} from './lib/constants'

export function LiveFeedTab({ match, pair1Label, pair2Label, isLive }: {
  match: Match; pair1Label: string; pair2Label: string; isLive: boolean
}) {
  const t = useTranslations('matchDetail')
  const allSets = [...(match.sets ?? [])].sort((a, b) => b.set_number - a.set_number) // newest set first
  const [setFilter, setSetFilter] = useState<number | 'all'>('all')

  if (allSets.length === 0 || allSets.every(s => (s.games ?? []).length === 0)) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 16px', color: MUTED, fontSize: 12 }}>
        {isLive ? t('waitingForFirstPoint') : t('noPointData')}
      </div>
    )
  }

  const sets = setFilter === 'all' ? allSets : allSets.filter(s => s.set_number === setFilter)

  return (
    <div>
      {/* Set filter sub-tabs */}
      {allSets.length > 1 && (
        <div style={{ display: 'flex', gap: 6, padding: '8px 16px', borderBottom: `0.5px solid ${BORDER}`, background: 'rgba(0,0,0,0.2)', overflowX: 'auto' }}>
          <button
            onClick={() => setSetFilter('all')}
            style={{
              fontSize: 10, fontWeight: setFilter === 'all' ? 700 : 500,
              padding: '4px 12px',
              background: setFilter === 'all' ? 'rgba(126,211,33,0.12)' : 'rgba(255,255,255,0.04)',
              border: `0.5px solid ${setFilter === 'all' ? 'rgba(126,211,33,0.3)' : BORDER}`,
              color: setFilter === 'all' ? GREEN : MUTED,
              clipPath: CHUNKY.badge,
              cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}
          >
            {t('allSets')}
          </button>
          {[...allSets].reverse().map(s => {
            const active = setFilter === s.set_number
            const parsed = parseSetScore(s.set_score) ?? parseSetFromGames(s.pair1_games, s.pair2_games)
            const scoreLabel = parsed ? ` (${parsed.p1}-${parsed.p2})` : s.is_current ? ' ·  Live' : ''
            return (
              <button
                key={s.set_number}
                onClick={() => setSetFilter(s.set_number)}
                style={{
                  fontSize: 10, fontWeight: active ? 700 : 500,
                  padding: '4px 12px',
                  background: active ? 'rgba(126,211,33,0.12)' : 'rgba(255,255,255,0.04)',
                  border: `0.5px solid ${active ? 'rgba(126,211,33,0.3)' : BORDER}`,
                  color: active ? GREEN : MUTED,
                  clipPath: CHUNKY.badge,
                  cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                }}
              >
                {t('set', { number: s.set_number })}{scoreLabel}
              </button>
            )
          })}
        </div>
      )}

      {sets.map((set) => {
        const sortedGames = [...(set.games ?? [])].sort((a, b) => a.game_number - b.game_number)
        const reversedGames = [...sortedGames].reverse()

        return (
          <div key={set.set_number}>
            {/* Set header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px 4px' }}>
              <div style={{ flex: 1, height: '0.5px', background: BORDER }} />
              <span style={{ fontSize: 9, fontWeight: 700, color: GREEN, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {t('set', { number: set.set_number })}{set.set_score
                  ? ` · ${set.set_score}`
                  : (set.pair1_games != null && set.pair2_games != null && (set.pair1_games > 0 || set.pair2_games > 0))
                    ? ` · ${set.pair1_games}-${set.pair2_games}`
                    : ` · ${t('inProgress')}`}
              </span>
              <div style={{ flex: 1, height: '0.5px', background: BORDER }} />
            </div>

            {reversedGames.map((game, revIdx) => {
              const gameIdx = sortedGames.length - 1 - revIdx
              const points = extractGamePoints(game as unknown as Game)
              const winner = computeGameWinner(sortedGames, gameIdx)
              const isCurrent = game.is_current

              // Cumulative set score at START of this game
              let p1Before = 0, p2Before = 0
              for (let i = 0; i < gameIdx; i++) {
                const w = computeGameWinner(sortedGames, i)
                if (w === 1) p1Before++
                else if (w === 2) p2Before++
              }

              return (
                <div key={game.id} id={`game-s${set.set_number}-g${game.game_number}`} style={{ borderTop: `0.5px solid ${BORDER}` }}>
                  {/* Game header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 16px 4px', background: 'rgba(0,0,0,0.15)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: MUTED }}>
                        {t('game', { number: game.game_number })}
                      </span>
                      {isCurrent && isLive
                        ? <span style={{ fontSize: 10, fontWeight: 700, color: LIVE_RED }}>{t('inProgress')}</span>
                        : winner === 1
                        ? <span style={{ fontSize: 10, fontWeight: 700, color: PAIR1_COLOR }}>{t('won', { pair: pair1Label })}</span>
                        : winner === 2
                        ? <span style={{ fontSize: 10, fontWeight: 700, color: PAIR2_COLOR }}>{t('won', { pair: pair2Label })}</span>
                        : null
                      }
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'monospace', color: MUTED }}>
                      {p1Before} – {p2Before}
                    </span>
                  </div>

                  {/* Points — newest first */}
                  {[...points].reverse().map((pt, ptIdx) => {
                    const isLatest = isCurrent && ptIdx === 0
                    return (
                      <div key={ptIdx} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '5px 16px 5px 28px',
                        borderLeft: `2px solid ${isLatest ? LIVE_RED : pt.scorer === 1 ? PAIR1_BORDER : PAIR2_BORDER}`,
                        background: isLatest ? 'rgba(255,70,85,0.06)' : pt.isSP ? 'rgba(245,166,35,0.04)' : 'transparent',
                      }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: pt.scorer === 1 ? PAIR1_COLOR : PAIR2_COLOR }} />
                        <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', width: 58, flexShrink: 0, color: pt.scorer === 1 ? PAIR1_COLOR : PAIR2_COLOR }}>
                          {pt.score}
                        </span>
                        <span style={{ flex: 1, fontSize: 10, color: MUTED }}>
                          {pt.scorer === 1 ? pair1Label : pair2Label}
                        </span>
                        {isLatest && <span style={{ fontSize: 8, fontWeight: 700, color: LIVE_RED, letterSpacing: '0.5px' }}>{t('now')}</span>}
                        {pt.isSP && !isLatest && <span style={{ fontSize: 8, fontWeight: 700, color: ORANGE, background: 'rgba(245,166,35,0.12)', border: '0.5px solid rgba(245,166,35,0.25)', clipPath: CHUNKY.badge, padding: '1px 5px' }}>SP</span>}
                      </div>
                    )
                  })}

                  {points.length === 0 && isCurrent && (
                    <div style={{ padding: '8px 28px', fontSize: 10, color: MUTED }}>{t('waitingForFirstPoint')}</div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
