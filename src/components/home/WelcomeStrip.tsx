'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/components/AuthProvider'
import { useFollowing } from '@/hooks/useFollowing'

const CHUNKY = 'polygon(0% 2%, 100% 0%, 100% 98%, 0% 100%)'
const FADE_AFTER_MS = 24 * 60 * 60 * 1000 // 24h

export function WelcomeStrip() {
  const t = useTranslations('welcomeStrip')
  const { user } = useAuth()
  const { counts, loaded } = useFollowing()
  const [hidden, setHidden] = useState(true)

  // Render gate evaluated client-side after mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (user) { setHidden(true); return } // hide for authenticated users
    if (!loaded) return

    let visible = true
    try {
      const dismissed = localStorage.getItem('pn_welcome_strip_dismissed') === '1'
      const firstSession = Number(localStorage.getItem('pn_picker_first_session') ?? '0')
      const expired = firstSession > 0 && Date.now() - firstSession > FADE_AFTER_MS
      visible = !dismissed && !expired && counts.player > 0
    } catch {
      visible = false
    }
    setHidden(!visible)
  }, [user, loaded, counts.player])

  const handleDismiss = () => {
    try { localStorage.setItem('pn_welcome_strip_dismissed', '1') } catch {}
    setHidden(true)
  }

  if (hidden) return null

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(126,211,33,0.18), rgba(126,211,33,0.04))',
      border: '1px solid rgba(126,211,33,0.3)',
      padding: '10px 12px',
      margin: '12px 12px 0',
      clipPath: CHUNKY,
      display: 'flex', alignItems: 'center', gap: 10,
      color: '#fff',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 900 }}>{t('title')}</div>
        <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>
          {t('followingCount', { count: counts.player })} · {t('syncHint')}
        </div>
      </div>
      <button
        type="button"
        aria-label={t('dismiss')}
        onClick={handleDismiss}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#888', fontSize: 16, padding: '4px 6px',
          fontFamily: 'inherit',
        }}
      >
        ×
      </button>
    </div>
  )
}
