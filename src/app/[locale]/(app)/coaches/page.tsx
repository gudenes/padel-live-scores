// Coaches index: ranked by the FIP points of the players each coach works with.
// Server-rendered; tabs and pagination are plain links.

import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { createAnonServerClient } from '@/lib/supabase'
import { fetchCoachesIndex, initials, type CoachTab, type CoachIndexRow } from '@/lib/coach-page-data'
import { Link } from '@/i18n/navigation'
import { Widget } from '../../player/[id]/Widget'
import { GREEN, ORANGE, MUTED, BG_BASE } from '@/components/home/shared-constants'

const BASE_URL = 'https://padelnachos.com'
const LOCALES = ['en', 'es', 'pt', 'it', 'fr']
const TABS: CoachTab[] = ['overall', 'men', 'women']

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ tab?: string; page?: string }>
}

export const revalidate = 3600

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'coach' })
  const title = t('indexMetaTitle')
  const description = t('indexMetaDescription')
  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/${locale}/coaches`,
      languages: Object.fromEntries(LOCALES.map((l) => [l, `${BASE_URL}/${l}/coaches`])),
    },
    openGraph: { title, description, type: 'website' },
  }
}

function rankFor(row: CoachIndexRow, tab: CoachTab): number | null {
  return tab === 'men' ? row.rank_men : tab === 'women' ? row.rank_women : row.rank_overall
}
function pointsFor(row: CoachIndexRow, tab: CoachTab): number {
  return Number(tab === 'men' ? row.men_points : tab === 'women' ? row.women_points : row.total_points)
}

export default async function CoachesPage({ params, searchParams }: Props) {
  const { locale } = await params
  const sp = await searchParams
  const tab: CoachTab = TABS.includes(sp.tab as CoachTab) ? (sp.tab as CoachTab) : 'overall'
  const parsed = Number.parseInt(sp.page ?? '', 10)
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1

  const t = await getTranslations({ locale, namespace: 'coach' })
  const { rows, hasMore } = await fetchCoachesIndex(createAnonServerClient(), tab, page)
  const tabLabel: Record<CoachTab, string> = { overall: t('tabOverall'), men: t('tabMen'), women: t('tabWomen') }

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', background: BG_BASE, minHeight: '100vh', padding: 12 }}>
      <h1 style={{ fontSize: 17, fontWeight: 800, color: '#E2E8F0', margin: '6px 4px 2px', letterSpacing: '-0.01em' }}>
        {t('indexTitle')}
      </h1>
      <p style={{ fontSize: 12, color: MUTED, margin: '0 4px 12px' }}>{t('indexIntro')}</p>

      <nav style={{ display: 'flex', gap: 18, margin: '0 4px 12px' }}>
        {TABS.map((tb) => (
          <Link
            key={tb}
            href={{ pathname: '/coaches', query: { tab: tb } }}
            style={{
              fontSize: 12, fontWeight: 700, textDecoration: 'none', padding: '6px 0',
              color: tb === tab ? '#fff' : MUTED,
              borderBottom: `2px solid ${tb === tab ? GREEN : 'transparent'}`,
            }}
          >
            {tabLabel[tb]}
          </Link>
        ))}
      </nav>

      <Widget wide label={tabLabel[tab]}>
        {rows.map((r, i) => {
          const rank = rankFor(r, tab) ?? (page - 1) * 50 + i + 1
          const top3 = rank <= 3
          return (
            <Link
              key={r.coach_id}
              href={`/coach/${r.slug}`}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', textDecoration: 'none', color: 'inherit' }}
            >
              <span style={{ width: 24, textAlign: 'center', fontSize: 13, fontWeight: 800, color: top3 ? ORANGE : MUTED }}>
                {rank}
              </span>
              <div style={{
                width: 34, height: 34, borderRadius: '50%', background: top3 ? ORANGE : '#555', color: '#000',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0,
              }}>
                {initials(r.display_name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#E2E8F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.display_name}
                </div>
                <div style={{ fontSize: 10, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.top.names.join(', ')}{r.top.more ? ` +${r.top.more}` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: GREEN }}>
                  {Math.round(pointsFor(r, tab)).toLocaleString(locale)}
                </div>
                <div style={{ fontSize: 10, color: MUTED }}>{t('playersCount', { count: r.player_count })}</div>
              </div>
            </Link>
          )
        })}
        {hasMore && (
          <Link
            href={{ pathname: '/coaches', query: { tab, page: page + 1 } }}
            style={{ display: 'block', textAlign: 'center', marginTop: 6, padding: 8, fontSize: 12, fontWeight: 700, color: MUTED, textDecoration: 'none' }}
          >
            {t('loadMore')}
          </Link>
        )}
      </Widget>
    </div>
  )
}
