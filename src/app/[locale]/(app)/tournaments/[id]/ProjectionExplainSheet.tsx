'use client'

// Bottom sheet explaining the Road-to-Trophy projection, opened by the ⓘ on
// the projection hero. Personalized: the highlight block uses THIS pair's name
// + numbers. Chrome is the shared ExplainSheet.

import { useTranslations } from 'next-intl'
import { ExplainSheet } from '@/components/ExplainSheet'

const TEXT = '#EEE4CE'
const SECONDARY = '#9AAEC4'
const LIME = '#7ED321'
const GOLD = '#F5A623'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

interface Props {
  open: boolean
  onClose: () => void
  names: string
  contender: boolean
  championPct: number
  finalPct: number
  roundLabel: string
}

export function ProjectionExplainSheet({ open, onClose, names, contender, championPct, finalPct, roundLabel }: Props) {
  const t = useTranslations('projectionTab')

  const highlight = (
    <>
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
    </>
  )

  return (
    <ExplainSheet
      open={open}
      onClose={onClose}
      titleId="projection-explain-title"
      title={t('explainTitle')}
      intro={t('explainIntro')}
      steps={[t('explainStep1'), t('explainStep2')]}
      highlight={highlight}
      closeLabel={t('explainClose')}
    />
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
