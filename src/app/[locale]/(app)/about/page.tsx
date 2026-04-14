import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'

const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const BG = '#0D0D0D'
const BG_CARD = 'rgba(255,255,255,0.03)'
const BORDER = 'rgba(255,255,255,0.06)'
const MUTED = '#6B7280'
const TEXT = '#CBD5E0'

const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
}

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
      maxWidth: 480, margin: '0 auto', padding: '0 0 100px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: TEXT, background: BG, minHeight: '100vh',
    }}>
      {/* Header bar — matches match detail + player profile pattern */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '14px 16px',
        borderBottom: `0.5px solid ${BORDER}`,
      }}>
        <Link
          href="/home"
          style={{
            width: 36, height: 36, border: 'none', cursor: 'pointer',
            background: 'rgba(255,255,255,0.06)', clipPath: CHUNKY.badge,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', textDecoration: 'none', flexShrink: 0,
          }}
          aria-label="Go back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" /><polyline points="12 19 5 12 12 5" />
          </svg>
        </Link>
        <div style={{
          flex: 1, textAlign: 'center',
          fontSize: 14, fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.5px', color: '#fff',
        }}>
          {t('title')}
        </div>
        <div style={{ width: 36 }} />
      </div>

      {/* Hero with logo */}
      <div style={{
        textAlign: 'center', padding: '32px 20px 28px',
        background: `linear-gradient(180deg, rgba(126,211,33,0.04) 0%, transparent 100%)`,
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/padelnachos-logo.png"
          alt="Padel Nachos"
          style={{ height: 48, objectFit: 'contain', marginBottom: 16 }}
        />
        <p style={{
          fontSize: 14, color: MUTED, margin: 0,
          fontWeight: 500, letterSpacing: '0.3px',
        }}>
          {t('tagline')}
        </p>
      </div>

      {/* Our Story */}
      <section style={{ padding: '24px 20px' }}>
        <div style={{
          fontSize: 9, fontWeight: 700, color: ORANGE,
          textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 10,
        }}>
          {t('storyTitle')}
        </div>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: TEXT, margin: '0 0 10px' }}>
          {t('storyP1')}
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: TEXT, margin: 0 }}>
          {t('storyP2')}
        </p>
      </section>

      {/* What We Offer — chunky card */}
      <section style={{ padding: '0 20px 24px' }}>
        <div style={{
          background: BG_CARD, clipPath: CHUNKY.card,
          padding: '16px 18px',
        }}>
          <div style={{
            fontSize: 9, fontWeight: 700, color: GREEN,
            textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 14,
          }}>
            {t('offerTitle')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {offers.map((text, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                fontSize: 13, color: TEXT,
              }}>
                <span style={{
                  color: GREEN, fontWeight: 900, fontSize: 14, lineHeight: 1.5, flexShrink: 0,
                }}>✓</span>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Data & Accuracy */}
      <section style={{ padding: '0 20px 24px' }}>
        <div style={{
          fontSize: 9, fontWeight: 700, color: ORANGE,
          textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 10,
        }}>
          {t('dataTitle')}
        </div>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: TEXT, margin: '0 0 10px' }}>
          {t('dataP1')}
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.7, color: TEXT, margin: 0 }}>
          {t('dataP2')}
        </p>
      </section>

      {/* Stat highlights — chunky cards */}
      <section style={{ padding: '0 20px 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div style={{
            background: BG_CARD, clipPath: CHUNKY.card,
            padding: '14px 16px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 24, fontWeight: 900, color: GREEN }}>3,000+</div>
            <div style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: '1px', marginTop: 2, fontWeight: 600 }}>Players</div>
          </div>
          <div style={{
            background: BG_CARD, clipPath: CHUNKY.card,
            padding: '14px 16px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 24, fontWeight: 900, color: ORANGE }}>5</div>
            <div style={{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: '1px', marginTop: 2, fontWeight: 600 }}>Languages</div>
          </div>
        </div>
      </section>

      {/* Contact */}
      <div style={{
        textAlign: 'center', padding: '20px',
        borderTop: `0.5px solid ${BORDER}`,
      }}>
        <p style={{ color: MUTED, fontSize: 12, margin: 0 }}>
          {t('contact')}{' '}
          <a href="mailto:hello@padelnachos.com" style={{ color: GREEN, textDecoration: 'none', fontWeight: 600 }}>
            hello@padelnachos.com
          </a>
        </p>
      </div>
    </div>
  )
}
