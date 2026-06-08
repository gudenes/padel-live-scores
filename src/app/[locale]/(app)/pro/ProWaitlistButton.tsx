// src/app/[locale]/(app)/pro/ProWaitlistButton.tsx
'use client'
import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'

export default function ProWaitlistButton() {
  const t = useTranslations('pro')
  const locale = useLocale()
  const [state, setState] = useState<'idle' | 'saving' | 'joined' | 'error'>('idle')

  const join = async () => {
    if (state === 'saving' || state === 'joined') return
    setState('saving')
    try {
      const res = await fetch('/api/pro/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale }),
      })
      setState(res.ok ? 'joined' : 'error')
    } catch {
      setState('error')
    }
  }

  return (
    <div style={{ marginTop: 18 }}>
      <PressButton
        {...PRESS_PRESETS.chunkyTilted}
        onClick={join}
        disabled={state === 'saving' || state === 'joined'}
        style={{ width: '100%', padding: '15px', fontSize: 13, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5 }}
      >
        {state === 'joined' ? t('cta.joined') : state === 'saving' ? t('cta.saving') : t('cta.join')}
      </PressButton>
      <div style={{ textAlign: 'center', fontSize: 10.5, color: 'rgba(255,255,255,0.45)', marginTop: 12 }}>
        {state === 'error' ? t('cta.error') : t('cta.sub')}
      </div>
    </div>
  )
}
