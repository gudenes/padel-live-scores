// src/components/road-to-olympics/HubHero.tsx
//
// Static eyebrow + title + subtitle. Visual reference:
// .superpowers/brainstorm/97613-1778261304/content/hub-layout-v3-1.html

import { useTranslations } from 'next-intl'
import { GREEN, CHUNKY } from '@/components/home/shared-constants'
import Term from './Term'

export default function HubHero() {
  const t = useTranslations('roadToOlympics')
  const tg = useTranslations('roadToOlympics.glossary')
  return (
    <section style={{ marginBottom: 18 }}>
      <span style={{
        display: 'inline-block',
        background: 'rgba(126,211,33,0.12)',
        color: GREEN,
        fontWeight: 700,
        fontSize: 11,
        padding: '4px 10px',
        clipPath: CHUNKY.badge,
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
        {t.rich('heroSubtitle', {
          ioc: (chunks) => <Term short={String(chunks)} definition={tg('ioc')} />,
          brisbane: (chunks) => <Term short={String(chunks)} definition={tg('brisbane2032')} />,
        })}
      </p>
    </section>
  )
}
