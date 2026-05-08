// src/components/road-to-olympics/HomeCard.tsx
//
// Persistent card on home/page.tsx pointing fans at the hub. Visible while
// the countdown is < 365 days. Renders nothing once the IOC milestone has
// passed (hub stays accessible, just no longer hero-promoted).

'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import stateJson from '@/data/road-to-olympics/state.json'
import { GREEN, CHUNKY } from '@/components/home/shared'
import Term from './Term'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export default function RoadToOlympicsHomeCard() {
  const t = useTranslations('roadToOlympics.homeCard')
  const tg = useTranslations('roadToOlympics.glossary')
  const target = new Date(stateJson.iocSessionAt).getTime()
  const days = Math.max(0, Math.floor((target - Date.now()) / MS_PER_DAY))
  if (days > 365) return null

  return (
    <Link
      href="/road-to-olympics"
      style={{
        display: 'block',
        background: 'linear-gradient(135deg, rgba(126,211,33,0.16), rgba(126,211,33,0.04))',
        border: '1px solid rgba(126,211,33,0.4)',
        clipPath: CHUNKY.card,
        padding: 18,
        margin: '14px 0',
        color: '#fff',
        textDecoration: 'none',
      }}
    >
      <div style={{
        fontSize: 10, letterSpacing: 1.4, color: GREEN,
        fontWeight: 700, marginBottom: 6,
      }}>
        {t('eyebrow')}
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2, marginBottom: 6 }}>
        {t('title')}
      </div>
      <div style={{ fontSize: 13, color: '#b8b8b8', lineHeight: 1.4, marginBottom: 12 }}>
        {t.rich('subtitle', {
          days,
          ioc: (chunks) => <Term short={String(chunks)} definition={tg('ioc')} />,
        })}
      </div>
      <span style={{
        background: GREEN, color: '#0a0a0a', fontWeight: 800,
        fontSize: 11, padding: '6px 14px', clipPath: CHUNKY.button,
        letterSpacing: 0.5, display: 'inline-block',
      }}>
        {t('cta')}
      </span>
    </Link>
  )
}
