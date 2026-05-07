'use client'
// src/components/desktop/Topbar.tsx
// 96px sticky header for the desktop layout. Real PadelNachos wordmark,
// primary nav (Home / Matches / Ranking / Tournaments / Feed), search
// box that navigates to /search, and a Sign-in button that opens the
// existing LoginSheet via openLoginSheet() from LoginSheetProvider.
//
// Used by <DesktopShell/>. Not rendered on mobile.

import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Link, usePathname, useRouter } from '@/i18n/navigation'
import { useLoginSheet } from '@/components/LoginSheetProvider'
import { useAuth } from '@/components/AuthProvider'

const NAV_ITEMS = [
  { href: '/home', key: 'home' as const },
  { href: '/matches', key: 'matches' as const },
  { href: '/rankings', key: 'ranking' as const },
  { href: '/tournaments', key: 'tournaments' as const },
  { href: '/feed', key: 'feed' as const },
]

export default function Topbar() {
  const t = useTranslations('desktop')
  const pathname = usePathname()
  const router = useRouter()
  const { openLoginSheet } = useLoginSheet()
  const { user } = useAuth()

  return (
    <header
      role="banner"
      style={{
        height: 96,
        display: 'flex',
        alignItems: 'center',
        padding: '0 40px',
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(22px)',
        WebkitBackdropFilter: 'blur(22px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      <div
        style={{
          maxWidth: 1440,
          width: '100%',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 36,
        }}
      >
        <Link href="/home" style={{ display: 'flex', alignItems: 'center' }}>
          <Image
            src="/padelnachos-logo-v2.png"
            alt="PadelNachos"
            width={224}
            height={56}
            priority
            style={{ height: 56, width: 'auto', display: 'block' }}
          />
        </Link>

        <nav aria-label="Primary" style={{ flex: 1, display: 'flex', gap: 6, marginLeft: 16 }}>
          {NAV_ITEMS.map(item => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: '10px 18px',
                  color: isActive ? 'var(--green)' : 'var(--text-dim)',
                  fontSize: 13,
                  fontWeight: 800,
                  letterSpacing: 0.6,
                  textTransform: 'uppercase',
                  textDecoration: 'none',
                  borderRadius: 4,
                  position: 'relative',
                }}
              >
                {t(`nav.${item.key}`)}
                {isActive && (
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      left: 18,
                      right: 18,
                      bottom: -2,
                      height: 2,
                      background: 'var(--green)',
                      borderRadius: 2,
                    }}
                  />
                )}
              </Link>
            )
          })}
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            type="button"
            onClick={() => router.push('/search')}
            aria-label={t('search.placeholder')}
            style={{
              width: 280,
              height: 40,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 22,
              padding: '0 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              color: 'var(--text-dim)',
              fontSize: 13,
              fontFamily: 'inherit',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <span aria-hidden>🔍</span>
            <span>{t('search.placeholder')}</span>
          </button>

          {!user && (
            <button
              type="button"
              onClick={openLoginSheet}
              style={{
                padding: '10px 22px',
                background: 'var(--green)',
                color: '#0A0A0A',
                fontSize: 12,
                fontWeight: 900,
                letterSpacing: 0.7,
                textTransform: 'uppercase',
                borderRadius: 4,
                border: 'none',
                cursor: 'pointer',
                clipPath: 'polygon(6% 6%, 94% 0%, 100% 94%, 0% 100%)',
              }}
            >
              {t('signIn')}
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
