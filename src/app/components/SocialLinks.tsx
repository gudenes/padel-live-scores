'use client'
// src/app/components/SocialLinks.tsx
// Shared "Follow us" row — three brand-icon links to PadelNachos' socials.
// Used by the About page and Settings → Support. URLs live here as the
// single source of truth.

import { useTranslations } from 'next-intl'
import { InstagramIcon, XIcon, TikTokIcon } from '@/components/icons'

const LINKS = [
  { key: 'instagram', label: 'Instagram', href: 'https://instagram.com/padelnachos', Icon: InstagramIcon },
  { key: 'x', label: 'X', href: 'https://x.com/padelnachos', Icon: XIcon },
  { key: 'tiktok', label: 'TikTok', href: 'https://tiktok.com/@padelnachos', Icon: TikTokIcon },
] as const

const MUTED = '#6B7280'
const HOVER = '#7ED321'

export default function SocialLinks({ style }: { style?: React.CSSProperties }) {
  const t = useTranslations('social')
  return (
    <div style={{ textAlign: 'center', ...style }}>
      <div style={{
        color: MUTED, fontSize: 11, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12,
      }}>
        {t('followUs')}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
        {LINKS.map(({ key, label, href, Icon }) => (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`PadelNachos on ${label}`}
            style={{
              width: 44, height: 44, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              color: MUTED, textDecoration: 'none',
              transition: 'color 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = HOVER }}
            onMouseLeave={(e) => { e.currentTarget.style.color = MUTED }}
          >
            <Icon size={22} color="currentColor" />
          </a>
        ))}
      </div>
    </div>
  )
}
