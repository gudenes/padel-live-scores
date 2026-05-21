// src/components/road-to-olympics/CorrectionsCTA.tsx
'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { GREEN, BG_CARD, BORDER, CHUNKY } from '@/components/home/shared-constants'
import CorrectionsModal from './CorrectionsModal'
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'

export default function CorrectionsCTA() {
  const t = useTranslations('roadToOlympics.corrections')
  const [open, setOpen] = useState(false)

  return (
    <>
      <div style={{
        background: BG_CARD,
        border: `1px solid ${BORDER}`,
        clipPath: CHUNKY.card,
        padding: '14px 16px',
        marginBottom: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
            {t('cardTitle')}
          </div>
          <div style={{ fontSize: 12, color: '#b8b8b8', lineHeight: 1.4 }}>
            {t('cardBody')}
          </div>
        </div>
        <PressButton
          type="button"
          onClick={() => setOpen(true)}
          {...PRESS_PRESETS.chunkyInline}
          style={{
            height: 32,
            padding: '0 16px',
            fontWeight: 800,
            fontSize: 11,
            whiteSpace: 'nowrap',
            letterSpacing: 0.5,
          }}
        >
          {t('cardCta')}
        </PressButton>
      </div>

      {open && <CorrectionsModal onClose={() => setOpen(false)} />}
    </>
  )
}
