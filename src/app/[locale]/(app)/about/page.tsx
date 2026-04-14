import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'

const GREEN = '#7ED321'
const ORANGE = '#F5A623'

export default async function AboutPage() {
  const t = await getTranslations('about')

  const offers = [
    t('offerScores'),
    t('offerRankings'),
    t('offerDraws'),
    t('offerHighlights'),
    t('offerNews'),
    t('offerGenius'),
  ]

  return (
    <div style={{
      maxWidth: 700, margin: '0 auto', padding: '0 20px 80px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#E2E8F0', background: '#1A1A1A', minHeight: '100vh',
      lineHeight: 1.7, fontSize: 15,
    }}>
      {/* Back button */}
      <div style={{ padding: '16px 0 8px' }}>
        <Link href="/home" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          color: '#A0AEC0', textDecoration: 'none', fontSize: 13, fontWeight: 600,
        }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {t('back')}
        </Link>
      </div>

      {/* Hero */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/padel-nachos-logo.png"
          alt="Padel Nachos"
          style={{ height: 64, objectFit: 'contain', marginBottom: 12 }}
        />
        <h1 style={{ fontSize: 32, fontWeight: 900, color: '#fff', margin: '0 0 8px' }}>
          <span style={{ color: GREEN }}>Padel</span>{' '}
          <span style={{ color: ORANGE }}>Nachos</span>
        </h1>
        <p style={{ fontSize: 17, color: '#A0AEC0', margin: 0 }}>
          {t('tagline')}
        </p>
      </div>

      {/* Our Story */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 16 }}>
          {t('storyTitle')}
        </h2>
        <p style={{ color: '#CBD5E0', marginBottom: 12 }}>{t('storyP1')}</p>
        <p style={{ color: '#CBD5E0', margin: 0 }}>{t('storyP2')}</p>
      </section>

      {/* What We Offer */}
      <section style={{
        marginBottom: 40,
        background: '#141414',
        borderRadius: 16,
        padding: '24px 28px',
        border: '1px solid rgba(126,211,33,0.12)',
      }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 20 }}>
          {t('offerTitle')}
        </h2>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {offers.map((item, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{
                color: GREEN, fontWeight: 800, fontSize: 16, lineHeight: 1.6, flexShrink: 0,
              }}>✓</span>
              <span style={{ color: '#CBD5E0' }}>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Data & Accuracy */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 16 }}>
          {t('dataTitle')}
        </h2>
        <p style={{ color: '#CBD5E0', marginBottom: 12 }}>{t('dataP1')}</p>
        <p style={{ color: '#CBD5E0', margin: 0 }}>{t('dataP2')}</p>
      </section>

      {/* Footer note */}
      <p style={{ color: '#4B5563', fontSize: 13, textAlign: 'center', marginTop: 48 }}>
        {t('contact')}{' '}
        <a href="mailto:hello@padelnachos.com" style={{ color: GREEN, textDecoration: 'none' }}>
          hello@padelnachos.com
        </a>
      </p>
    </div>
  )
}
