// src/components/prediction/ModelPredictionBar.tsx
'use client'
import { useTranslations } from 'next-intl'
import type { Match } from '@/types/match'
import { getMatchPrediction } from '@/lib/match-prediction'

const GREEN = '#7ED321'
const MUTED = '#6B7280'
const CHUNKY_BAR = 'polygon(2% 10%, 99% 0%, 100% 90%, 1% 100%)'
const KEYFRAMES = `@keyframes pn-pred-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }`

export function ModelPredictionBar({ match, pair1Label, pair2Label }: {
  match: Match; pair1Label: string; pair2Label: string
}) {
  const t = useTranslations('prediction')
  const pred = getMatchPrediction(match)
  if (!pred) return null
  const p1Pct = Math.round(pred.pair1Prob * 100)
  const p2Pct = 100 - p1Pct
  const leftBigger = pred.favored === 1
  return (
    <div style={{ background: '#141414', padding: '12px 16px', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
      <style>{KEYFRAMES}</style>
      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 800, color: GREEN, marginBottom: 8 }}>
        🥑 {t('modelTitle')}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: '#ddd', marginBottom: 4 }}>
        <span>{pair1Label}</span><span>{pair2Label}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>
        <span style={{ color: leftBigger ? GREEN : MUTED }}>{p1Pct}%</span>
        <span style={{ color: !leftBigger ? GREEN : MUTED }}>{p2Pct}%</span>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', clipPath: CHUNKY_BAR }}>
        <div style={{
          height: '100%', width: `${p1Pct}%`,
          background: 'linear-gradient(90deg, #7ED321, #5fb314)',
          transformOrigin: 'left center',
          animation: 'pn-pred-grow 700ms cubic-bezier(0.16, 1, 0.3, 1) both',
        }} />
      </div>
    </div>
  )
}
