// src/components/prediction/PredictionComparison.tsx
'use client'
import { useRef } from 'react'
import { useTranslations } from 'next-intl'
import type { Match } from '@/types/match'
import { getMatchPrediction } from '@/lib/match-prediction'
import { useInViewOnce } from '@/hooks/useInViewOnce'

// Pair colors mirror the match page's PAIR1_COLOR / PAIR2_COLOR so this block
// matches the momentum chart, stats bars and player cards. Pair 1 = orange,
// pair 2 = yellow.
const PAIR1_COLOR = '#FF6B2B'
const PAIR2_COLOR = '#FFD166'
const MODEL_COLOR = '#7ED321'  // brand lime — Predictor row label
const FANS_COLOR = '#9AAEC4'   // secondary — Fans row label
const CHUNKY_BAR = 'polygon(2% 10%, 99% 0%, 100% 90%, 1% 100%)'
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'

function CompareRow({ label, labelColor, p1Pct, inView, delay }: {
  label: string; labelColor: string; p1Pct: number; inView: boolean; delay: number
}) {
  const p2Pct = 100 - p1Pct
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: delay ? 9 : 0 }}>
      <span style={{ width: 66, flexShrink: 0, fontSize: 8.5, letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: 800, color: labelColor }}>{label}</span>
      <span style={{ width: 30, flexShrink: 0, fontSize: 12, fontWeight: 800, color: PAIR1_COLOR, fontVariantNumeric: 'tabular-nums' }}>{p1Pct}%</span>
      <div style={{
        flex: 1, display: 'flex', height: 5, overflow: 'hidden', clipPath: CHUNKY_BAR, background: 'rgba(255,255,255,0.06)',
        transform: inView ? 'scaleX(1)' : 'scaleX(0)', transformOrigin: 'left center',
        transition: `transform 700ms ${EASE}`, transitionDelay: `${delay}ms`,
      }}>
        <div style={{ width: `${p1Pct}%`, background: PAIR1_COLOR }} />
        <div style={{ width: `${p2Pct}%`, background: PAIR2_COLOR }} />
      </div>
      <span style={{ width: 30, flexShrink: 0, fontSize: 12, fontWeight: 800, color: PAIR2_COLOR, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p2Pct}%</span>
    </div>
  )
}

/** Compact "Predictor vs Fans" comparison shown once a match is locked
 *  (live/finished). Names appear once; each source is one labelled, animated
 *  bar so the model and the crowd read at a glance without repetition. */
export function PredictionComparison({ match, pair1Label, pair2Label, aggregate }: {
  match: Match
  pair1Label: string
  pair2Label: string
  aggregate: { pair1: number; pair2: number; total: number; real?: number } | null
}) {
  const t = useTranslations('prediction')
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInViewOnce(ref)

  const pred = getMatchPrediction(match)
  const hasCommunity = !!aggregate && (aggregate.real ?? aggregate.total) > 0 && aggregate.total > 0
  if (!pred && !hasCommunity) return null

  const modelP1 = pred ? Math.round(pred.pair1Prob * 100) : null
  const fansP1 = hasCommunity ? Math.round((aggregate!.pair1 / aggregate!.total) * 100) : null

  return (
    <div ref={ref} style={{ background: '#141414', padding: '13px 16px', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: '#ddd', marginBottom: 11 }}>
        <span>{pair1Label}</span><span>{pair2Label}</span>
      </div>
      {modelP1 != null && (
        <CompareRow label={t('predictorLabel')} labelColor={MODEL_COLOR} p1Pct={modelP1} inView={inView} delay={0} />
      )}
      {fansP1 != null && (
        <CompareRow label={t('fansLabel')} labelColor={FANS_COLOR} p1Pct={fansP1} inView={inView} delay={modelP1 != null ? 80 : 0} />
      )}
    </div>
  )
}
