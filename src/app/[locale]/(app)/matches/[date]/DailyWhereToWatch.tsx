// src/app/[locale]/(app)/matches/[date]/DailyWhereToWatch.tsx
//
// Server component — renders a "Where to watch" card at the top of the
// daily-matches page. SSR (not a client component) because the whole
// point of this page is that Google sees the full HTML; a React hook
// fetching broadcasters post-hydration would leave broadcaster names
// out of the indexed body entirely.
//
// Data model (mirrors the client-side WhereToWatch.tsx used on the
// tournament detail page):
//   1. `broadcast_info` — global editorial cards (e.g. Red Bull worldwide
//      for QFs→Finals, Premier Padel YouTube worldwide for R1-3).
//   2. `broadcasters`   — country-scoped rows, filtered by the user's
//      geo-country cookie (set by src/proxy.ts from Vercel's
//      x-vercel-ip-country header). For Googlebot / users without a
//      country we skip the regional list and still show the global
//      editorial cards.
//
// Rendered only when the day has at least one Premier-tier tournament
// (`hasPremierToday` gate in page.tsx). Premier is the only tier this
// broadcaster data covers — showing "Where to watch" on an all-FIP day
// would be a lie. Guard lives at the call site so this component stays
// a dumb renderer.

import { cookies } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { createServerClient } from '@/lib/supabase'

// ── Brand tokens (match the tournament-page WhereToWatch) ─────
const ORANGE = '#F5A623'
const GREEN = '#7ED321'
const MUTED = '#6B7280'
const BG_CARD = '#141414'
const BG_CARD2 = '#0F0F0F'
const BORDER = 'rgba(255,255,255,0.06)'
const CHUNKY_CARD = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'
const CHUNKY_ROW = 'polygon(0% 4%, 99% 0%, 100% 96%, 1% 100%)'

interface BroadcastInfoRow {
  id: string
  title: string
  description: string | null
  url: string
  logo_url: string | null
  display_order: number
}

interface BroadcasterRow {
  id: string
  name: string
  url: string
  logo_url: string | null
  is_free: boolean
  display_order: number
  country_iso2: string
}

// Minimal inline map — the daily page only really needs a handful of
// common cases; for anything missing we fall back to the ISO code
// uppercased so the string is still sensible ("Where to watch in BE").
const ISO2_TO_NAME: Record<string, string> = {
  es: 'Spain',   it: 'Italy',       fr: 'France',         de: 'Germany',
  gb: 'United Kingdom',  us: 'United States',  ar: 'Argentina',
  mx: 'Mexico',  br: 'Brazil',      pt: 'Portugal',       nl: 'Netherlands',
  be: 'Belgium', se: 'Sweden',      no: 'Norway',         dk: 'Denmark',
  fi: 'Finland', pl: 'Poland',      ch: 'Switzerland',    at: 'Austria',
  ie: 'Ireland', gr: 'Greece',      tr: 'Turkey',         il: 'Israel',
  sa: 'Saudi Arabia',    ae: 'UAE', qa: 'Qatar',          eg: 'Egypt',
  ma: 'Morocco',         za: 'South Africa',              jp: 'Japan',
  kr: 'South Korea',     cn: 'China',                     in: 'India',
  au: 'Australia',
}
function countryDisplay(iso2: string | null): string {
  if (!iso2) return ''
  return ISO2_TO_NAME[iso2.toLowerCase()] ?? iso2.toUpperCase()
}

interface Props {
  locale: string
}

export async function DailyWhereToWatch({ locale }: Props) {
  const t = await getTranslations({ locale, namespace: 'daily' })
  const cookieStore = await cookies()
  const country = (cookieStore.get('geo-country')?.value || '').toLowerCase() || null

  const supabase = createServerClient()

  // Two independent queries; run them in parallel.
  const [globalRes, regionalRes] = await Promise.all([
    supabase
      .from('broadcast_info')
      .select('id, title, description, url, logo_url, display_order')
      .eq('active', true)
      .order('display_order', { ascending: true }),
    country
      ? supabase
          .from('broadcasters')
          .select('id, name, url, logo_url, is_free, display_order, country_iso2')
          .eq('active', true)
          .eq('country_iso2', country)
          .order('display_order', { ascending: true })
          .order('is_free', { ascending: false })
      : Promise.resolve({ data: [] as BroadcasterRow[], error: null }),
  ])

  if (globalRes.error) {
    console.error('[DailyWhereToWatch] global fetch failed:', globalRes.error.message)
  }
  if (regionalRes.error) {
    console.error('[DailyWhereToWatch] regional fetch failed:', regionalRes.error.message)
  }

  const globalCards = (globalRes.data ?? []) as BroadcastInfoRow[]
  const regional = (regionalRes.data ?? []) as BroadcasterRow[]

  // Bail if there's nothing to show — never render an empty header card.
  if (globalCards.length === 0 && regional.length === 0) return null

  const regionName = countryDisplay(country)

  return (
    <section
      aria-label={t('whereToWatchHeading')}
      style={{
        background: BG_CARD,
        clipPath: CHUNKY_CARD,
        border: `1px solid ${BORDER}`,
        padding: '14px 16px',
        margin: '0 16px 16px',
      }}
    >
      {/* Card title */}
      <div style={{
        fontSize: 9, color: ORANGE, fontWeight: 800,
        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
          <polyline points="17 2 12 7 7 2" />
        </svg>
        {t('whereToWatchHeading')}
      </div>

      {/* Global editorial cards */}
      {globalCards.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          marginBottom: regional.length > 0 ? 14 : 0,
        }}>
          {globalCards.map(item => (
            <a
              key={item.id}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px',
                background: BG_CARD2,
                clipPath: CHUNKY_ROW,
                textDecoration: 'none', color: 'inherit',
              }}
            >
              {item.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.logo_url}
                  alt=""
                  style={{ width: 48, height: 28, objectFit: 'contain', flexShrink: 0 }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
                  {item.title}
                </div>
                {item.description && (
                  <div style={{
                    fontSize: 9, color: MUTED, marginTop: 3,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical' as const,
                  }}>
                    {item.description}
                  </div>
                )}
              </div>
              <span style={{
                fontSize: 9, fontWeight: 800, color: GREEN,
                background: 'rgba(126,211,33,0.12)',
                padding: '3px 8px', clipPath: CHUNKY_BADGE,
                whiteSpace: 'nowrap',
              }}>
                {t('freeBadge')} →
              </span>
            </a>
          ))}
        </div>
      )}

      {/* Regional broadcaster list — geo-gated by cookie */}
      {regional.length > 0 && (
        <>
          <div style={{
            fontSize: 9, color: MUTED, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 0.8,
            marginBottom: 8, marginTop: globalCards.length > 0 ? 0 : 4,
          }}>
            {t('inRegion', { region: regionName })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {regional.map(b => (
              <a
                key={b.id}
                href={b.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px',
                  background: BG_CARD2,
                  clipPath: CHUNKY_ROW,
                  textDecoration: 'none', color: 'inherit',
                }}
              >
                {b.logo_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={b.logo_url}
                    alt=""
                    style={{ width: 36, height: 22, objectFit: 'contain', flexShrink: 0 }}
                  />
                )}
                <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#fff' }}>
                  {b.name}
                </div>
                {b.is_free && (
                  <span style={{
                    fontSize: 8, fontWeight: 800, color: GREEN,
                    background: 'rgba(126,211,33,0.12)',
                    padding: '2px 6px', clipPath: CHUNKY_BADGE,
                  }}>
                    {t('freeBadge')}
                  </span>
                )}
                <span style={{ fontSize: 14, color: MUTED, marginLeft: 2 }}>→</span>
              </a>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
