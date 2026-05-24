'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

interface Props {
  open: boolean
  onClose: () => void
}

type Stage = 'form' | 'submitting' | 'success-happy' | 'success-dup' | 'success-default' | 'error'

export function SuggestSourceSheet({ open, onClose }: Props) {
  const t = useTranslations('foryou.suggest')
  const [stage, setStage] = useState<Stage>('form')
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [email, setEmail] = useState('')
  const [detectedName, setDetectedName] = useState<string | null>(null)
  const [detectedType, setDetectedType] = useState<'rss' | 'wp-api' | 'google-news-search' | 'unknown' | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>('')

  if (!open) return null

  const submit = async () => {
    if (!/^https?:\/\/.+/.test(url)) { setErrorMsg(t('errorInvalidUrl')); setStage('error'); return }
    setStage('submitting'); setErrorMsg('')
    try {
      const r = await fetch('/api/feed/suggest-source', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, note: note || undefined, suggested_by_email: email || undefined }),
      })
      const d = await r.json().catch(() => ({})) as { status?: string; detected?: { type?: 'rss' | 'wp-api' | 'google-news-search' | 'unknown'; name?: string }; error?: string }
      if (r.status === 429) { setErrorMsg(t('errorRateLimit')); setStage('error'); return }
      if (!r.ok) { setErrorMsg(t('errorGeneric')); setStage('error'); return }

      if (d.status === 'duplicate') { setStage('success-dup'); return }
      if (d.detected?.type && d.detected.type !== 'unknown' && d.detected.name) {
        setDetectedName(d.detected.name); setDetectedType(d.detected.type)
        setStage('success-happy'); return
      }
      setStage('success-default')
    } catch {
      setErrorMsg(t('errorGeneric')); setStage('error')
    }
  }

  const reset = () => {
    setUrl(''); setNote(''); setEmail(''); setDetectedName(null); setDetectedType(null); setErrorMsg('')
    setStage('form'); onClose()
  }

  return (
    <>
      <div onClick={reset} style={{ position: 'fixed', inset: 0, background: '#0009', zIndex: 90 }} />
      <div role="dialog" aria-modal="true"
        style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: '#0f0f0f', color: '#fff', borderTop: '1px solid #2a2a2a', borderRadius: '16px 16px 0 0', padding: 24, zIndex: 91, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ width: 40, height: 4, background: '#444', borderRadius: 2, margin: '0 auto 16px' }} />

        {(stage === 'form' || stage === 'submitting' || stage === 'error') && (
          <>
            <h3 style={{ margin: 0, fontSize: 18 }}>{t('title')}</h3>
            <p style={{ color: '#aaa', fontSize: 13, marginTop: 8 }}>{t('description')}</p>
            <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder={t('urlPlaceholder')}
              style={inputStyle} disabled={stage === 'submitting'} />
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder={t('noteLabel')} maxLength={500} rows={3}
              style={{ ...inputStyle, marginTop: 8, fontFamily: 'inherit' }} disabled={stage === 'submitting'} />
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t('emailLabel')}
              style={{ ...inputStyle, marginTop: 8 }} disabled={stage === 'submitting'} />

            {stage === 'error' && <div style={{ marginTop: 12, color: '#E53935', fontSize: 13 }}>{errorMsg}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={reset} style={btnSecondary}>{t('cancel')}</button>
              <button onClick={submit} disabled={stage === 'submitting' || !url} style={btnPrimary}>
                {stage === 'submitting' ? '…' : t('submit')}
              </button>
            </div>
          </>
        )}

        {stage === 'success-happy' && detectedName && detectedType && (
          <SuccessView body={t('successHappy', { type: t(`typeLabel.${detectedType}`), name: detectedName })} onClose={reset} t={t} />
        )}
        {stage === 'success-dup' && <SuccessView body={t('successDup')} onClose={reset} t={t} />}
        {stage === 'success-default' && <SuccessView body={t('successDefault')} onClose={reset} t={t} />}
      </div>
    </>
  )
}

function SuccessView({ body, onClose, t }: { body: string; onClose: () => void; t: ReturnType<typeof useTranslations> }) {
  return (
    <div style={{ textAlign: 'center', padding: '8px 0' }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
      <p style={{ color: '#ccc', fontSize: 14, lineHeight: 1.4 }}>{body}</p>
      <button onClick={onClose} style={{ ...btnPrimary, marginTop: 16 }}>{t('done')}</button>
    </div>
  )
}

const inputStyle: React.CSSProperties = { width: '100%', background: '#1a1a1a', color: '#fff', border: '1px solid #2a2a2a', padding: 10, fontSize: 14, marginTop: 12 }
const btnPrimary: React.CSSProperties = { background: '#7ED321', color: '#0a0a0a', border: 0, padding: '10px 20px', fontWeight: 700, cursor: 'pointer', clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)' }
const btnSecondary: React.CSSProperties = { background: '#1a1a1a', color: '#ccc', border: 0, padding: '10px 20px', cursor: 'pointer' }
