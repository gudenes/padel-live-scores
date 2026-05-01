'use client'

import { useTranslations } from 'next-intl'
import type { Match } from '@/types/match'
import { computeMatchProbability } from '@/lib/predictions/probability'
import { classifyResult, computeReward } from '@/lib/predictions/scoring'
import type { Prediction } from '@/lib/predictions/types'
import { useMatchPrediction } from '@/hooks/useMatchPrediction'
import { PredictionFlow } from './PredictionFlow'

const GREEN = '#7ED321'
const MUTED = '#6B7280'

const CHUNKY_BAR = 'polygon(2% 10%, 99% 0%, 100% 90%, 1% 100%)'
const CHUNKY_TILE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

// Probability bar fills from 0 to its target width on every mount.
// PredictionPanel is conditionally rendered ({isOpen && <PredictionPanel ... />}
// in MatchCard) so a fresh mount = fresh fill on every panel open.
const PANEL_KEYFRAMES = `
@keyframes pn-bar-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
`

type PanelMode = 'prePick' | 'live' | 'finished' | 'lockedNoPick'

export interface PredictionPanelProps {
  match: Match
  /** Optional sponsor brand name. Empty in v1. */
  sponsorBrand?: string | null
  /** Auto-collapse callback fired ~1.4s after the user locks in. */
  onLocked?: () => void
}

function GuacaIcon({ size = 12 }: { size?: number }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size, height: size, borderRadius: '50%',
        background: GREEN, color: '#0a0a0a',
        fontSize: size * 0.62, fontWeight: 900, lineHeight: 1,
      }}
    >G</span>
  )
}

function deriveMode(match: Match, prediction: Prediction | null): PanelMode {
  const status = match.status as string
  if (['finished', 'ended', 'walkover', 'retired'].includes(status)) return 'finished'
  if (status === 'live' || status === 'on_court') return prediction ? 'live' : 'lockedNoPick'
  return 'prePick'
}

export function PredictionPanel({ match, sponsorBrand, onLocked }: PredictionPanelProps) {
  const t = useTranslations('prediction')
  const { prediction, setPrediction, clearPrediction } = useMatchPrediction(match.id)
  const mode = deriveMode(match, prediction)
  const prob = computeMatchProbability(match)

  const renderProbBar = () => {
    if (prob.isFallback) return null
    const p1Pct = Math.round(prob.p1 * 100)
    const p2Pct = 100 - p1Pct
    const leftIsBigger = prob.p1 >= prob.p2
    return (
      <>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>
          <span style={{ color: leftIsBigger ? GREEN : MUTED }}>{p1Pct}%</span>
          <span style={{ color: !leftIsBigger ? GREEN : MUTED }}>{p2Pct}%</span>
        </div>
        <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', clipPath: CHUNKY_BAR, marginBottom: 12 }}>
          <div style={{
            height: '100%', width: `${p1Pct}%`,
            background: 'linear-gradient(90deg, #7ED321, #5fb314)',
            transformOrigin: 'left center',
            animation: 'pn-bar-grow 700ms cubic-bezier(0.16, 1, 0.3, 1) both',
          }} />
        </div>
      </>
    )
  }

  const renderStatsTile = (value: string, label: string) => (
    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '7px 6px', textAlign: 'center', clipPath: CHUNKY_TILE }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.5, color: MUTED, marginTop: 2, fontWeight: 700 }}>{label}</div>
    </div>
  )

  const avgRank1 = (() => {
    const rs = [match.pair1_player1?.ranking, match.pair1_player2?.ranking].filter((r): r is number => typeof r === 'number')
    return rs.length ? Math.round(rs.reduce((a, b) => a + b, 0) / rs.length) : null
  })()
  const avgRank2 = (() => {
    const rs = [match.pair2_player1?.ranking, match.pair2_player2?.ranking].filter((r): r is number => typeof r === 'number')
    return rs.length ? Math.round(rs.reduce((a, b) => a + b, 0) / rs.length) : null
  })()
  const avgRankLabel = (avgRank1 != null && avgRank2 != null) ? `#${avgRank1} vs #${avgRank2}` : '—'

  const renderResultBlock = () => {
    if (!prediction) return null
    // NEW API: classifyResult returns { result, marginCorrect } | null
    const classified = classifyResult(prediction, match)
    if (!classified) return null
    const result = classified.result
    const reward = computeReward(prediction, classified)

    const labelKey =
      result === 'perfect' ? 'result.perfect'
      : result === 'right' ? 'result.right'
      : result === 'wrong' ? 'result.wrong'
      : result === 'upset' ? 'result.heavyUpset'
      : null
    if (!labelKey) return null  // 'invalidated' renders nothing

    const isPositive = result === 'perfect' || result === 'right' || result === 'upset'
    const isUpset = result === 'upset'
    const bg = isUpset
      ? 'linear-gradient(90deg, rgba(255,107,43,0.10), rgba(255,209,102,0.10))'
      : isPositive ? 'rgba(126,211,33,0.10)' : 'rgba(255,70,85,0.08)'
    const border = isUpset
      ? '0.5px solid rgba(255,209,102,0.25)'
      : isPositive ? '0.5px solid rgba(126,211,33,0.22)' : '0.5px solid rgba(255,70,85,0.18)'
    const rewardColor = isUpset ? '#FFD166' : isPositive ? GREEN : '#FF4655'
    const ico = isUpset ? '🔥' : result === 'perfect' ? '🎯' : isPositive ? '✓' : '✗'

    return (
      <div style={{
        padding: '10px 12px', marginBottom: 12,
        background: bg, border, clipPath: 'polygon(1% 5%, 99% 0%, 100% 95%, 0% 100%)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, fontWeight: 800, flexShrink: 0,
          background: isPositive ? (isUpset ? 'linear-gradient(135deg, #FF6B2B, #FFD166)' : GREEN) : 'rgba(255,70,85,0.2)',
          color: isPositive ? '#0a0a0a' : '#FF4655',
        }}>{ico}</div>
        <div>
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 800, color: rewardColor }}>
            {t(labelKey as any)}
          </div>
          <div style={{ fontSize: 12, color: '#fff', fontWeight: 600, lineHeight: 1.3, marginTop: 1 }}>
            {prediction.pair === 1
              ? match.pair1_player1?.name : match.pair2_player1?.name} · {prediction.margin}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 24, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5, color: rewardColor, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          +{reward} <GuacaIcon size={16} />
        </div>
      </div>
    )
  }

  return (
    <div style={{ paddingTop: 8 }}>
      <style>{PANEL_KEYFRAMES}</style>
      {mode === 'prePick' && (
        <PredictionFlow
          match={match}
          prediction={prediction}
          onLockIn={(p) => setPrediction(p)}
          onClear={clearPrediction}
          onLocked={onLocked}
        />
      )}

      {mode === 'live' && prediction && (
        <div style={{
          background: 'rgba(126,211,33,0.08)',
          border: '0.5px solid rgba(126,211,33,0.18)',
          padding: '10px 12px', marginBottom: 12,
          clipPath: 'polygon(1% 5%, 99% 0%, 100% 95%, 0% 100%)',
        }}>
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, color: GREEN, fontWeight: 800 }}>
            {t('live.yourPickHeader')}
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>
            {prediction.pair === 1
              ? match.pair1_player1?.name : match.pair2_player1?.name} · {prediction.margin}
          </div>
        </div>
      )}

      {mode === 'finished' && renderResultBlock()}

      {renderProbBar()}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 10 }}>
        {renderStatsTile(avgRankLabel, t('stats.avgRanking'))}
        {renderStatsTile('—', t('stats.lastFive'))}
        {renderStatsTile('—', t('stats.h2h'))}
      </div>

      {sponsorBrand ? (
        <div style={{ textAlign: 'center', fontSize: 8, color: MUTED, marginTop: 9, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>
          {t('sponsor', { brand: sponsorBrand })}
        </div>
      ) : null}
    </div>
  )
}
