'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { ConsentState } from '@/lib/consent'

const GREEN = '#7ED321'
const CHUNKY = {
  card: 'polygon(0% 4%, 100% 0%, 100% 100%, 0% 100%)',
  button: 'polygon(1% 6%, 99% 0%, 100% 94%, 0% 100%)',
}

interface Props {
  initial: { analytics: boolean; push: boolean }
  onSave: (next: ConsentState) => void
  onCancel: () => void
}

interface ToggleRowProps {
  label: string
  description: string
  checked: boolean
  locked?: boolean
  lockedNote?: string
  onChange?: (next: boolean) => void
}

function ToggleRow({ label, description, checked, locked, lockedNote, onChange }: ToggleRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 0',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 800,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {label}
          {locked && lockedNote && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: '2px 6px',
                background: 'rgba(255,255,255,0.06)',
                color: '#888',
                clipPath: 'polygon(8% 12%, 92% 0%, 100% 88%, 0% 100%)',
                textTransform: 'uppercase',
                letterSpacing: 0.4,
              }}
            >
              {lockedNote}
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: 11,
            color: '#aaa',
            lineHeight: 1.4,
            marginTop: 4,
          }}
        >
          {description}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={locked}
        onClick={() => onChange && onChange(!checked)}
        style={{
          width: 40,
          height: 22,
          background: locked ? 'rgba(126,211,33,0.25)' : checked ? GREEN : 'rgba(255,255,255,0.12)',
          borderRadius: 11,
          border: 'none',
          padding: 0,
          position: 'relative',
          cursor: locked ? 'not-allowed' : 'pointer',
          flexShrink: 0,
          marginTop: 2,
          transition: 'background 0.15s',
          opacity: locked ? 0.6 : 1,
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 20 : 2,
            width: 18,
            height: 18,
            background: '#fff',
            borderRadius: '50%',
            transition: 'left 0.15s',
          }}
        />
      </button>
    </div>
  )
}

export function ConsentCustomizeSheet({ initial, onSave, onCancel }: Props) {
  const t = useTranslations('consent')
  const [analytics, setAnalytics] = useState(initial.analytics)
  const [push, setPush] = useState(initial.push)

  const handleSave = () => {
    onSave({
      analytics,
      push,
      decided_at: new Date().toISOString(),
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10001,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 500,
          background: 'linear-gradient(180deg, #1E1E1E, #161616)',
          borderTop: `2px solid ${GREEN}`,
          padding: '22px 18px 26px',
          clipPath: CHUNKY.card,
          color: '#fff',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 900, marginBottom: 16 }}>
          {t('customizeTitle')}
        </h3>

        <ToggleRow
          label={t('categories.essential.label')}
          description={t('categories.essential.description')}
          checked={true}
          locked
          lockedNote={t('categories.essential.lockedNote')}
        />
        <ToggleRow
          label={t('categories.analytics.label')}
          description={t('categories.analytics.description')}
          checked={analytics}
          onChange={setAnalytics}
        />
        <ToggleRow
          label={t('categories.push.label')}
          description={t('categories.push.description')}
          checked={push}
          onChange={setPush}
        />

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              flex: 1,
              padding: '11px 0',
              fontSize: 12,
              fontWeight: 900,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              background: 'rgba(255,255,255,0.05)',
              color: '#aaa',
              clipPath: CHUNKY.button,
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('customizeCancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              flex: 1,
              padding: '11px 0',
              fontSize: 12,
              fontWeight: 900,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              background: GREEN,
              color: '#000',
              clipPath: CHUNKY.button,
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('customizeSave')}
          </button>
        </div>
      </div>
    </div>
  )
}
