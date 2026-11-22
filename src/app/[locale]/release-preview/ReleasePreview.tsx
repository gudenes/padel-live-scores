'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import ReleasePopup from '@/components/releases/ReleasePopup'
import { getReleaseCopy } from '@/components/releases/release-copy'
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'

export default function ReleasePreview() {
  const locale = useLocale()
  const [open, setOpen] = useState(true)
  return <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#111' }}>
    <PressButton {...PRESS_PRESETS.chunkyTilted} onClick={() => setOpen(true)}>{getReleaseCopy(locale).new}</PressButton>
    {open && <ReleasePopup open locale={locale} onClose={() => setOpen(false)} />}
  </main>
}
