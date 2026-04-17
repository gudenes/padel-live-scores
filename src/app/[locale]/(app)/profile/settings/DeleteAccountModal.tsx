'use client'
// src/app/[locale]/(app)/profile/settings/DeleteAccountModal.tsx
// Two-step confirmation modal. Step 1 is the warning; step 2 reveals a
// text input that must match the localized confirm word (default "DELETE")
// before the final destructive button is enabled.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { signOut } from 'next-auth/react'
import { useRouter } from '@/i18n/navigation'

const V3 = {
  LIVE_RED: '#FF4655',
  BG_CARD: '#141414',
  MUTED: '#6B7280',
  BORDER: 'rgba(255,255,255,0.06)',
} as const

interface Props {
  open: boolean
  onClose: () => void
}

export function DeleteAccountModal({ open, onClose }: Props) {
  const t = useTranslations('settings.deleteModal')
  const confirmWord = t('confirmWord')
  const [step, setStep] = useState<1 | 2>(1)
  const [typed, setTyped] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const router = useRouter()

  if (!open) return null

  const canDelete = step === 2 && typed.trim() === confirmWord && !deleting

  async function doDelete() {
    setDeleting(true)
    setErr(null)
    try {
      const res = await fetch('/api/user/account', { method: 'DELETE' })
      if (res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? t('errorGeneric'))
      }
      await signOut({ redirect: false })
      router.push('/home?deleted=1')
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('errorGeneric'))
      setDeleting(false)
    }
  }

  function reset() {
    setStep(1)
    setTyped('')
    setErr(null)
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={reset}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 420,
          background: V3.BG_CARD,
          borderRadius: 12, padding: 24,
          border: `1px solid ${V3.BORDER}`,
        }}
      >
        <div style={{
          color: V3.LIVE_RED, fontSize: 16, fontWeight: 700,
          marginBottom: 10,
        }}>
          {t('title')}
        </div>
        <div style={{ color: '#D1D5DB', fontSize: 13, lineHeight: 1.5, marginBottom: 18 }}>
          {t('body')}
        </div>
        {step === 2 && (
          <>
            <div style={{ color: V3.MUTED, fontSize: 12, marginBottom: 6 }}>
              {t('confirmPrompt')}
            </div>
            <input
              type="text"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              autoFocus
              autoCapitalize="characters"
              style={{
                width: '100%', padding: '10px 12px',
                background: '#0A0A0A', color: '#fff',
                border: `1px solid ${V3.BORDER}`, borderRadius: 8,
                fontSize: 14, outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          </>
        )}
        {err && (
          <div style={{ color: V3.LIVE_RED, fontSize: 12, marginTop: 10 }}>
            {err}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button
            onClick={reset}
            disabled={deleting}
            style={{
              flex: 1, padding: 12, borderRadius: 8,
              background: 'transparent', color: V3.MUTED,
              border: `1px solid ${V3.BORDER}`, cursor: 'pointer',
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
            }}
          >
            {t('cancel')}
          </button>
          {step === 1 ? (
            <button
              onClick={() => setStep(2)}
              style={{
                flex: 1, padding: 12, borderRadius: 8,
                background: V3.LIVE_RED, color: '#fff',
                border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
              }}
            >
              {t('continue')}
            </button>
          ) : (
            <button
              onClick={doDelete}
              disabled={!canDelete}
              style={{
                flex: 1, padding: 12, borderRadius: 8,
                background: canDelete ? V3.LIVE_RED : '#4B1A1E',
                color: canDelete ? '#fff' : V3.MUTED,
                border: 'none',
                cursor: canDelete ? 'pointer' : 'not-allowed',
                fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
              }}
            >
              {t('confirmButton')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
