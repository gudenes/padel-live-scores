// src/app/[locale]/(app)/rankings/page.tsx
// SSR rankings — server-renders top 100 men's official as static HTML
// via the client island's server-side initial-render path. Locale
// intro paragraph is sr-only (HTML for Googlebot / screen readers,
// invisible to sighted users) per the design choice in the spec.

import { getTranslations, getFormatter } from 'next-intl/server'
import { createServerClient } from '@/lib/supabase'
import GlobalHeader from '@/components/nav/GlobalHeader'
import { BG_BASE, type Player } from './shared'
import { RankingsInteractive } from './RankingsInteractive'
import { buildRankingsJsonLd } from './jsonld'

export const revalidate = 3600

const BASE_URL = 'https://padelnachos.com'
const PLAYER_COLUMNS = 'id, name, display_name, country, ranking, points, ranking_move, race_ranking, race_points, race_move, avatar_url, category, updated_at, ranking_date'

type Props = {
  params: Promise<{ locale: string }>
}

async function loadInitialData(): Promise<{ players: Player[]; rankingDateISO: string | null }> {
  let supabase
  try {
    supabase = createServerClient()
  } catch {
    return { players: [], rankingDateISO: null }
  }

  const [playersResult, dateResult] = await Promise.all([
    supabase
      .from('players')
      .select(PLAYER_COLUMNS)
      .eq('category', 'men')
      .not('ranking', 'is', null)
      .order('ranking', { ascending: true })
      .limit(100),
    supabase
      .from('players')
      .select('ranking_date')
      .not('ranking_date', 'is', null)
      .order('ranking_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const players = (playersResult.data ?? []) as Player[]
  const rankingDateISO = (dateResult.data?.ranking_date as string | null | undefined) ?? null
  return { players, rankingDateISO }
}

export default async function RankingsPage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'rankings' })
  const tSeo = await getTranslations({ locale, namespace: 'seo.rankings' })
  const format = await getFormatter({ locale })

  const { players, rankingDateISO } = await loadInitialData()

  const rankingDateFormatted = rankingDateISO
    ? format.dateTime(new Date(rankingDateISO), { dateStyle: 'long' })
    : null

  const jsonLd = buildRankingsJsonLd({
    players,
    locale,
    baseUrl: BASE_URL,
    listName: tSeo('jsonld_name'),
  })

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', background: BG_BASE, minHeight: '100vh' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <GlobalHeader />

      {/* Intro paragraph is sr-only — present in HTML for Googlebot
          and screen readers, hidden from sighted users. Stays on
          intro.men_official regardless of client toggles (Google
          indexes the SSR'd default). */}
      <p className="sr-only">{t('intro.men_official')}</p>

      <RankingsInteractive
        initialPlayers={players}
        initialRankingDateFormatted={rankingDateFormatted}
        initialRankingDateISO={rankingDateISO}
        locale={locale}
      />
    </div>
  )
}
