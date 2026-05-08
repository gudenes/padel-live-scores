// src/components/road-to-olympics/CopyButton.tsx
'use client'

import { useState } from 'react'

export default function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        } catch { /* clipboard API unavailable — leave the textarea visible */ }
      }}
      style={{
        background: '#7ed321', color: '#0a0a0a', fontWeight: 800,
        fontSize: 11, padding: '6px 12px', borderRadius: 999,
        letterSpacing: 0.5, border: 0, cursor: 'pointer',
      }}
    >
      {copied ? 'Copied' : label}
    </button>
  )
}
