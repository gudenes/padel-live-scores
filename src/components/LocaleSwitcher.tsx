'use client'

import { useLocale } from 'next-intl'
import { useRouter, usePathname } from '@/i18n/navigation'
import { routing } from '@/i18n/routing'

const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'
const GREEN = '#7ED321'
const MUTED = '#6B7280'

export default function LocaleSwitcher() {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()

  const handleSwitch = () => {
    const nextLocale = locale === 'en' ? 'es' : 'en'
    router.replace(pathname, { locale: nextLocale })
  }

  return (
    <button
      onClick={handleSwitch}
      aria-label={`Switch to ${locale === 'en' ? 'Spanish' : 'English'}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.10)',
        clipPath: CHUNKY_BADGE,
        padding: 3,
        cursor: 'pointer',
        flexShrink: 0,
        position: 'relative',
        fontFamily: 'inherit',
      }}
    >
      {/* Sliding indicator */}
      <div style={{
        position: 'absolute',
        top: 3,
        left: locale === 'en' ? 3 : 27,
        width: 22,
        height: 22,
        background: GREEN,
        clipPath: CHUNKY_BADGE,
        transition: 'left 0.2s ease',
      }} />
      {routing.locales.map(loc => (
        <span
          key={loc}
          style={{
            width: 24,
            textAlign: 'center',
            fontSize: 9,
            fontWeight: 700,
            position: 'relative',
            zIndex: 1,
            color: locale === loc ? '#000' : MUTED,
            transition: 'color 0.2s',
            lineHeight: '22px',
            textTransform: 'uppercase',
          }}
        >
          {loc}
        </span>
      ))}
    </button>
  )
}
