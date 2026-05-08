// src/components/road-to-olympics/HubHero.tsx
//
// Static eyebrow + title + subtitle. Visual reference:
// .superpowers/brainstorm/97613-1778261304/content/hub-layout-v3-1.html

import { useTranslations } from 'next-intl'

export default function HubHero() {
  const t = useTranslations('roadToOlympics')
  return (
    <section style={{ marginBottom: 18 }}>
      <span style={{
        display: 'inline-block',
        background: 'rgba(126,211,33,0.12)',
        color: '#7ed321',
        fontWeight: 700,
        fontSize: 11,
        padding: '4px 10px',
        borderRadius: 999,
        letterSpacing: 0.6,
        marginBottom: 14,
      }}>
        {t('hashtag')}
      </span>
      <h1 style={{
        fontSize: 28,
        lineHeight: 1.1,
        fontWeight: 800,
        margin: '0 0 10px',
        letterSpacing: -0.5,
        color: '#fff',
      }}>
        {t('heroTitleLine1')}
      </h1>
      <p style={{
        fontSize: 14,
        color: '#b8b8b8',
        lineHeight: 1.5,
        margin: 0,
      }}>
        {t('heroSubtitle')}
      </p>
    </section>
  )
}
