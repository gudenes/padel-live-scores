'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/components/AuthProvider'
import { useFollowing } from '@/hooks/useFollowing'
import { useLoginSheet } from '@/components/LoginSheetProvider'

const GREEN = '#7ED321'
const CHUNKY_CARD = 'polygon(0% 4%, 100% 0%, 100% 100%, 0% 100%)'
const CHUNKY_BTN = 'polygon(1% 6%, 99% 0%, 100% 94%, 0% 100%)'
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

export function LoginCtaSheet() {
  const t = useTranslations('loginCta')
  const { user } = useAuth()
  const { counts, loaded } = useFollowing()
  const { openLoginSheet } = useLoginSheet()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (user) return // never for authenticated
    if (!loaded) return

    let alreadyShown = false
    let firstSession = 0
    try {
      alreadyShown = localStorage.getItem('pn_login_cta_shown') === '1'
      firstSession = Number(localStorage.getItem('pn_picker_first_session') ?? '0')
    } catch {}

    if (alreadyShown) return

    const totalFollows =
      counts.match + counts.player + counts.tournament + counts.news_source

    const has24hPlusFollow =
      firstSession > 0 &&
      Date.now() - firstSession > TWENTY_FOUR_HOURS_MS &&
      totalFollows >= 1

    const has3PlusFollows = totalFollows >= 3

    if (has3PlusFollows || has24hPlusFollow) {
      // Tiny delay so it doesn't slam in on initial load
      const id = setTimeout(() => setVisible(true), 1500)
      return () => clearTimeout(id)
    }
  }, [user, loaded, counts.match, counts.player, counts.tournament, counts.news_source])

  const dismiss = () => {
    try { localStorage.setItem('pn_login_cta_shown', '1') } catch {}
    setVisible(false)
  }

  const handleSignIn = () => {
    dismiss()
    openLoginSheet()
  }

  if (!visible) return null

  const totalFollows = counts.match + counts.player + counts.tournament + counts.news_source

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
      onClick={dismiss}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 500,
          background: 'linear-gradient(180deg, #1E1E1E, #161616)',
          borderTop: `2px solid ${GREEN}`,
          padding: '22px 18px 26px',
          clipPath: CHUNKY_CARD,
          color: '#fff',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 900, textAlign: 'center', marginBottom: 6 }}>
          {t('title')}
        </h3>
        <p style={{ fontSize: 12, color: '#aaa', textAlign: 'center', lineHeight: 1.5, marginBottom: 16 }}>
          {t('bodyWithCount', { count: totalFollows })}
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={dismiss}
            style={{
              flex: 1, padding: '11px 0',
              fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5,
              background: 'rgba(255,255,255,0.05)', color: '#aaa',
              clipPath: CHUNKY_BTN, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('later')}
          </button>
          <button
            onClick={handleSignIn}
            style={{
              flex: 1, padding: '11px 0',
              fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5,
              background: GREEN, color: '#000',
              clipPath: CHUNKY_BTN, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('signIn')}
          </button>
        </div>
      </div>
    </div>
  )
}
