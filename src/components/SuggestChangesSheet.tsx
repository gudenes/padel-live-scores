'use client'

// src/components/SuggestChangesSheet.tsx
//
// Bottom sheet for the player Overview "Suggest changes" flow. Renders one
// editable row per suggestable field prefilled with the current value, plus
// a free-text comment and a hidden honeypot. Submits only the changed fields
// to /api/player/[id]/suggest. Styling mirrors SuggestSourceSheet.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import PressButton, { PRESS_PRESETS } from './PressButton'
import { SUGGESTABLE_FIELDS, type SuggestableField } from '@/lib/player-suggestion-fields'

export interface PlayerForSuggest {
  id: string
  name: string            // canonical players.name (prefill for full_name)
  displayName: string     // shown in the header
  country: string | null
  birthplace: string | null
  birthdate: string | null // ISO date or null
  height: number | null
  hand: string | null      // 'left' | 'right' | null
  side: string | null      // 'drive' | 'backhand' | null
}

interface Props {
  open: boolean
  onClose: () => void
  player: PlayerForSuggest
}

type Stage = 'form' | 'submitting' | 'success' | 'error'

export function SuggestChangesSheet({ open, onClose, player }: Props) {
  const t = useTranslations('player.suggest')

  // Initial (current) values keyed by suggestable field.
  const initial: Record<SuggestableField, string> = {
    full_name: player.name ?? '',
    country: player.country ?? '',
    birthplace: player.birthplace ?? '',
    birthdate: player.birthdate ? player.birthdate.slice(0, 10) : '',
    height: player.height != null ? String(player.height) : '',
    hand: player.hand ?? '',
    side: player.side ?? '',
  }

  const [values, setValues] = useState<Record<SuggestableField, string>>(initial)
  const [comment, setComment] = useState('')
  const [hp, setHp] = useState('')
  const [stage, setStage] = useState<Stage>('form')
  const [errorMsg, setErrorMsg] = useState('')

  if (!open) return null

  const set = (field: SuggestableField, v: string) =>
    setValues(prev => ({ ...prev, [field]: v }))

  const buildChanges = () =>
    (Object.keys(SUGGESTABLE_FIELDS) as SuggestableField[])
      .filter(f => (values[f] ?? '').trim() !== (initial[f] ?? '').trim())
      .map(f => ({ field: f, current: initial[f] ?? '', suggested: (values[f] ?? '').trim() }))

  const changes = buildChanges()
  const canSubmit = changes.length > 0 || comment.trim() !== ''

  const reset = () => {
    setValues(initial); setComment(''); setHp(''); setErrorMsg(''); setStage('form')
    onClose()
  }

  const submit = async () => {
    if (!canSubmit) return
    setStage('submitting'); setErrorMsg('')
    try {
      const r = await fetch(`/api/player/${player.id}/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes, comment: comment.trim() || undefined, hp }),
      })
      if (r.status === 429) { setErrorMsg(t('error_rate_limited')); setStage('error'); return }
      if (!r.ok) { setErrorMsg(t('error_generic')); setStage('error'); return }
      setStage('success')
    } catch {
      setErrorMsg(t('error_generic')); setStage('error')
    }
  }

  const textFields: SuggestableField[] = ['full_name', 'country', 'birthplace']

  return (
    <>
      {/* z-index sits ABOVE the bottom nav (z 200) + any ad banner stacked with
          it, so the sheet — and its submit button — overlay them instead of
          being hidden behind. Bottom padding clears the iOS home indicator. */}
      <div onClick={reset} style={{ position: 'fixed', inset: 0, background: '#0009', zIndex: 290 }} />
      <div role="dialog" aria-modal="true"
        style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: '#0f0f0f', color: '#fff', borderTop: '1px solid #2a2a2a', borderRadius: '16px 16px 0 0', padding: '24px 24px calc(24px + env(safe-area-inset-bottom, 0px))', zIndex: 300, maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ width: 40, height: 4, background: '#444', borderRadius: 2, margin: '0 auto 16px' }} />

        {(stage === 'form' || stage === 'submitting' || stage === 'error') && (
          <>
            <h3 style={{ margin: 0, fontSize: 18 }}>{t('sheetTitle')}</h3>
            <p style={{ color: '#aaa', fontSize: 13, marginTop: 6 }}>{t('sheetSubtitle')}</p>
            <div style={{ fontSize: 12, color: '#7ED321', fontWeight: 700, marginTop: 10 }}>
              {t('playerLabel')}: <span style={{ color: '#fff' }}>{player.displayName}</span>
            </div>

            {textFields.map(field => (
              <label key={field} style={labelStyle}>
                <span style={labelText}>{t(`field_${field}`)}</span>
                <input
                  value={values[field]}
                  onChange={e => set(field, e.target.value)}
                  style={inputStyle}
                  disabled={stage === 'submitting'}
                />
              </label>
            ))}

            <label style={labelStyle}>
              <span style={labelText}>{t('field_birthdate')}</span>
              <input type="date" value={values.birthdate} onChange={e => set('birthdate', e.target.value)}
                style={inputStyle} disabled={stage === 'submitting'} />
            </label>

            <label style={labelStyle}>
              <span style={labelText}>{t('field_height')}</span>
              <input type="number" inputMode="numeric" value={values.height} onChange={e => set('height', e.target.value)}
                style={inputStyle} disabled={stage === 'submitting'} />
            </label>

            <label style={labelStyle}>
              <span style={labelText}>{t('field_hand')}</span>
              <select value={values.hand} onChange={e => set('hand', e.target.value)}
                style={inputStyle} disabled={stage === 'submitting'}>
                <option value="">—</option>
                <option value="left">{t('hand_left')}</option>
                <option value="right">{t('hand_right')}</option>
              </select>
            </label>

            <label style={labelStyle}>
              <span style={labelText}>{t('field_side')}</span>
              <select value={values.side} onChange={e => set('side', e.target.value)}
                style={inputStyle} disabled={stage === 'submitting'}>
                <option value="">—</option>
                <option value="drive">{t('side_drive')}</option>
                <option value="backhand">{t('side_backhand')}</option>
              </select>
            </label>

            <label style={labelStyle}>
              <span style={labelText}>{t('commentLabel')}</span>
              <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={1000} rows={3}
                placeholder={t('commentPlaceholder')} style={{ ...inputStyle, fontFamily: 'inherit' }}
                disabled={stage === 'submitting'} />
            </label>

            {/* Honeypot — visually hidden, off-screen, not announced to AT */}
            <input
              tabIndex={-1} autoComplete="off" aria-hidden="true"
              value={hp} onChange={e => setHp(e.target.value)}
              style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
            />

            {stage === 'error' && <div style={{ marginTop: 12, color: '#E53935', fontSize: 13 }}>{errorMsg}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', marginTop: 16 }}>
              <PressButton
                {...PRESS_PRESETS.chunkyInline}
                accent="#2A2A2A"
                skirt="#0A0A0A"
                textColor="#fff"
                onClick={reset}
                disabled={stage === 'submitting'}
                style={{ fontSize: 12, fontWeight: 700, padding: '9px 18px' }}
              >
                Cancel
              </PressButton>
              <PressButton
                {...PRESS_PRESETS.chunkyInline}
                onClick={submit}
                disabled={stage === 'submitting' || !canSubmit}
                style={{ fontSize: 12, fontWeight: 700, padding: '9px 18px' }}
              >
                {stage === 'submitting' ? t('submitting') : t('submit')}
              </PressButton>
            </div>
          </>
        )}

        {stage === 'success' && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
            <h3 style={{ margin: 0, fontSize: 18 }}>{t('successTitle')}</h3>
            <p style={{ color: '#ccc', fontSize: 14, lineHeight: 1.4, marginTop: 8 }}>{t('successBody')}</p>
            <PressButton
              {...PRESS_PRESETS.chunkyInline}
              onClick={reset}
              style={{ fontSize: 12, fontWeight: 700, padding: '9px 18px', marginTop: 16 }}
            >
              OK
            </PressButton>
          </div>
        )}
      </div>
    </>
  )
}

const labelStyle: React.CSSProperties = { display: 'block', marginTop: 12 }
const labelText: React.CSSProperties = { display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }
const inputStyle: React.CSSProperties = { width: '100%', background: '#1a1a1a', color: '#fff', border: '1px solid #2a2a2a', padding: 10, fontSize: 14, borderRadius: 6, boxSizing: 'border-box' }
