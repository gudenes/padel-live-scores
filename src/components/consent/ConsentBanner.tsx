'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useConsent } from '@/hooks/useConsent'
import { initAnalyticsIfAllowed } from '@/lib/analytics-init'
import { ConsentCustomizeSheet } from './ConsentCustomizeSheet'
import type { ConsentState } from '@/lib/consent'

const GREEN = '#7ED321'
const CHUNKY = {
  card: 'polygon(0% 2%, 100% 0%, 100% 98%, 0% 100%)',
  button: 'polygon(1% 6%, 99% 0%, 100% 94%, 0% 100%)',
}

export function ConsentBanner() {
  const t = useTranslations('consent')
  const { consent, hasDecided, setConsent } = useConsent()
  const [customizing, setCustomizing] = useState(false)

  if (hasDecided) return null

  const apply = (next: ConsentState) => {
    setConsent(next)
    setCustomizing(false)
    // Init the SDKs immediately if user just opted in — saves them
    // from a page reload to start sending events.
    if (next.analytics) {
      initAnalyticsIfAllowed()
    }
  }

  const handleAcceptAll = () => {
    apply({ analytics: true, push: true, decided_at: new Date().toISOString() })
  }

  const handleRejectAll = () => {
    apply({ analytics: false, push: false, decided_at: new Date().toISOString() })
  }

  const customizeInitial = consent
    ? { analytics: consent.analytics, push: consent.push }
    : { analytics: false, push: false }

  return (
    <>
      <div
        role="region"
        aria-label={t('title')}
        style={{
          position: 'sticky',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 10000,
          background: 'linear-gradient(180deg, rgba(26,26,26,0.95), #1A1A1A)',
          borderTop: `2px solid ${GREEN}`,
          padding: '18px 16px 20px',
          clipPath: CHUNKY.card,
          color: '#fff',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          maxWidth: 500,
          margin: '0 auto',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.5)',
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 900, marginBottom: 6 }}>{t('title')}</h3>
        <p style={{ fontSize: 12, color: '#aaa', lineHeight: 1.4, marginBottom: 8 }}>
          {t('body')}
        </p>
        <Link
          href="/privacy"
          style={{
            fontSize: 11, color: GREEN, fontWeight: 700,
            textDecoration: 'underline',
            display: 'inline-block', marginBottom: 14,
          }}
        >
          {t('privacyLink')}
        </Link>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            onClick={handleRejectAll}
            style={{
              flex: 1,
              padding: '10px 0',
              fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4,
              background: 'rgba(255,255,255,0.05)', color: '#aaa',
              clipPath: CHUNKY.button, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('rejectAll')}
          </button>
          <button
            type="button"
            onClick={() => setCustomizing(true)}
            style={{
              padding: '10px 14px',
              fontSize: 11, fontWeight: 700, color: '#aaa',
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontFamily: 'inherit',
              textDecoration: 'underline',
            }}
          >
            {t('customize')}
          </button>
          <button
            type="button"
            onClick={handleAcceptAll}
            style={{
              flex: 1,
              padding: '10px 0',
              fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4,
              background: GREEN, color: '#000',
              clipPath: CHUNKY.button, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('acceptAll')}
          </button>
        </div>
      </div>

      {customizing && (
        <ConsentCustomizeSheet
          initial={customizeInitial}
          onSave={apply}
          onCancel={() => setCustomizing(false)}
        />
      )}
    </>
  )
}
