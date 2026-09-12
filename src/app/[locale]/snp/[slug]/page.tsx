// src/app/[locale]/snp/[slug]/page.tsx
// Public team page for a Series Nacionales de Pádel club.
//
// Server-rendered on purpose: this is a shareable destination, so a crawler
// has to see content, not a client-side shell. It reads with the ANON server
// client so what it renders is exactly what an anonymous visitor may read —
// the service client would bypass RLS.
//
// `snp` is a literal folder rather than a dynamic [league] segment: a dynamic
// one would sit at the locale root and could shadow, or be shadowed by, any
// top-level route. A second league becomes a second folder.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createAnonServerClient } from '@/lib/supabase'
import { fetchTeamSeason } from '@/lib/amateur-profile'
import BottomNav from '@/components/nav/BottomNavV3'
import { TeamPageShell } from './TeamPageShell'

const SOURCE = 'snp'
const BASE_URL = 'https://padelnachos.com'
const BG_BASE = '#0A0A0A'

type Props = {
  params: Promise<{ locale: string; slug: string }>
  searchParams: Promise<{ season?: string }>
}

export const revalidate = 3600

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale, slug } = await params
  const { season } = await searchParams
  const data = await fetchTeamSeason(createAnonServerClient(), slug, SOURCE, season)
  // The root layout applies `template: '%s | Padel Nachos'`, so titles here
  // must NOT carry the brand themselves — that is how you get
  // "… | Padel Nachos | Padel Nachos" in the tab and in every shared link.
  if (!data) return { title: 'Team' }

  const t = await getTranslations({ locale, namespace: 'team' })
  const title = t('metaTitle', {
    team: data.team.name,
    competition: data.team.short_name ?? data.team.competition ?? '',
    season: data.season.label,
  })
  const description = t('metaDescription', {
    team: data.team.name,
    competition: data.team.competition ?? '',
    season: data.season.label,
    tiesWon: data.season.ties_won ?? 0,
    tiesPlayed: data.season.ties_played ?? 0,
    courtsWon: data.season.courts_won ?? 0,
    courtsLost: data.season.courts_lost ?? 0,
  })

  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/${locale}/snp/${slug}`,
      languages: Object.fromEntries(
        ['en', 'es', 'pt', 'it', 'fr'].map(l => [l, `${BASE_URL}/${l}/snp/${slug}`]),
      ),
    },
    openGraph: { title, description, type: 'website' },
  }
}

export default async function TeamPage({ params, searchParams }: Props) {
  const { slug } = await params
  const { season } = await searchParams
  const data = await fetchTeamSeason(createAnonServerClient(), slug, SOURCE, season)
  if (!data) notFound()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SportsTeam',
    name: data.team.name,
    sport: 'Padel',
    ...(data.team.city ? { location: { '@type': 'Place', name: data.team.city } } : {}),
    ...(data.team.crest_url ? { logo: data.team.crest_url } : {}),
    member: data.roster.map(r => ({ '@type': 'Person', name: r.name })),
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div style={{ background: BG_BASE, minHeight: '100dvh', maxWidth: 500, margin: '0 auto', paddingBottom: 80 }}>
        <TeamPageShell data={data} />
      </div>
      <BottomNav />
    </>
  )
}
