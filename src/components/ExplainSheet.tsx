// src/components/ExplainSheet.tsx
'use client'

// Shared bottom-sheet "explainer" chrome used by ProjectionExplainSheet and
// MoneyExplainSheet. Portals to <body> (a transformed ancestor would otherwise
// pin position:fixed to itself). Backdrop tap closes; taps inside don't.
// Brand chunky clip-path, grab handle, numbered chunky-chip steps, an optional
// lime highlight box, and a green "Got it" ChunkyPressButton.

import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { ChunkyPressButton } from '@/components/feed/foryou/ChunkyPressButton'

export const TEXT = '#EEE4CE'
export const SECONDARY = '#9AAEC4'
export const LIME = '#7ED321'
export const GOLD = '#F5A623'
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const CHUNK = 'polygon(0% 4%, 99.5% 0%, 100% 96%, 0.5% 100%)'

export interface ExplainSheetProps {
  open: boolean
  onClose: () => void
  title: string
  intro: string
  /** Numbered steps; each rendered beside a chunky lime chip. */
  steps: ReactNode[]
  /** Optional content rendered inside the lime highlight box below the steps. */
  highlight?: ReactNode
  /** Close-button label. */
  closeLabel: string
  /** id for aria-labelledby; defaults to "explain-sheet-title". */
  titleId?: string
}

export function ExplainSheet({
  open, onClose, title, intro, steps, highlight, closeLabel,
  titleId = 'explain-sheet-title',
}: ExplainSheetProps) {
  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#0009', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 500,
          background: '#1c1e20', color: TEXT,
          clipPath: 'polygon(0 13px, 100% 0, 100% 100%, 0 100%)',
          filter: 'drop-shadow(0 -10px 26px rgba(0,0,0,0.55))',
          padding: '16px 18px 26px',
          maxHeight: '85vh', overflowY: 'auto',
        }}
      >
        <div style={{ width: 40, height: 4, borderRadius: 3, background: 'rgba(255,255,255,0.22)', margin: '0 auto 14px' }} />

        <h3 id={titleId} style={{ margin: '0 0 5px', fontSize: 18, fontWeight: 900, letterSpacing: 0.2 }}>{title}</h3>
        <p style={{ color: SECONDARY, fontSize: 13, lineHeight: 1.5, margin: '0 0 16px' }}>{intro}</p>

        {steps.map((step, i) => (
          <div key={i} style={{ display: 'flex', gap: 11, marginBottom: 12 }}>
            <div style={{ flexShrink: 0, width: 23, height: 23, clipPath: CHUNK, background: 'rgba(126,211,33,0.16)', color: LIME, fontFamily: MONO, fontWeight: 800, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.45, color: TEXT, paddingTop: 1 }}>{step}</div>
          </div>
        ))}

        {highlight != null && (
          <div style={{ marginTop: 8, background: 'rgba(126,211,33,0.07)', border: '1px solid rgba(126,211,33,0.22)', clipPath: CHUNK, padding: '14px 15px' }}>
            {highlight}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <ChunkyPressButton variant="green" filled onClick={onClose} ariaLabel={closeLabel}>
            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '11px 22px', fontSize: 14, fontWeight: 800 }}>{closeLabel}</span>
          </ChunkyPressButton>
        </div>
      </div>
    </div>,
    document.body,
  )
}
