'use client'

// Bottom sheet that explains what an "AI Summary" is. Triggered by tapping
// the AI chip in the For You card meta row. Single-purpose, no state to
// manage besides open/close — keeps the cognitive load near the chip itself
// rather than pulling the user out into a separate page.
//
// Sits at z=91 to match SuggestSourceSheet's stacking (overlay sheet over
// the For You feed which already lives above the home page).

import { useTranslations } from 'next-intl'
import { ChunkyPressButton } from './ChunkyPressButton'

interface Props {
  open: boolean
  onClose: () => void
}

export function AISummaryInfoSheet({ open, onClose }: Props) {
  const t = useTranslations('foryou')

  if (!open) return null

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: '#0009', zIndex: 90 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-summary-explain-title"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0,
          background: '#0f0f0f', color: '#fff',
          borderTop: '1px solid #2a2a2a',
          borderRadius: '16px 16px 0 0',
          padding: 24,
          zIndex: 91,
          maxHeight: '85vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ width: 40, height: 4, background: '#444', borderRadius: 2, margin: '0 auto 16px' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          {/* Same sparkle icon used in the chip — keeps the visual link */}
          <svg aria-hidden width={20} height={20} viewBox="0 0 24 24" fill="currentColor" style={{ color: 'rgba(184,143,255,0.95)', flexShrink: 0 }}>
            <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" />
          </svg>
          <h3 id="ai-summary-explain-title" style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
            {t('aiSummaryExplainTitle')}
          </h3>
        </div>

        <p style={{ color: '#cfcfcf', fontSize: 14, lineHeight: 1.5, margin: 0 }}>
          {t('aiSummaryExplainBody')}
        </p>

        {/* #lib-saved variant from public/mockup-buttons.html — chunky-tilted
            shape, intent-primary (green), leading checkmark icon. Same
            primitive used by "Read article" at the bottom of every For You
            card. The check icon signals confirmation ("got it / understood")
            which matches the explainer-acknowledgement semantics. */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <ChunkyPressButton variant="green" onClick={onClose} ariaLabel={t('aiSummaryExplainClose')}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 22px', fontSize: 14, fontWeight: 800 }}>
              <svg aria-hidden width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
              </svg>
              {t('aiSummaryExplainClose')}
            </span>
          </ChunkyPressButton>
        </div>
      </div>
    </>
  )
}
