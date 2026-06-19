// src/app/[locale]/not-found.tsx
//
// Branded, localized 404 boundary for the [locale] subtree. Rendered whenever
// notFound() fires inside any descendant segment — the tournament/player/match
// detail layouts (orphaned entity ids) plus the existing matches/[date] and
// news/[slug] notFound() calls. The ancestor [locale]/layout.tsx still runs
// (it sets the request locale + i18n provider), so getTranslations() resolves
// the correct locale here even though not-found components receive no params.
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import EmptyState from '@/components/EmptyState'

const BG_BASE = '#1A1A1A'
const GREEN = '#7ED321'
const CHUNKY_BUTTON = 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)'

export default async function LocaleNotFound() {
  const t = await getTranslations('notFound')

  return (
    <div
      style={{
        background: BG_BASE,
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div style={{ maxWidth: 420, width: '100%' }}>
        <EmptyState
          title={t('title')}
          subtitle={t('body')}
          action={
            <Link
              href="/"
              style={{
                display: 'inline-block',
                background: GREEN,
                color: '#0A0A0A',
                fontWeight: 800,
                fontSize: 14,
                padding: '10px 22px',
                textDecoration: 'none',
                clipPath: CHUNKY_BUTTON,
              }}
            >
              {t('cta')}
            </Link>
          }
        />
      </div>
    </div>
  )
}
