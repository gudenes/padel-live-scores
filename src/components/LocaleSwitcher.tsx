'use client'
// src/components/LocaleSwitcher.tsx
//
// Language switcher — circular flag button that toggles between locales.
// Shows the current locale's flag. Tap to switch to the other locale.

import { useLocale } from 'next-intl'
import { useRouter, usePathname } from '@/i18n/navigation'

const LOCALE_FLAGS: Record<string, { code: string; label: string }> = {
  en: { code: 'gb', label: 'English' },
  es: { code: 'es', label: 'Español' },
}

interface LocaleSwitcherProps {
  /** Size in px (default 28) */
  size?: number
}

export default function LocaleSwitcher({ size = 28 }: LocaleSwitcherProps) {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()

  const handleSwitch = () => {
    const nextLocale = locale === 'en' ? 'es' : 'en'
    router.replace(pathname, { locale: nextLocale })
  }

  const current = LOCALE_FLAGS[locale] ?? LOCALE_FLAGS.en
  const next = locale === 'en' ? LOCALE_FLAGS.es : LOCALE_FLAGS.en

  return (
    <button
      onClick={handleSwitch}
      aria-label={`Switch to ${next.label}`}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '2px solid rgba(255,255,255,0.12)',
        cursor: 'pointer',
        flexShrink: 0,
        overflow: 'hidden',
        padding: 0,
        background: '#222',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'border-color 0.2s',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://flagcdn.com/w80/${current.code}.png`}
        alt={current.label}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </button>
  )
}
