// src/app/[locale]/(app)/road-to-olympics/why/page.tsx
//
// Manifesto / honest-disclosure long-read. English-only at Soft Launch.

import { getTranslations } from 'next-intl/server'
import GlobalHeader from '@/components/nav/GlobalHeader'
import { Link } from '@/i18n/navigation'
import { GREEN, BG_BASE, MUTED } from '@/components/home/shared'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getTranslations('roadToOlympics.why')
  const tHub = await getTranslations('roadToOlympics')
  const pageTitle = `${t('title')} — PadelNachos`
  const description = t('intro')
  const heroAlt = tHub('heroImageAlt')
  const ogImageUrl = 'https://padelnachos.com/road-to-olympics/og/hero.png'
  return {
    title: pageTitle,
    description,
    openGraph: {
      title: pageTitle,
      description,
      url: 'https://padelnachos.com/road-to-olympics/why',
      images: [{
        url: ogImageUrl,
        width: 1200,
        height: 630,
        alt: heroAlt,
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title: pageTitle,
      description,
      images: [ogImageUrl],
    },
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
        background: BG_BASE,
      }}>
        <Link href="/road-to-olympics" style={{ fontSize: 12, color: GREEN, textDecoration: 'none' }}>
          ← Road to the Olympics
        </Link>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: '12px 0 16px', lineHeight: 1.2 }}>
          {t('title')}
        </h1>
        <p style={{ fontSize: 15, color: '#ddd', lineHeight: 1.6, margin: '0 0 24px' }}>
          {t('intro')}
        </p>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: GREEN, margin: '28px 0 8px', textTransform: 'uppercase', letterSpacing: 1 }}>
          {t('stance')}
        </h2>
        <p style={{ fontSize: 14, color: '#ccc', lineHeight: 1.6, margin: 0 }}>
          {t('stanceBody')}
        </p>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: GREEN, margin: '28px 0 8px', textTransform: 'uppercase', letterSpacing: 1 }}>
          {t('rules')}
        </h2>
        <p style={{ fontSize: 14, color: '#ccc', lineHeight: 1.6, margin: 0 }}>
          {t('rulesBody')}
        </p>
      </main>
    </>
  )
}
