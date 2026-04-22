'use client'
// H2H tab — head-to-head records between the two pairs.
import { useState } from 'react'
import { useTranslations, useFormatter } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Match, pairName, parseSetScore, parseSetFromGames, toShortName } from '@/types/match'
import { FlagImage } from '@/components/FlagImage'
import Spinner from '@/app/components/Spinner'
import { MONTH_YEAR } from '@/lib/format-patterns'
import { pairMatchesIds } from './lib/score-helpers'
import {
  GREEN, LIVE_RED, BG_CARD, MUTED, BORDER,
  PAIR1_COLOR, PAIR2_COLOR, PAIR1_BG, PAIR2_BG,
  CHUNKY,
} from './lib/constants'

export function H2HTab({ match, h2hMatches, h2hLoading, pair1Label, pair2Label, pair1Recent, pair2Recent }: {
  match: Match; h2hMatches: any[]; h2hLoading: boolean; pair1Label: string; pair2Label: string; pair1Recent: any[]; pair2Recent: any[]
}) {
  const t = useTranslations('matchDetail')
  const format = useFormatter()
  const [showAll, setShowAll] = useState(false)
  const p1Ids = [match.pair1_player1?.id, match.pair1_player2?.id].filter(Boolean) as string[]

  // Compute overall record
  let p1Wins = 0, p2Wins = 0
  h2hMatches.forEach(m => {
    const mp1p1 = m.pair1_player1?.id ?? null
    const mp1p2 = m.pair1_player2?.id ?? null
    const ourPairIsMatch1 = pairMatchesIds(mp1p1, mp1p2, p1Ids)
    if ((ourPairIsMatch1 && m.winner_pair === 1) || (!ourPairIsMatch1 && m.winner_pair === 2)) p1Wins++
    else p2Wins++
  })

  const formatSetScores = (m: any): string => {
    const sets = [...(m.sets ?? [])].sort((a: any, b: any) => a.set_number - b.set_number)
    return sets.map((s: any) => s.set_score ?? '').filter(Boolean).join('  ')
  }

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return ''
    try {
      const d = new Date(dateStr)
      return format.dateTime(d, MONTH_YEAR)
    } catch { return '' }
  }

  const visibleMatches = showAll ? h2hMatches : h2hMatches.slice(0, 5)

  if (h2hLoading) return (
    <Spinner size={22} />
  )

  return (
    <div>
      {/* Summary header */}
      <div style={{ background: BG_CARD, borderBottom: `0.5px solid ${BORDER}`, padding: '14px 16px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 900, fontFamily: 'monospace', color: PAIR1_COLOR, lineHeight: 1 }}>{p1Wins}</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: PAIR1_COLOR, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pair1Label}</div>
          </div>
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1px' }}>{t('h2h')}</div>
            <div style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>{t('h2hMatches', { count: h2hMatches.length })}</div>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 900, fontFamily: 'monospace', color: PAIR2_COLOR, lineHeight: 1 }}>{p2Wins}</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: PAIR2_COLOR, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pair2Label}</div>
          </div>
        </div>
      </div>

      {/* Match list */}
      {h2hMatches.length === 0 && !h2hLoading && (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: MUTED, fontSize: 12 }}>
          {t('noPreviousMeetings')}
        </div>
      )}

      {visibleMatches.map((m) => {
        // Perspective: figure out whether the historical match's pair1
        // corresponds to CURRENT team 1 (from the match we're viewing).
        // If yes, render historical pair1 on top; otherwise swap so
        // current team 1 is always on top (orange) and current team 2
        // always on the bottom (yellow).
        const mp1p1 = m.pair1_player1?.id ?? null
        const mp1p2 = m.pair1_player2?.id ?? null
        const ourPairIsMatch1 = pairMatchesIds(mp1p1, mp1p2, p1Ids)

        const topP1 = ourPairIsMatch1 ? m.pair1_player1 : m.pair2_player1
        const topP2 = ourPairIsMatch1 ? m.pair1_player2 : m.pair2_player2
        const botP1 = ourPairIsMatch1 ? m.pair2_player1 : m.pair1_player1
        const botP2 = ourPairIsMatch1 ? m.pair2_player2 : m.pair1_player2

        const topName = pairName(topP1, topP2)
        const botName = pairName(botP1, botP2)

        const team1Won = (ourPairIsMatch1 && m.winner_pair === 1) || (!ourPairIsMatch1 && m.winner_pair === 2)
        const team2Won = m.winner_pair != null && !team1Won
        const accentColor = team1Won ? PAIR1_COLOR : team2Won ? PAIR2_COLOR : MUTED

        // Per-set games for each side, in top-row / bottom-row orientation.
        const sortedSets = [...(m.sets ?? [])].sort((a: any, b: any) => a.set_number - b.set_number)
        const setGames: { top: number | string; bot: number | string }[] = sortedSets.map((s: any) => {
          const parsed = parseSetScore(s.set_score) ?? parseSetFromGames(s.pair1_games, s.pair2_games)
          const p1g = parsed?.p1 ?? s.pair1_games ?? 0
          const p2g = parsed?.p2 ?? s.pair2_games ?? 0
          return ourPairIsMatch1
            ? { top: p1g, bot: p2g }
            : { top: p2g, bot: p1g }
        })

        const date = formatDate(m.finished_at ?? m.started_at)
        const tournamentName = (m.tournament as any)?.name ?? '\u2014'
        const round = m.round ?? ''

        return (
          <Link
            key={m.id}
            href={`/match/${m.id}`}
            style={{
              display: 'block',
              textDecoration: 'none',
              color: 'inherit',
              margin: '6px 10px',
            }}
          >
            <div style={{
              position: 'relative',
              background: 'rgba(255,255,255,0.03)',
              clipPath: CHUNKY.card,
              padding: '6px 10px 6px 14px',
              overflow: 'hidden',
            }}>
              {/* Left accent bar — winner's team color */}
              <div style={{
                position: 'absolute',
                top: 0, left: 0, bottom: 0,
                width: 3,
                background: accentColor,
              }} />

              {/* Pills row: tournament, round, date */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '2px 6px',
                  clipPath: CHUNKY.badge, textTransform: 'uppercase',
                  background: 'rgba(255,255,255,0.08)', color: '#fff',
                  letterSpacing: 0.3,
                  maxWidth: 180,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {tournamentName}
                </span>
                {round && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 6px',
                    clipPath: CHUNKY.badge, textTransform: 'uppercase',
                    background: 'rgba(255,255,255,0.06)', color: MUTED,
                    letterSpacing: 0.3,
                  }}>
                    {round}
                  </span>
                )}
                {date && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 6px',
                    clipPath: CHUNKY.badge, textTransform: 'uppercase',
                    background: 'rgba(255,255,255,0.06)', color: MUTED,
                    letterSpacing: 0.3,
                  }}>
                    {date}
                  </span>
                )}
              </div>

              {/* Team 1 row (always current team 1 — orange) */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '2px 0',
                opacity: team1Won || m.winner_pair == null ? 1 : 0.65,
              }}>
                {/* Flag stack */}
                <div style={{ position: 'relative', width: 22, height: 16, flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
                    <FlagImage country={topP1?.country ?? null} size={14} />
                  </div>
                  <div style={{ position: 'absolute', top: 4, left: 6, zIndex: 1 }}>
                    <FlagImage country={topP2?.country ?? null} size={14} />
                  </div>
                </div>
                <span style={{
                  flex: 1, minWidth: 0,
                  fontSize: 12,
                  fontWeight: team1Won ? 700 : 600,
                  color: team1Won ? '#fff' : '#B0B5BE',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {topName}
                </span>
                {team1Won && (
                  <span style={{
                    width: 14, height: 14, flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: PAIR1_COLOR, clipPath: CHUNKY.badge,
                    fontSize: 8, fontWeight: 800, color: '#000',
                  }}>
                    W
                  </span>
                )}
                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                  {setGames.map((sg, i) => (
                    <span key={i} style={{
                      fontSize: 14, fontWeight: 700, fontFamily: 'monospace',
                      color: Number(sg.top) > Number(sg.bot) ? '#fff' : '#B0B5BE',
                      minWidth: 13, textAlign: 'center',
                    }}>
                      {sg.top}
                    </span>
                  ))}
                </div>
              </div>

              {/* Team 2 row (always current team 2 — yellow) */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '2px 0',
                opacity: team2Won || m.winner_pair == null ? 1 : 0.65,
              }}>
                <div style={{ position: 'relative', width: 22, height: 16, flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
                    <FlagImage country={botP1?.country ?? null} size={14} />
                  </div>
                  <div style={{ position: 'absolute', top: 4, left: 6, zIndex: 1 }}>
                    <FlagImage country={botP2?.country ?? null} size={14} />
                  </div>
                </div>
                <span style={{
                  flex: 1, minWidth: 0,
                  fontSize: 12,
                  fontWeight: team2Won ? 700 : 600,
                  color: team2Won ? '#fff' : '#B0B5BE',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {botName}
                </span>
                {team2Won && (
                  <span style={{
                    width: 14, height: 14, flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: PAIR2_COLOR, clipPath: CHUNKY.badge,
                    fontSize: 8, fontWeight: 800, color: '#000',
                  }}>
                    W
                  </span>
                )}
                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                  {setGames.map((sg, i) => (
                    <span key={i} style={{
                      fontSize: 14, fontWeight: 700, fontFamily: 'monospace',
                      color: Number(sg.bot) > Number(sg.top) ? '#fff' : '#B0B5BE',
                      minWidth: 13, textAlign: 'center',
                    }}>
                      {sg.bot}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Link>
        )
      })}

      {h2hMatches.length > 5 && (
        <button
          onClick={() => setShowAll(s => !s)}
          style={{
            display: 'block',
            width: 'calc(100% - 20px)',
            margin: '8px 10px 4px',
            padding: '10px 12px',
            background: 'rgba(255,255,255,0.04)',
            border: 'none',
            clipPath: CHUNKY.card,
            fontSize: 11,
            fontWeight: 700,
            color: GREEN,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {showAll ? t('showLess') : t('showAll', { count: h2hMatches.length })}
        </button>
      )}

      {/* ── Last 5 Matches per pair ───────────────────────────────── */}
      {(pair1Recent.length > 0 || pair2Recent.length > 0) && (
        <>
          {/* Section header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 16px 8px' }}>
            <div style={{ flex: 1, height: '0.5px', background: BORDER }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1px' }}>{t('last5Matches')}</span>
            <div style={{ flex: 1, height: '0.5px', background: BORDER }} />
          </div>

          {/* Two-column layout */}
          <div style={{ display: 'flex', gap: 0 }}>
            {/* Pair 1 column */}
            <div style={{ flex: 1, borderRight: `0.5px solid ${BORDER}` }}>
              <div style={{ padding: '6px 10px 4px', borderBottom: `0.5px solid ${BORDER}`, background: PAIR1_BG }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: PAIR1_COLOR, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pair1Label}</div>
              </div>
              {pair1Recent.length === 0 ? (
                <div style={{ padding: '16px 10px', fontSize: 10, color: MUTED, textAlign: 'center' }}>{t('noRecentData')}</div>
              ) : pair1Recent.map((m, idx) => {
                const isPair1InSlot1 = pairMatchesIds(m.pair1_player1?.id, m.pair1_player2?.id, p1Ids)
                const won = (isPair1InSlot1 && m.winner_pair === 1) || (!isPair1InSlot1 && m.winner_pair === 2)
                const opponentNames = isPair1InSlot1
                  ? [m.pair2_player1?.display_name ?? m.pair2_player1?.name, m.pair2_player2?.display_name ?? m.pair2_player2?.name].filter(Boolean).map((n: string) => toShortName(n)).join(' / ')
                  : [m.pair1_player1?.display_name ?? m.pair1_player1?.name, m.pair1_player2?.display_name ?? m.pair1_player2?.name].filter(Boolean).map((n: string) => toShortName(n)).join(' / ')
                const scores = formatSetScores(m)
                return (
                  <Link key={m.id} href={`/match/${m.id}`} style={{ display: 'block', padding: '6px 10px', borderBottom: `0.5px solid ${BORDER}`, background: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.08)', textDecoration: 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                      <div style={{
                        width: 18, height: 18, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: won ? 'rgba(126,211,33,0.15)' : 'rgba(255,68,85,0.15)',
                        border: `0.5px solid ${won ? 'rgba(126,211,33,0.3)' : 'rgba(255,68,85,0.3)'}`,
                        clipPath: CHUNKY.badge,
                      }}>
                        <span style={{ fontSize: 9, fontWeight: 800, color: won ? GREEN : LIVE_RED }}>{won ? 'W' : 'L'}</span>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#ccc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                        {opponentNames || 'TBD'}
                      </span>
                    </div>
                    <div style={{ fontSize: 9, fontWeight: 600, fontFamily: 'monospace', color: MUTED, paddingLeft: 22 }}>
                      {scores || '\u2014'}
                    </div>
                  </Link>
                )
              })}
            </div>

            {/* Pair 2 column */}
            <div style={{ flex: 1 }}>
              <div style={{ padding: '6px 10px 4px', borderBottom: `0.5px solid ${BORDER}`, background: PAIR2_BG }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: PAIR2_COLOR, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pair2Label}</div>
              </div>
              {pair2Recent.length === 0 ? (
                <div style={{ padding: '16px 10px', fontSize: 10, color: MUTED, textAlign: 'center' }}>{t('noRecentData')}</div>
              ) : pair2Recent.map((m, idx) => {
                const p2Ids = [match.pair2_player1?.id, match.pair2_player2?.id].filter(Boolean) as string[]
                const isPair2InSlot1 = pairMatchesIds(m.pair1_player1?.id, m.pair1_player2?.id, p2Ids)
                const won = (isPair2InSlot1 && m.winner_pair === 1) || (!isPair2InSlot1 && m.winner_pair === 2)
                const opponentNames = isPair2InSlot1
                  ? [m.pair2_player1?.display_name ?? m.pair2_player1?.name, m.pair2_player2?.display_name ?? m.pair2_player2?.name].filter(Boolean).map((n: string) => toShortName(n)).join(' / ')
                  : [m.pair1_player1?.display_name ?? m.pair1_player1?.name, m.pair1_player2?.display_name ?? m.pair1_player2?.name].filter(Boolean).map((n: string) => toShortName(n)).join(' / ')
                const scores = formatSetScores(m)
                return (
                  <Link key={m.id} href={`/match/${m.id}`} style={{ display: 'block', padding: '6px 10px', borderBottom: `0.5px solid ${BORDER}`, background: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.08)', textDecoration: 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                      <div style={{
                        width: 18, height: 18, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: won ? 'rgba(126,211,33,0.15)' : 'rgba(255,68,85,0.15)',
                        border: `0.5px solid ${won ? 'rgba(126,211,33,0.3)' : 'rgba(255,68,85,0.3)'}`,
                        clipPath: CHUNKY.badge,
                      }}>
                        <span style={{ fontSize: 9, fontWeight: 800, color: won ? GREEN : LIVE_RED }}>{won ? 'W' : 'L'}</span>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#ccc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                        {opponentNames || 'TBD'}
                      </span>
                    </div>
                    <div style={{ fontSize: 9, fontWeight: 600, fontFamily: 'monospace', color: MUTED, paddingLeft: 22 }}>
                      {scores || '\u2014'}
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
