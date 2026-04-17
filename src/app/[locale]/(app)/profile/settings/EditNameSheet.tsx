'use client'
// src/app/[locale]/(app)/profile/settings/EditNameSheet.tsx
// Bottom sheet for editing profiles.display_name. Calls PATCH /api/user/profile.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

const V3 = {
  GREEN: '#7ED321',
  ORANGE: '#F5A623',
  LIVE_RED: '#FF4655',
  BG_CARD: '#141414',
  MUTED: '#6B7280',
  BORDER: 'rgba(255,255,255,0.06)',
} as const

const MAX_LEN = 40

interface Props {
  open: boolean
  initialName: string
  onClose: () => void
  onSaved: (newName: string) => void
}

export function EditNameSheet({ open, initialName, onClose, onSaved }: Props) {
  const t = useTranslations('settings.account.editName')
  const [value, setValue] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setValue(initialName)
      setErr(null)
    }
  }, [open, initialName])

  if (!open) return null

  const trimmed = value.trim()
  const dirty = trimmed !== initialName.trim()
  const canSave = dirty && trimmed.length > 0 && !saving

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ display_name: trimmed }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? 'save failed')
      }
      onSaved(trimmed)
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 500,
          background: V3.BG_CARD,
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          padding: 20,
          borderTop: `1px solid ${V3.BORDER}`,
        }}
      >
        <div style={{ color: '#fff', fontSize: 15, fontWeight: 600, marginBottom: 14 }}>
          {t('title')}
        </div>
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value.slice(0, MAX_LEN))}
          placeholder={t('placeholder')}
          autoFocus
          style={{
            width: '100%', padding: '12px 14px',
            background: '#0A0A0A', color: '#fff',
            border: `1px solid ${V3.BORDER}`, borderRadius: 8,
            fontSize: 14, outline: 'none',
            fontFamily: 'inherit',
          }}
        />
        {err && (
          <div style={{ color: V3.LIVE_RED, fontSize: 12, marginTop: 8 }}>
            {err}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              flex: 1, padding: 12, borderRadius: 8,
              background: 'transparent', color: V3.MUTED,
              border: `1px solid ${V3.BORDER}`, cursor: 'pointer',
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
            }}
          >
            {t('cancel')}
          </button>
          <button
            onClick={save}
            disabled={!canSave}
            style={{
              flex: 1, padding: 12, borderRadius: 8,
              background: canSave ? V3.GREEN : '#333',
              color: canSave ? '#000' : V3.MUTED,
              border: 'none', cursor: canSave ? 'pointer' : 'not-allowed',
              fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
            }}
          >
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  )
}
