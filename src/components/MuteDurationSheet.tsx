'use client'
// src/components/MuteDurationSheet.tsx
//
// Bottom sheet for picking a mute duration. Returns an ISO timestamp (or
// the sentinel string 'forever') to the caller via onPick.
//
// Durations:
//   1h       — now + 1 hour
//   4h       — now + 4 hours
//   tomorrow — tomorrow 8 AM in the user's local timezone
//   forever  — sentinel; mute_until stored as 'forever'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'

type Duration = '1h' | '4h' | 'tomorrow' | 'forever'

interface MuteDurationSheetProps {
  open: boolean
  onClose: () => void
  onPick: (until: string) => void
}

function computeMuteUntil(duration: Duration): string {
  if (duration === 'forever') return 'forever'
  const now = new Date()
  if (duration === '1h') return new Date(now.getTime() + 3600_000).toISOString()
  if (duration === '4h') return new Date(now.getTime() + 4 * 3600_000).toISOString()
  // tomorrow 8am local
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(8, 0, 0, 0)
  return tomorrow.toISOString()
}

export function MuteDurationSheet({ open, onClose, onPick }: MuteDurationSheetProps) {
  const t = useTranslations('notifications.settings.mute')

  // Close on Escape key
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const pick = (d: Duration) => {
    onPick(computeMuteUntil(d))
    onClose()
  }

  const options: Array<{ key: Duration; labelKey: string }> = [
    { key: '1h', labelKey: 'durations.1h' },
    { key: '4h', labelKey: 'durations.4h' },
    { key: 'tomorrow', labelKey: 'durations.tomorrow' },
    { key: 'forever', labelKey: 'durations.forever' },
  ]

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200 }}
      />
      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('label')}
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: '#1A1A1A', borderTop: '1px solid rgba(255,255,255,0.10)',
          padding: '16px 16px 28px', zIndex: 201,
        }}
      >
        <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,0.20)', borderRadius: 999, margin: '0 auto 14px' }} />
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 14px', textAlign: 'center', color: '#fff' }}>
          {t('label')}
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {options.map(opt => (
            <button
              key={opt.key}
              type="button"
              onClick={() => pick(opt.key)}
              style={{
                padding: '14px', background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#fff', fontSize: 14, fontWeight: 600, textAlign: 'left',
                cursor: 'pointer',
                clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
              }}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
