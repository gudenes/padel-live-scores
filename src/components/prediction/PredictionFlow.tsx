'use client'

import { useState, useCallback, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import type { Match } from '@/types/match'
import { pairName } from '@/types/match'
import {
  computeMatchProbability,
  computeMultiplier,
} from '@/lib/predictions/probability'
import { HEAVY_UPSET_THRESHOLD, STAKE_GUACAS } from '@/lib/predictions/constants'
import type { Pair, Margin, Prediction } from '@/lib/predictions/types'

const PAIR1_COLOR = '#FF6B2B'
const PAIR2_COLOR = '#FFD166'
const GREEN = '#7ED321'
const MUTED = '#6B7280'

const CHUNKY_BTN = 'polygon(2% 5%, 98% 0%, 100% 95%, 0% 100%)'
const CHUNKY_BAR = 'polygon(2% 10%, 99% 0%, 100% 90%, 1% 100%)'

type Step = 'pick' | 'margin' | 'done'

export interface PredictionFlowProps {
  match: Match
  prediction: Prediction | null
  onLockIn: (p: { pair: Pair; margin: Margin; probability: number; multiplier: number; isFallback: boolean }) => void
  onClear: () => void
  /** Called after the user locks in the margin. Parent can use this to trigger
   *  auto-collapse 1.4s later. */
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
      aria-label="guacas"
    >G</span>
  )
}

export function PredictionFlow({ match, prediction, onLockIn, onClear, onLocked }: PredictionFlowProps) {
  const t = useTranslations('prediction')
  const [step, setStep] = useState<Step>(prediction ? 'done' : 'pick')
  const [selectedPair, setSelectedPair] = useState<Pair | null>(prediction?.pair ?? null)

  const prob = computeMatchProbability(match)
  const m1 = computeMultiplier(prob.p1, false)
  const m2 = computeMultiplier(prob.p2, false)
  const reward1 = Math.round(STAKE_GUACAS * m1)
  const reward2 = Math.round(STAKE_GUACAS * m2)

  // Re-sync if a parent passes a freshly-cleared prediction.
  useEffect(() => {
    if (!prediction && step === 'done') setStep('pick')
  }, [prediction, step])

  const handlePickPair = useCallback((p: Pair) => {
    setSelectedPair(p)
    setStep('margin')
  }, [])

  const handlePickMargin = useCallback((margin: Margin) => {
    if (!selectedPair) return
    const chosenP = selectedPair === 1 ? prob.p1 : prob.p2
    const chosenM = selectedPair === 1 ? m1 : m2
    onLockIn({
      pair: selectedPair,
      margin,
      probability: chosenP,
      multiplier: chosenM,
      isFallback: prob.isFallback,
    })
    setStep('done')
    onLocked?.()
  }, [selectedPair, prob, m1, m2, onLockIn, onLocked])

  const handleChange = useCallback(() => {
    onClear()
    setSelectedPair(null)
    setStep('pick')
  }, [onClear])

  const p1Name = pairName(match.pair1_player1, match.pair1_player2)
  const p2Name = pairName(match.pair2_player1, match.pair2_player2)
  const shortP1 = p1Name.split(' / ').map(n => n.split(' ').slice(-1)[0]).join(' / ')
  const shortP2 = p2Name.split(' / ').map(n => n.split(' ').slice(-1)[0]).join(' / ')

  if (step === 'done' && prediction) {
    return (
      <div style={{
        background: 'rgba(126,211,33,0.10)', border: '0.5px solid rgba(126,211,33,0.25)',
        padding: 12, marginBottom: 12,
        clipPath: 'polygon(1% 5%, 99% 0%, 100% 95%, 0% 100%)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%', background: GREEN, color: '#0a0a0a',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 800, flexShrink: 0,
          }}>✓</div>
          <div>
            <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, color: GREEN, fontWeight: 800 }}>
              {t('lockedIn')}
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', lineHeight: 1.2 }}>
              {prediction.pair === 1 ? p1Name : p2Name} · {prediction.margin}
            </div>
          </div>
          <button
            onClick={handleChange}
            style={{
              marginLeft: 'auto', background: 'transparent', border: 0,
              fontSize: 10, fontWeight: 700, color: MUTED,
              textDecoration: 'underline', cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: 0.4,
            }}
          >{t('change')}</button>
        </div>
      </div>
    )
  }

  if (step === 'margin' && selectedPair) {
    const chosenName = selectedPair === 1 ? p1Name : p2Name
    const chosenReward = selectedPair === 1 ? reward1 : reward2
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        <div style={{
          background: 'rgba(126,211,33,0.06)', border: '0.5px solid rgba(126,211,33,0.18)',
          padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 11, color: GREEN, clipPath: CHUNKY_BAR,
        }}>
          <span>{t('youArePicking')}</span>
          <span style={{ fontWeight: 800, flex: 1 }}>{chosenName}</span>
          <span style={{ fontWeight: 800, color: '#FFD166', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            {chosenReward} <GuacaIcon size={10} />
          </span>
          <button
            onClick={handleChange}
            style={{ background: 'transparent', border: 0, fontSize: 10, color: MUTED, textDecoration: 'underline', cursor: 'pointer', marginLeft: 8 }}
          >{t('change')}</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['2-0', '2-1'] as const).map(margin => (
            <button
              key={margin}
              onClick={() => handlePickMargin(margin)}
              style={{
                flex: 1, background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                padding: '12px 8px', cursor: 'pointer', textAlign: 'center',
                clipPath: CHUNKY_BTN, color: '#fff',
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{margin.replace('-', ' – ')}</div>
              <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.4, color: MUTED, textTransform: 'uppercase', marginTop: 2 }}>
                {margin === '2-0' ? t('straightSets') : t('threeSets')}
              </div>
              <div style={{ fontSize: 9, fontWeight: 800, color: '#FFD166', marginTop: 4 }}>
                +0.50× bonus
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // step === 'pick'
  const isUpset1 = prob.p1 <= HEAVY_UPSET_THRESHOLD
  const isUpset2 = prob.p2 <= HEAVY_UPSET_THRESHOLD

  const pairButton = (pair: Pair, color: string, name: string, p: number, mult: number, reward: number, isUpset: boolean) => {
    const probLabel = prob.isFallback
      ? t('unrankedTossUp')
      : p > 0.55 ? t('favored', { pct: Math.round(p * 100) })
      : p < 0.45 ? t('underdog', { pct: Math.round(p * 100) })
      : t('tossUp', { pct: Math.round(p * 100) })
    return (
      <button
        key={pair}
        onClick={() => handlePickPair(pair)}
        style={{
          flex: 1, minWidth: 0, position: 'relative',
          background: 'rgba(255,255,255,0.03)',
          border: `1px solid ${color}55`,
          padding: '10px 8px 12px', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
          clipPath: CHUNKY_BTN, color: '#fff',
        }}
      >
        {isUpset && (
          <span style={{
            position: 'absolute', top: -7, right: -4,
            background: 'linear-gradient(135deg, #FF6B2B, #FFD166)',
            color: '#0a0a0a', fontSize: 7, fontWeight: 800, letterSpacing: 0.5,
            padding: '3px 6px', textTransform: 'uppercase',
            clipPath: 'polygon(8% 0%, 100% 0%, 92% 100%, 0% 100%)',
          }}>{t('upsetFlag')}</span>
        )}
        <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color }}>
          PAIR {pair}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', textAlign: 'center', lineHeight: 1.25 }}>{name}</span>
        <div style={{
          borderTop: '0.5px dashed rgba(255,255,255,0.10)',
          paddingTop: 7, marginTop: 4, width: '100%',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {probLabel}
          </span>
          <span style={{
            fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
            lineHeight: 1, letterSpacing: -0.5,
            color: p < 0.40 ? '#FF6B2B' : p < 0.55 ? '#FFD166' : GREEN,
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            {reward} <GuacaIcon size={16} />
          </span>
          <span style={{ fontSize: 8, fontWeight: 800, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 1 }}>
            {t('ifRight')}
          </span>
        </div>
      </button>
    )
  }

  return (
    <>
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.7, color: MUTED, textTransform: 'uppercase', textAlign: 'center', marginBottom: 8 }}>
        {t('makeYourPick')}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {pairButton(1, PAIR1_COLOR, shortP1, prob.p1, m1, reward1, isUpset1)}
        {pairButton(2, PAIR2_COLOR, shortP2, prob.p2, m2, reward2, isUpset2)}
      </div>
      <p style={{ textAlign: 'center', color: MUTED, fontSize: 10, margin: 0 }}>
        {t('marginBonus')}
      </p>
    </>
  )
}
