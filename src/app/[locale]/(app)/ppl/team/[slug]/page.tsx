// Pro Padel League franchise page.
//
// Server-rendered, unlike /ppl itself: a franchise page is the kind of thing
// people link to and search for, so the roster and results need to be in the
// HTML rather than fetched after hydration.
//
// Lives inside the (app) group, so BottomNav and the 72px bottom padding come
// from the group layout. The SNP team page sits outside that group and has to
// mount its own nav — not a pattern to copy.
//
// `?division=ppl_ii` selects the division. It is a real part of the identity
// here, not a filter: a franchise runs two independent squads with separate
// records, and the same slug means a different team in each.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createAnonServerClient } from '@/lib/supabase'
import { fetchPplTeamPage } from '@/lib/ppl-team-data'
import { divisionLabel, type PplLevel } from '@/lib/ppl-hub'
import { BG_BASE } from '@/components/home/shared'
import PplTeamShell from './PplTeamShell'

const BASE_URL = 'https://padelnachos.com'

type Props = {
  params: Promise<{ locale: string; slug: string }>
  searchParams: Promise<{ division?: string }>
}

export const revalidate = 3600

/** Only the two spellings are accepted; anything else falls back to PPL. */
function levelFrom(division: string | undefined): PplLevel {
  return division === 'ppl_ii' || division === 'ppl-ii' ? 'ppl_ii' : 'ppl'
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale, slug } = await params
  const level = levelFrom((await searchParams).division)
  const data = await fetchPplTeamPage(createAnonServerClient(), slug, level)
  if (!data) return { title: 'Team' }

  const t = await getTranslations({ locale, namespace: 'ppl' })
  const division = divisionLabel(level)
  const title = t('teamMetaTitle', { team: data.team.name, division })
  const description = t('teamMetaDescription', {
    team: data.team.name,
    division,
    tiesWon: data.totals.tiesWon,
    tiesPlayed: data.totals.tiesPlayed,
    courtsWon: data.totals.courtsWon,
    courtsLost: data.totals.courtsLost,
  })

  // The division is part of the canonical URL. Without it the two squads
  // would compete for one canonical and search engines would be told the
  // PPL II page is a duplicate of the PPL one.
  const query = level === 'ppl_ii' ? '?division=ppl_ii' : ''
  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/${locale}/ppl/team/${slug}${query}`,
      languages: Object.fromEntries(
        ['en', 'es', 'pt', 'it', 'fr'].map((l) => [l, `${BASE_URL}/${l}/ppl/team/${slug}${query}`]),
      ),
    },
    openGraph: { title, description, type: 'website' },
  }
}

export default async function PplTeamPage({ params, searchParams }: Props) {
  const { slug } = await params
  const level = levelFrom((await searchParams).division)
  const data = await fetchPplTeamPage(createAnonServerClient(), slug, level)
  if (!data) notFound()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SportsTeam',
    name: data.team.name,
    sport: 'Padel',
    ...(data.team.city ? { location: data.team.city } : {}),
    ...(data.team.crestUrl ? { logo: data.team.crestUrl } : {}),
    memberOf: { '@type': 'SportsOrganization', name: 'Pro Padel League' },
    member: data.roster.map((p) => ({ '@type': 'Person', name: p.displayName?.trim() || p.name })),
  }

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', background: BG_BASE, minHeight: '100vh' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PplTeamShell
        data={{
          ...data,
          // Maps do not survive the server -> client boundary.
          opponentNames: Object.fromEntries(data.opponentNames),
          eventNames: Object.fromEntries(data.eventNames),
        }}
      />
    </div>
  )
}
