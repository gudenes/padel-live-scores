'use client'
import { useTranslations } from 'next-intl'

const ORANGE = '#F5A623'
const BG_BASE = '#1A1A1A'
const CHUNKY = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

export default function OfflinePage() {
  const t = useTranslations('offline')
  return (
    <div style={{
      minHeight: '100dvh',
      background: BG_BASE,
      color: '#fff',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
      padding: 24,
      textAlign: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{
        width: 80, height: 80,
        background: ORANGE,
        clipPath: CHUNKY,
      }} />
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>
        {t('title')}
      </h1>
      <p style={{ color: '#6B7280', margin: 0, maxWidth: 320, lineHeight: 1.5 }}>
        {t('subtitle')}
      </p>
      <button
        type="button"
        aria-label={t('retry')}
        onClick={() => window.location.reload()}
        style={{
          marginTop: 8,
          padding: '12px 24px',
          background: ORANGE,
          color: '#000',
          border: 'none',
          clipPath: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
          fontWeight: 700,
          fontSize: 14,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {t('retry')}
      </button>
    </div>
  )
}
