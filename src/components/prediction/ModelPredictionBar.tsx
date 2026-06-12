// src/components/prediction/ModelPredictionBar.tsx
'use client'
import { useTranslations } from 'next-intl'
import type { Match } from '@/types/match'
import { getMatchPrediction } from '@/lib/match-prediction'

// Pair colors mirror the match page's PAIR1_COLOR / PAIR2_COLOR
// (src/app/[locale]/match/[id]/lib/constants.ts) so the prediction bar stays
// consistent with the momentum chart, stats bars, and player cards shown
// further down the page. Pair 1 = brand orange, pair 2 = brand yellow.
const PAIR1_COLOR = '#FF6B2B'
const PAIR2_COLOR = '#FFD166'
const ACCENT = '#7ED321' // brand lime — only for the prediction label
const CHUNKY_BAR = 'polygon(2% 10%, 99% 0%, 100% 90%, 1% 100%)'

export function ModelPredictionBar({ match, pair1Label, pair2Label }: {
  match: Match; pair1Label: string; pair2Label: string
}) {
  const t = useTranslations('prediction')
  const pred = getMatchPrediction(match)
  if (!pred) return null
  const p1Pct = Math.round(pred.pair1Prob * 100)
  const p2Pct = 100 - p1Pct
  return (
    <div style={{ background: '#141414', padding: '12px 16px', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 800, color: ACCENT, marginBottom: 8 }}>
        {t('modelTitle')}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: '#ddd', marginBottom: 5 }}>
        <span>{pair1Label}</span><span>{pair2Label}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginBottom: 5 }}>
        <span style={{ color: PAIR1_COLOR }}>{p1Pct}%</span>
        <span style={{ color: PAIR2_COLOR }}>{p2Pct}%</span>
      </div>
      {/* Two-segment bar: pair 1 (orange) | pair 2 (yellow), widths = win % */}
      <div style={{ display: 'flex', height: 6, overflow: 'hidden', clipPath: CHUNKY_BAR, background: 'rgba(255,255,255,0.06)' }}>
        <div style={{ width: `${p1Pct}%`, background: PAIR1_COLOR }} />
        <div style={{ width: `${p2Pct}%`, background: PAIR2_COLOR }} />
      </div>
    </div>
  )
}
