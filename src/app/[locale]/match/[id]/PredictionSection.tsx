'use client'
// Prediction section (scheduled matches) and post-match prediction result card.
import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Match } from '@/types/match'
import { Prediction } from '@/hooks/useMatchPrediction'
import { PlayerAvatar } from './PlayerCard'
import { simulatePoll } from './lib/score-helpers'
import {
  GREEN, ORANGE, LIVE_RED, BG_CARD, MUTED, BORDER,
  PAIR1_COLOR, PAIR2_COLOR, PAIR1_BG, PAIR2_BG, PAIR1_BORDER, PAIR2_BORDER,
  CHUNKY,
} from './lib/constants'

// ── Prediction Section (Scheduled matches) ────────────────────────────────────
export function PredictionSection({ match, pair1Label, pair2Label, prediction, predStep, setPredStep, setPrediction, clearPrediction }: {
  match: Match; pair1Label: string; pair2Label: string
  prediction: Prediction | null
  predStep: 'pick' | 'margin' | 'done'
  setPredStep: (s: 'pick' | 'margin' | 'done') => void
  setPrediction: (p: Prediction) => void
  clearPrediction: () => void
}) {
  const tPred = useTranslations('prediction')
  const [selectedPair, setSelectedPair] = useState<1 | 2 | null>(prediction?.pair ?? null)
  const [pollAnimated, setPollAnimated] = useState(false)

  const handlePickPair = (pair: 1 | 2) => {
    setSelectedPair(pair)
    setPredStep('margin')
  }

  const handlePickMargin = (margin: '2-0' | '2-1') => {
    if (!selectedPair) return
    setPrediction({ pair: selectedPair, margin })
    setPredStep('done')
    setPollAnimated(false)
    // Trigger poll bar animation after mount
    setTimeout(() => setPollAnimated(true), 50)
  }

  const handleChange = () => {
    clearPrediction()
    setSelectedPair(null)
    setPredStep('pick')
    setPollAnimated(false)
  }

  // Trigger poll animation on mount if already confirmed
  useEffect(() => {
    if (predStep === 'done' && prediction) {
      const t = setTimeout(() => setPollAnimated(true), 50)
      return () => clearTimeout(t)
    }
  }, [predStep, prediction])

  const p1Short = pair1Label.split(' / ').map(n => n.split(' ').pop()).join(' / ')
  const p2Short = pair2Label.split(' / ').map(n => n.split(' ').pop()).join(' / ')

  const poll = useMemo(() => simulatePoll(match.id), [match.id])
  const pair2Pct = 100 - poll.pair1Pct

  // Player rankings for comparison strip
  const p1r1 = match.pair1_player1?.ranking
  const p1r2 = match.pair1_player2?.ranking
  const p2r1 = match.pair2_player1?.ranking
  const p2r2 = match.pair2_player2?.ranking
  const avgRankP1 = p1r1 && p1r2 ? Math.round((p1r1 + p1r2) / 2) : (p1r1 ?? p1r2 ?? null)
  const avgRankP2 = p2r1 && p2r2 ? Math.round((p2r1 + p2r2) / 2) : (p2r1 ?? p2r2 ?? null)

  // Reduced motion check
  const prefersReduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  return (
    <div style={{ background: BG_CARD, borderBottom: `0.5px solid ${BORDER}`, padding: '16px' }}>
      {/* Heading */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 14 }}>
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
        </svg>
        <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '2px' }}>
          {tPred('whoTakesIt')}
        </span>
      </div>

      {/* ── Pick / Margin state: show pair cards ── */}
      {(predStep === 'pick' || predStep === 'margin') && (
        <>
          {/* Two pair cards */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            {([1, 2] as const).map(pair => {
              const label = pair === 1 ? p1Short : p2Short
              const color = pair === 1 ? PAIR1_COLOR : PAIR2_COLOR
              const isSelected = selectedPair === pair
              const isDimmed = selectedPair !== null && selectedPair !== pair
              const p1 = pair === 1 ? match.pair1_player1 : match.pair2_player1
              const p2 = pair === 1 ? match.pair1_player2 : match.pair2_player2
              const ranking = pair === 1 ? avgRankP1 : avgRankP2

              return (
                <button
                  key={pair}
                  onClick={() => handlePickPair(pair)}
                  style={{
                    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    padding: '14px 10px', clipPath: CHUNKY.card,
                    background: isSelected ? (pair === 1 ? 'rgba(255,107,43,0.12)' : 'rgba(255,209,102,0.12)') : (pair === 1 ? PAIR1_BG : PAIR2_BG),
                    border: isSelected ? `2px solid ${color}` : `1.5px solid ${isDimmed ? BORDER : (pair === 1 ? PAIR1_BORDER : PAIR2_BORDER)}`,
                    boxShadow: isSelected ? `0 0 16px ${pair === 1 ? 'rgba(255,107,43,0.12)' : 'rgba(255,209,102,0.12)'}` : 'none',
                    cursor: 'pointer', fontFamily: 'inherit', position: 'relative',
                    opacity: isDimmed ? 0.35 : 1,
                    transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                    transition: prefersReduced ? 'none' : 'transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1), border-color 300ms ease, box-shadow 300ms ease, opacity 200ms ease-out',
                  }}
                >
                  {isSelected && (
                    <div style={{ position: 'absolute', top: 5, right: 8 }}>
                      <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </div>
                  )}
                  <div style={{ display: 'flex' }}>
                    <PlayerAvatar player={p1} size={32} accent={isSelected ? color : undefined} />
                    <div style={{ marginLeft: -6 }}>
                      <PlayerAvatar player={p2} size={32} accent={isSelected ? color : undefined} />
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: isDimmed ? '#555' : color, textAlign: 'center', lineHeight: 1.3 }}>{label}</span>
                  {ranking && !isDimmed && (
                    <span style={{ fontSize: 9, color: MUTED }}>Avg #{ranking}</span>
                  )}
                  {isSelected && (
                    <span style={{ fontSize: 8, fontWeight: 700, color, letterSpacing: '0.5px', textTransform: 'uppercase' }}>{tPred('yourPick')}</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Comparison strip */}
          <div style={{ display: 'flex', marginBottom: 14, clipPath: CHUNKY.card }}>
            <div style={{ flex: 1, padding: '7px 8px', background: '#1F1F1F', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ fontSize: 7, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Ranking</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 6px' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: PAIR1_COLOR }}>{avgRankP1 ? `#${avgRankP1}` : '–'}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: PAIR2_COLOR }}>{avgRankP2 ? `#${avgRankP2}` : '–'}</span>
              </div>
            </div>
            <div style={{ flex: 1, padding: '7px 8px', background: '#1F1F1F', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ fontSize: 7, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Matches</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 6px' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: PAIR1_COLOR }}>{match.pair1_player1?.total_matches ?? '–'}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: PAIR2_COLOR }}>{match.pair2_player1?.total_matches ?? '–'}</span>
              </div>
            </div>
            <div style={{ flex: 1, padding: '7px 8px', background: '#1F1F1F', textAlign: 'center' }}>
              <div style={{ fontSize: 7, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Win rate</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 6px' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: PAIR1_COLOR }}>{match.pair1_player1?.win_rate != null ? `${Math.round(match.pair1_player1.win_rate)}%` : '–'}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: PAIR2_COLOR }}>{match.pair2_player1?.win_rate != null ? `${Math.round(match.pair2_player1.win_rate)}%` : '–'}</span>
              </div>
            </div>
          </div>

          {/* Prompt or margin selector */}
          {predStep === 'pick' && (
            <div style={{ textAlign: 'center', fontSize: 9, color: '#4A6F8E' }}>{tPred('tapThePair')}</div>
          )}

          {predStep === 'margin' && selectedPair && (
            <div>
              <div style={{ textAlign: 'center', fontSize: 9, color: '#6889A5', fontWeight: 600, marginBottom: 8 }}>{tPred('howDoesItEnd')}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => handlePickMargin('2-0')} style={{
                  flex: 1, padding: '12px 8px', clipPath: CHUNKY.button,
                  background: 'rgba(126,211,33,0.06)', border: '1.5px solid rgba(126,211,33,0.25)',
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                }}>
                  <span style={{ fontSize: 18, fontWeight: 900, color: GREEN, fontFamily: 'monospace' }}>2–0</span>
                  <span style={{ fontSize: 8, fontWeight: 700, color: 'rgba(126,211,33,0.5)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{tPred('straightSets')}</span>
                </button>
                <button onClick={() => handlePickMargin('2-1')} style={{
                  flex: 1, padding: '12px 8px', clipPath: CHUNKY.button,
                  background: 'rgba(245,166,35,0.06)', border: '1.5px solid rgba(245,166,35,0.25)',
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                }}>
                  <span style={{ fontSize: 18, fontWeight: 900, color: ORANGE, fontFamily: 'monospace' }}>2–1</span>
                  <span style={{ fontSize: 8, fontWeight: 700, color: 'rgba(245,166,35,0.5)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{tPred('threeSetBattle')}</span>
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Confirmed state: prediction card + community poll ── */}
      {predStep === 'done' && prediction && (
        <>
          {/* Prediction card */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', marginBottom: 14, clipPath: CHUNKY.card,
            background: 'rgba(126,211,33,0.04)', border: '1px solid rgba(126,211,33,0.15)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <div>
                <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(126,211,33,0.45)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 2 }}>{tPred('yourPrediction')}</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: GREEN }}>
                  {tPred('win', { pair: prediction.pair === 1 ? p1Short : p2Short, margin: prediction.margin === '2-0' ? '2–0' : '2–1' })}
                </div>
              </div>
            </div>
            <button onClick={handleChange} style={{
              background: 'transparent', border: '0.5px solid rgba(126,211,33,0.2)', clipPath: CHUNKY.badge,
              padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 8, fontWeight: 700, color: GREEN,
            }}>
              {tPred('change')}
            </button>
          </div>

          {/* Community poll */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 8, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8, textAlign: 'center' }}>
              {tPred('whatOthersThink')}
            </div>
            <div style={{ position: 'relative', height: 34, overflow: 'hidden', clipPath: CHUNKY.card, background: '#1F1F1F' }}>
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: pollAnimated ? `${poll.pair1Pct}%` : '0%',
                background: 'linear-gradient(90deg, rgba(255,107,43,0.25), rgba(255,107,43,0.08))',
                display: 'flex', alignItems: 'center', paddingLeft: 10,
                transition: prefersReduced ? 'none' : 'width 700ms cubic-bezier(0.25, 0.1, 0.25, 1) 500ms',
              }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: PAIR1_COLOR }}>{poll.pair1Pct}%</span>
                <span style={{ fontSize: 9, color: 'rgba(255,107,43,0.6)', marginLeft: 5, whiteSpace: 'nowrap' }}>{p1Short}</span>
              </div>
              <div style={{
                position: 'absolute', right: 0, top: 0, bottom: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 10,
              }}>
                <span style={{ fontSize: 9, color: 'rgba(255,209,102,0.6)', marginRight: 5, whiteSpace: 'nowrap' }}>{p2Short}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: PAIR2_COLOR }}>{pair2Pct}%</span>
              </div>
            </div>
            <div style={{ fontSize: 9, color: '#4A6F8E', marginTop: 5, textAlign: 'center' }}>
              {tPred('fansHavePredicted', { count: poll.totalVotes })}{' '}
              {prediction.pair === 1
                ? (poll.pair1Pct >= 50 ? `· ${tPred('withMajority')}` : `· ${tPred('boldPick')}`)
                : (pair2Pct >= 50 ? `· ${tPred('withMajority')}` : `· ${tPred('boldPick')}`)}
            </div>
          </div>

          {/* Margin breakdown */}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, padding: 9, background: '#1F1F1F', textAlign: 'center', clipPath: CHUNKY.card }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: GREEN, fontFamily: 'monospace' }}>2–0</div>
              <div style={{ fontSize: 8, color: MUTED, marginTop: 2 }}>{poll.straightPct}% {tPred('predict')}</div>
            </div>
            <div style={{ flex: 1, padding: 9, background: '#1F1F1F', textAlign: 'center', clipPath: CHUNKY.card }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: ORANGE, fontFamily: 'monospace' }}>2–1</div>
              <div style={{ fontSize: 8, color: MUTED, marginTop: 2 }}>{100 - poll.straightPct}% {tPred('predict')}</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Post-Match Prediction Result ──────────────────────────────────────────────
export function PredictionResult({ match, prediction, pair1Label, pair2Label }: {
  match: Match; prediction: Prediction; pair1Label: string; pair2Label: string
}) {
  const tPred = useTranslations('prediction')
  const ref = useRef<HTMLDivElement>(null)
  const p1Short = pair1Label.split(' / ').map(n => n.split(' ').pop()).join(' / ')
  const p2Short = pair2Label.split(' / ').map(n => n.split(' ').pop()).join(' / ')

  const winnerPair = match.winner_pair as 1 | 2 | null
  if (!winnerPair) return null

  // Count sets to determine actual margin
  const sets = match.sets ?? []
  const p1Sets = sets.filter(s => (s.pair1_games ?? 0) > (s.pair2_games ?? 0)).length
  const p2Sets = sets.filter(s => (s.pair2_games ?? 0) > (s.pair1_games ?? 0)).length
  const actualMargin = winnerPair === 1 ? `${p1Sets}-${p2Sets}` : `${p2Sets}-${p1Sets}`
  const winnerLabel = winnerPair === 1 ? p1Short : p2Short
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const loserLabel = winnerPair === 1 ? p2Short : p1Short

  const pairCorrect = prediction.pair === winnerPair
  const marginCorrect = pairCorrect && (prediction.margin === '2-0' ? actualMargin === '2-0' : actualMargin === '2-1')

  // Determine variant
  let variant: 'correct' | 'close' | 'wrong'
  if (pairCorrect && marginCorrect) variant = 'correct'
  else if (pairCorrect) variant = 'close'
  else variant = 'wrong'

  const config = {
    correct: {
      bg: 'rgba(126,211,33,0.05)', border: 'rgba(126,211,33,0.15)', color: GREEN,
      title: tPred('spotOn'),
      desc: tPred('calledIt', { pair: winnerLabel, margin: actualMargin }),
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
        </svg>
      ),
    },
    close: {
      bg: 'rgba(245,166,35,0.04)', border: 'rgba(245,166,35,0.12)', color: ORANGE,
      title: tPred('closeCall'),
      desc: prediction.margin === '2-0'
        ? tPred('wrongMarginThree')
        : tPred('wrongMarginTwo'),
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={ORANGE} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
        </svg>
      ),
    },
    wrong: {
      bg: 'rgba(255,70,85,0.04)', border: 'rgba(255,70,85,0.12)', color: LIVE_RED,
      title: tPred('notThisTime'),
      desc: tPred('youBacked', { picked: prediction.pair === 1 ? p1Short : p2Short, winner: winnerLabel, margin: actualMargin }),
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={LIVE_RED} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 20h20"/><path d="M4 20V10l4 4 4-8 4 8 4-4v10"/>
        </svg>
      ),
    },
  }

  const c = config[variant]

  return (
    <div ref={ref} style={{ padding: '0 16px 0', background: BG_CARD, borderBottom: `0.5px solid ${BORDER}` }}>
      <div style={{
        padding: 16, clipPath: CHUNKY.card, textAlign: 'center',
        background: c.bg, border: `1px solid ${c.border}`,
      }}>
        <div style={{ marginBottom: 4 }}>{c.icon}</div>
        <div style={{ fontSize: 14, fontWeight: 800, color: c.color, marginBottom: 4 }}>{c.title}</div>
        <div style={{ fontSize: 11, color: '#9AAEC4', marginBottom: variant === 'correct' ? 10 : 0 }}>{c.desc}</div>
        {variant === 'close' && (
          <div style={{ marginTop: 8 }}>
            <span style={{ clipPath: CHUNKY.badge, padding: '4px 10px', background: 'rgba(245,166,35,0.08)', fontSize: 10, fontWeight: 700, color: ORANGE }}>
              {tPred('rightPairWrongMargin')}
            </span>
          </div>
        )}
        {variant === 'correct' && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <span style={{ clipPath: CHUNKY.badge, padding: '4px 10px', background: 'rgba(126,211,33,0.08)', fontSize: 10, fontWeight: 700, color: GREEN, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22c4-2.5 7-6.5 7-11a7 7 0 0 0-14 0c0 4.5 3 8.5 7 11z"/><path d="M12 22c-1.5-1.5-3-4-3-7a3 3 0 0 1 6 0c0 3-1.5 5.5-3 7z"/>
              </svg>
              {tPred('nailedIt')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
