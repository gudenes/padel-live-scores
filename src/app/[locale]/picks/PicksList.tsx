'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { Match } from '@/types/match'
import type { Prediction, PredictionResult } from '@/lib/predictions/types'
import { classifyResult, computeReward } from '@/lib/predictions/scoring'
import { pairName } from '@/types/match'

const GREEN = '#7ED321'
const GOLD = '#FFD166'
const MUTED = '#6B7280'
const RED = '#FF4655'

const CHUNKY_CARD = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

type FilterKind = 'all' | 'pending' | 'won' | 'lost'

export interface PicksListProps {
  picks: Array<{ prediction: Prediction; match: Match }>
}

/** Locale-agnostic relative time. Falls back to month/day for older entries. */
function formatRelative(iso: string, locale: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffMs = now - then
  const minutes = Math.floor(diffMs / 60_000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (minutes < 1) return rtf.format(0, 'minute')
  if (minutes < 60) return rtf.format(-minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return rtf.format(-hours, 'hour')
  const days = Math.floor(hours / 24)
  if (days < 7) return rtf.format(-days, 'day')
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(then)
}

export function PicksList({ picks, locale = 'en' }: PicksListProps & { locale?: string }) {
  const t = useTranslations('prediction.myPicks')
  const [filter, setFilter] = useState<FilterKind>('all')

  const enriched = picks.map(({ prediction, match }) => {
    const classified = classifyResult(prediction, match)
    const result = classified?.result ?? null
    const reward = classified ? computeReward(prediction, classified) : null
    return { prediction, match, result, reward }
  }).sort((a, b) => new Date(b.prediction.createdAt).getTime() - new Date(a.prediction.createdAt).getTime())

  const counts = {
    all: enriched.length,
    pending: enriched.filter(e => e.result === null).length,
    won: enriched.filter(e => e.result === 'right' || e.result === 'perfect' || e.result === 'upset').length,
    lost: enriched.filter(e => e.result === 'wrong').length,
  }

  const filtered = enriched.filter(e => {
    if (filter === 'all') return true
    if (filter === 'pending') return e.result === null
    if (filter === 'won') return e.result === 'right' || e.result === 'perfect' || e.result === 'upset'
    if (filter === 'lost') return e.result === 'wrong'
    return false
  })

  if (enriched.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', color: MUTED }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 6 }}>{t('noPicks')}</div>
        <div style={{ fontSize: 12 }}>{t('noPicksSub')}</div>
      </div>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto' }}>
        {(['all', 'pending', 'won', 'lost'] as const).map(k => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            style={{
              fontSize: 9, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
              background: filter === k ? GREEN : '#1A1A1A',
              color: filter === k ? '#0a0a0a' : MUTED,
              padding: '7px 11px', cursor: 'pointer', border: 0, flexShrink: 0,
              clipPath: CHUNKY_BADGE,
            }}
          >
            {t(`filter${k.charAt(0).toUpperCase() + k.slice(1)}` as Parameters<typeof t>[0])} <span style={{ opacity: 0.6, marginLeft: 4 }}>{counts[k]}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 20px', color: MUTED, fontSize: 12 }}>
          {/* No filtered results — fall back to the generic empty sub-line. */}
          {t('noPicksSub')}
        </div>
      ) : null}

      {filtered.map(({ prediction, match, result, reward }) => {
        // Show the full pair (not just first player) so users can see who they backed.
        const pickedPair = prediction.pair === 1
          ? pairName(match.pair1_player1, match.pair1_player2)
          : pairName(match.pair2_player1, match.pair2_player2)
        const isInvalidated = result === 'invalidated'
        const isWrong = result === 'wrong'
        return (
          <Link
            key={prediction.matchId}
            href={`/match/${match.id}`}
            style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
          >
            <div style={{
              background: '#141414', border: '1px solid rgba(255,255,255,0.06)',
              padding: '10px 12px', marginBottom: 6,
              clipPath: CHUNKY_CARD,
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <ResultDot result={result} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700 }}>
                  {match.round || ''}{match.court ? ` · ${match.court}` : ''}
                </div>
                <div style={{ fontSize: 13, color: '#fff', fontWeight: 700, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {pickedPair} · {prediction.margin}
                </div>
                <div style={{ fontSize: 10, color: MUTED, fontWeight: 600, marginTop: 2 }}>
                  {formatRelative(prediction.createdAt, locale)}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {result === null ? (
                  <div style={{ fontSize: 10, color: MUTED, fontWeight: 800 }}>{t('filterPending').toUpperCase()}</div>
                ) : isInvalidated ? (
                  <div style={{ fontSize: 10, color: MUTED, fontWeight: 800 }}>—</div>
                ) : isWrong ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: RED, fontVariantNumeric: 'tabular-nums' }}>+0 G</div>
                ) : (
                  <div style={{
                    fontSize: 12, fontWeight: 800,
                    color: result === 'upset' ? GOLD : GREEN,
                    fontVariantNumeric: 'tabular-nums',
                  }}>+{reward} G</div>
                )}
              </div>
            </div>
          </Link>
        )
      })}
    </>
  )
}

function ResultDot({ result }: { result: PredictionResult | null }) {
  const sty: React.CSSProperties = {
    width: 28, height: 28, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 14, fontWeight: 800, flexShrink: 0,
  }
  if (result === 'perfect') return <div style={{ ...sty, background: 'linear-gradient(135deg, #7ED321, #FFD166)', color: '#0a0a0a' }}>🎯</div>
  if (result === 'upset') return <div style={{ ...sty, background: 'linear-gradient(135deg, #FF6B2B, #FFD166)', color: '#0a0a0a' }}>🔥</div>
  if (result === 'right') return <div style={{ ...sty, background: GREEN, color: '#0a0a0a' }}>✓</div>
  if (result === 'wrong') return <div style={{ ...sty, background: 'rgba(255,70,85,0.18)', color: RED }}>✗</div>
  if (result === 'invalidated') return <div style={{ ...sty, background: 'rgba(255,255,255,0.04)', color: MUTED, fontSize: 13 }}>—</div>
  return <div style={{ ...sty, background: 'rgba(255,255,255,0.06)', color: MUTED, border: '0.5px dashed rgba(255,255,255,0.15)' }}>⏳</div>
}
