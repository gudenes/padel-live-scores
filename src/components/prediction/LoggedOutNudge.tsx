'use client'

import { useTranslations } from 'next-intl'
import { useSession } from 'next-auth/react'

const GREEN = '#7ED321'
const CHUNKY = 'polygon(2% 8%, 98% 0%, 100% 92%, 0% 100%)'

function dispatchLoginOpen() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('pn:login-open'))
  }
}

export function LoggedOutNudge() {
  const { status } = useSession()
  const t = useTranslations('prediction.loggedOutNudge')
  if (status !== 'unauthenticated') return null
  return (
    <div
      style={{
        background: 'rgba(126, 211, 33, 0.10)',
        border: '1px solid rgba(126, 211, 33, 0.35)',
        clipPath: CHUNKY,
        padding: '8px 10px',
        marginBottom: 10,
        fontSize: 11,
        color: 'rgba(255,255,255,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      <span>{t('body')}</span>
      <button
        type="button"
        onClick={dispatchLoginOpen}
        style={{
          background: GREEN,
          color: '#0a0a0a',
          border: 0,
          fontSize: 11,
          fontWeight: 800,
          padding: '5px 10px',
          cursor: 'pointer',
          clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
          flexShrink: 0,
        }}
      >
        {t('cta')}
      </button>
    </div>
  )
}
