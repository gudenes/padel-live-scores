// src/components/road-to-olympics/CopyButton.tsx
'use client'

import { useState } from 'react'
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'

export default function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <PressButton
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch { /* clipboard API unavailable — leave the textarea visible */ }
      }}
      {...PRESS_PRESETS.chunkyTilted}
      depth={3}
      style={{
        height: 28,
        padding: '0 12px',
        fontWeight: 800,
        fontSize: 11,
        letterSpacing: 0.5,
      }}
    >
      {copied ? 'Copied' : label}
    </PressButton>
  )
}
