'use client'

// Bottom sheet that explains how the Road-to-Trophy projection works, opened by
// the ⓘ on the projection hero. Personalized: the highlight block uses THIS
// pair's name + numbers (champion %/final % for contenders, the projected round
// for everyone else) so the explanation feels about the pair you're viewing.
//
// Structure mirrors the app's other info sheets (e.g. AISummaryInfoSheet):
// fixed scrim (tap to close), bottom sheet with a grab handle, maxHeight + scroll,
// and a ChunkyPressButton "Got it". Inner elements use the brand chunky clip-path.

import { useTranslations } from 'next-intl'
import { ChunkyPressButton } from '@/components/feed/foryou/ChunkyPressButton'

const TEXT = '#EEE4CE'
const SECONDARY = '#9AAEC4'
const LIME = '#7ED321'
const GOLD = '#F5A623'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const CHUNK = 'polygon(0% 4%, 99.5% 0%, 100% 96%, 0.5% 100%)'

interface Props {
  open: boolean
  onClose: () => void
  /** Display name for the pair, e.g. "Galán & Chingotto". */
  names: string
  /** True when the pair is a title contender (lead with champion %). */
  contender: boolean
  championPct: number
  finalPct: number
  /** Localized projected-round label, e.g. "Round of 16". */
  roundLabel: string
}

export function ProjectionExplainSheet({ open, onClose, names, contender, championPct, finalPct, roundLabel }: Props) {
  const t = useTranslations('projectionTab')
  if (!open) return null

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: '#0009', zIndex: 90 }} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="projection-explain-title"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0,
          background: '#1c1e20', color: TEXT,
          clipPath: 'polygon(0 13px, 100% 0, 100% 100%, 0 100%)',
          filter: 'drop-shadow(0 -10px 26px rgba(0,0,0,0.55))',
          padding: '16px 18px 26px',
          zIndex: 91, maxHeight: '85vh', overflowY: 'auto',
        }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 3, background: 'rgba(255,255,255,0.22)', margin: '0 auto 14px' }} />

        <h3 id="projection-explain-title" style={{ margin: '0 0 5px', fontSize: 18, fontWeight: 900, letterSpacing: 0.2 }}>
          {t('explainTitle')}
        </h3>
        <p style={{ color: SECONDARY, fontSize: 13, lineHeight: 1.5, margin: '0 0 16px' }}>{t('explainIntro')}</p>

        {[t('explainStep1'), t('explainStep2')].map((step, i) => (
          <div key={i} style={{ display: 'flex', gap: 11, marginBottom: 12 }}>
            <div style={{ flexShrink: 0, width: 23, height: 23, clipPath: CHUNK, background: 'rgba(126,211,33,0.16)', color: LIME, fontFamily: MONO, fontWeight: 800, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.45, color: TEXT, paddingTop: 1 }}>{step}</div>
          </div>
        ))}

        {/* Personalized highlight — uses this pair's name + numbers. */}
        <div style={{ marginTop: 8, background: 'rgba(126,211,33,0.07)', border: '1px solid rgba(126,211,33,0.22)', clipPath: CHUNK, padding: '14px 15px' }}>
          <div style={{ fontSize: 13, fontWeight: 900, marginBottom: contender ? 9 : 7 }}>{names}</div>
          {contender ? (
            <>
              <Stat n={`${championPct}%`} lab={t('explainWinTitle')} />
              <Stat n={`${finalPct}%`} lab={t('explainReachFinal')} />
              <div style={{ color: SECONDARY, fontSize: 11.5, lineHeight: 1.4, marginTop: 6, fontStyle: 'italic' }}>{t('explainKicker')}</div>
            </>
          ) : (
            <div style={{ color: TEXT, fontSize: 12.5, lineHeight: 1.5 }}>
              {t.rich('explainUnderdogBody', { round: roundLabel, r: (c) => <span style={{ color: GOLD, fontWeight: 800 }}>{c}</span> })}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <ChunkyPressButton variant="green" filled onClick={onClose} ariaLabel={t('explainClose')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '11px 22px', fontSize: 14, fontWeight: 800 }}>{t('explainClose')}</span>
          </ChunkyPressButton>
        </div>
      </div>
    </>
  )
}

function Stat({ n, lab }: { n: string; lab: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 7 }}>
      <span style={{ fontFamily: MONO, fontWeight: 800, color: LIME, fontSize: 16, minWidth: 44 }}>{n}</span>
      <span style={{ fontSize: 12, color: TEXT }}>{lab}</span>
    </div>
  )
}
