// src/components/road-to-olympics/CorrectionsModal.tsx
'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { GREEN, BG_CARD, BORDER, MUTED, CHUNKY } from '@/components/home/shared-constants'

interface Props {
  onClose: () => void
}

type ContactType = 'correction' | 'information' | 'other'

export default function CorrectionsModal({ onClose }: Props) {
  const t = useTranslations('roadToOlympics.corrections')
  const locale = useLocale()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [type, setType] = useState<ContactType>('correction')
  const [honeypot, setHoneypot] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/road-to-olympics/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message, type, locale, honeypot }),
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
        clipPath: CHUNKY.card, padding: 22, maxWidth: 460, width: '100%',
      }}>
        {done ? (
          <>
            <h2 style={{ color: GREEN, fontSize: 22, fontWeight: 800, margin: '0 0 8px' }}>{t('successTitle')}</h2>
            <p style={{ color: '#ccc', fontSize: 14, lineHeight: 1.5, margin: '0 0 20px' }}>{t('successBody')}</p>
            <button type="button" onClick={onClose} style={ctaStyle}>OK</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <h2 style={{ color: '#fff', fontSize: 20, fontWeight: 800, margin: '0 0 8px' }}>{t('modalTitle')}</h2>
            <p style={{ color: '#ccc', fontSize: 13, lineHeight: 1.5, margin: '0 0 18px' }}>{t('modalIntro')}</p>

            <Field label={t('fieldType')}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                {(['correction', 'information', 'other'] as const).map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setType(opt)}
                    style={{
                      background: type === opt ? GREEN : 'rgba(255,255,255,0.04)',
                      color: type === opt ? '#0a0a0a' : '#ccc',
                      border: `1px solid ${type === opt ? GREEN : BORDER}`,
                      clipPath: CHUNKY.badge,
                      padding: '5px 12px',
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: 0.4,
                      cursor: 'pointer',
                    }}
                  >
                    {t(`type_${opt}`)}
                  </button>
                ))}
              </div>
            </Field>

            <Field label={t('fieldName')}>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} style={inputStyle} />
            </Field>

            <Field label={t('fieldEmail')}>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} style={inputStyle} />
            </Field>

            <Field label={t('fieldMessage')}>
              <textarea required value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} rows={5}
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', minHeight: 80 }} />
            </Field>

            {/* Honeypot — visually hidden, bots fill it in */}
            <input
              type="text" tabIndex={-1} autoComplete="off"
              value={honeypot} onChange={(e) => setHoneypot(e.target.value)}
              style={{
                position: 'absolute', left: '-9999px', top: 'auto',
                width: 1, height: 1, overflow: 'hidden',
              }}
              aria-hidden="true"
            />

            {error && (
              <div style={{ color: '#ff7878', fontSize: 12, marginBottom: 10 }}>
                {t(`error_${error}` as Parameters<typeof t>[0])}
              </div>
            )}
            <button type="submit" disabled={submitting} style={ctaStyle}>
              {submitting ? t('submitting') : t('submit')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#1a1a1a', border: `1px solid ${BORDER}`,
  borderRadius: 6, padding: '8px 10px', color: '#fff', fontSize: 13, marginTop: 4,
}
const ctaStyle: React.CSSProperties = {
  background: GREEN, color: '#0a0a0a', fontWeight: 800, fontSize: 13,
  padding: '10px 18px', clipPath: CHUNKY.button, border: 0, cursor: 'pointer',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>
      {label}
      {children}
    </label>
  )
}
