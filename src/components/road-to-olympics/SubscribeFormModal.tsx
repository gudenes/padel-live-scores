'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { GREEN, BG_CARD, BORDER, MUTED, CHUNKY } from '@/components/home/shared'

interface Props {
  onClose: () => void
}

export default function SubscribeFormModal({ onClose }: Props) {
  const t = useTranslations('roadToOlympics.subscribe')
  const locale = useLocale()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/road-to-olympics/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, locale }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error ?? 'server_error')
        return
      }
      setDone(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: BG_CARD, border: `1px solid ${BORDER}`,
        clipPath: CHUNKY.card, padding: 22, maxWidth: 380, width: '100%',
      }}>
        {done ? (
          <>
            <h2 style={{ color: GREEN, fontSize: 20, fontWeight: 800, margin: '0 0 12px' }}>{t('checkInbox')}</h2>
            <button type="button" onClick={onClose} style={ctaStyle}>OK</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <h2 style={{ color: '#fff', fontSize: 20, fontWeight: 800, margin: '0 0 8px' }}>{t('modalTitle')}</h2>
            <p style={{ color: '#ccc', fontSize: 13, lineHeight: 1.5, margin: '0 0 18px' }}>{t('modalIntro')}</p>
            <label style={{ display: 'block', fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 14 }}>
              {t('fieldEmail')}
              <input
                type="email" required
                value={email} onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
                style={{
                  width: '100%', background: '#1a1a1a',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 6, padding: '8px 10px', color: '#fff',
                  fontSize: 13, marginTop: 4,
                }}
              />
            </label>
            {error && <div style={{ color: '#ff7878', fontSize: 12, marginBottom: 10 }}>{error}</div>}
            <button type="submit" disabled={submitting} style={ctaStyle}>
              {submitting ? t('submitting') : t('submit')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

const ctaStyle: React.CSSProperties = {
  background: GREEN, color: '#0a0a0a', fontWeight: 800, fontSize: 13,
  padding: '10px 18px', clipPath: CHUNKY.button, border: 0, cursor: 'pointer',
}
