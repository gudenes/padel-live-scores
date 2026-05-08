// src/app/[locale]/(app)/road-to-olympics/why/page.tsx
//
// Manifesto / honest-disclosure long-read. English-only at Soft Launch.

import { getTranslations } from 'next-intl/server'
import GlobalHeader from '@/components/nav/GlobalHeader'
import { Link } from '@/i18n/navigation'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getTranslations('roadToOlympics.why')
  return {
    title: `${t('title')} — PadelNachos`,
    description: t('intro'),
  }
}

export default async function WhyPage() {
  const t = await getTranslations('roadToOlympics.why')
  return (
    <>
      <GlobalHeader />
      <main style={{
        maxWidth: 600,
        margin: '0 auto',
        padding: '20px 16px 40px',
        color: '#fff',
        minHeight: '100vh',
        background: '#0a0a0a',
      }}>
        <Link href="/road-to-olympics" style={{ fontSize: 12, color: '#7ed321', textDecoration: 'none' }}>
          ← Road to the Olympics
        </Link>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: '12px 0 16px', lineHeight: 1.2 }}>
          {t('title')}
        </h1>
        <p style={{ fontSize: 15, color: '#ddd', lineHeight: 1.6, margin: '0 0 24px' }}>
          {t('intro')}
        </p>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#7ed321', margin: '28px 0 8px', textTransform: 'uppercase', letterSpacing: 1 }}>
          {t('stance')}
        </h2>
        <p style={{ fontSize: 14, color: '#ccc', lineHeight: 1.6, margin: 0 }}>
          {t('stanceBody')}
        </p>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#7ed321', margin: '28px 0 8px', textTransform: 'uppercase', letterSpacing: 1 }}>
          {t('rules')}
        </h2>
        <p style={{ fontSize: 14, color: '#ccc', lineHeight: 1.6, margin: 0 }}>
          {t('rulesBody')}
        </p>
      </main>
    </>
  )
}
