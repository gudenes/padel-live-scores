'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { GREEN, BG_CARD, BORDER, MUTED, CHUNKY } from '@/components/home/shared-constants'
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'

interface Props {
  onClose: () => void
}

export default function PledgeFormModal({ onClose }: Props) {
  const t = useTranslations('roadToOlympics.pledge')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [country, setCountry] = useState('')
  const [subscribed, setSubscribed] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/road-to-olympics/pledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, email, country, subscribed, source: 'hub' }),
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
        clipPath: CHUNKY.card, padding: 22, maxWidth: 420, width: '100%',
      }}>
        {done ? (
          <>
            <h2 style={{ color: GREEN, fontSize: 22, fontWeight: 800, margin: '0 0 8px' }}>{t('successTitle')}</h2>
            <p style={{ color: '#ccc', fontSize: 14, lineHeight: 1.5, margin: '0 0 20px' }}>{t('successBody')}</p>
            <PressButton type="button" onClick={onClose} {...PRESS_PRESETS.chunkyTilted} depth={3} style={modalCtaStyle}>OK</PressButton>
          </>
        ) : (
          <form onSubmit={submit}>
            <h2 style={{ color: '#fff', fontSize: 20, fontWeight: 800, margin: '0 0 8px' }}>{t('modalTitle')}</h2>
            <p style={{ color: '#ccc', fontSize: 13, lineHeight: 1.5, margin: '0 0 18px' }}>{t('modalIntro')}</p>
            <Field label={t('fieldName')}>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} style={inputStyle} />
            </Field>
            <Field label={t('fieldEmail')}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} style={inputStyle} />
            </Field>
            <Field label={t('fieldCountry')}>
              <input value={country} onChange={(e) => setCountry(e.target.value)} maxLength={2} placeholder="ES" style={inputStyle} />
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#ccc', margin: '8px 0 18px' }}>
              <input type="checkbox" checked={subscribed} onChange={(e) => setSubscribed(e.target.checked)} />
              {t('subscribeOptIn')}
            </label>
            {error && <div style={{ color: '#ff7878', fontSize: 12, marginBottom: 10 }}>{error}</div>}
            <PressButton type="submit" disabled={submitting} {...PRESS_PRESETS.chunkyTilted} depth={3} style={modalCtaStyle}>
              {submitting ? t('submitting') : t('submit')}
            </PressButton>
          </form>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 6, padding: '8px 10px', color: '#fff', fontSize: 13, marginTop: 4,
}
// Layout-only style for the PressButton CTAs in this modal. Visual
// (background, clipPath, color) comes from PRESS_PRESETS.chunkyTilted.
const modalCtaStyle: React.CSSProperties = {
  height: 40,
  padding: '0 18px',
  fontSize: 13,
  fontWeight: 800,
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>
      {label}
      {children}
    </label>
  )
}
