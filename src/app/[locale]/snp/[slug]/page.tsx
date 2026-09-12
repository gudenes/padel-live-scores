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
import { FlagImage } from '@/components/FlagImage'
import BottomNav from '@/components/nav/BottomNavV3'
import { TeamRoster } from './TeamRoster'
import { TeamFixtures } from './TeamFixtures'

const SOURCE = 'snp'
const BASE_URL = 'https://padelnachos.com'
const ORANGE = '#F5A623'
const BG_BASE = '#0A0A0A'
const BG_CARD = '#141414'
const MUTED = '#8A8A8A'
const BORDER = '#1C1C1C'

type Props = {
  params: Promise<{ locale: string; slug: string }>
  searchParams: Promise<{ season?: string }>
}

export const revalidate = 3600

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale, slug } = await params
  const { season } = await searchParams
  const data = await fetchTeamSeason(createAnonServerClient(), slug, SOURCE, season)
  if (!data) return { title: 'Team | Padel Nachos' }

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
    title: `${title} | Padel Nachos`,
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
  const { locale, slug } = await params
  const { season } = await searchParams
  const data = await fetchTeamSeason(createAnonServerClient(), slug, SOURCE, season)
  if (!data) notFound()

  const t = await getTranslations({ locale, namespace: 'team' })

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SportsTeam',
    name: data.team.name,
    sport: 'Padel',
    ...(data.team.city ? { location: { '@type': 'Place', name: data.team.city } } : {}),
    ...(data.team.crest_url ? { logo: data.team.crest_url } : {}),
    member: data.roster.map(r => ({ '@type': 'Person', name: r.name })),
  }

  const totals: Array<{ label: string; value: string }> = [
    { label: t('tiesWon'), value: `${data.season.ties_won ?? 0}/${data.season.ties_played ?? 0}` },
    { label: t('courtRecord'), value: `${data.season.courts_won ?? 0}–${data.season.courts_lost ?? 0}` },
    { label: t('pointsFor'), value: `${data.season.points_for ?? 0}–${data.season.points_against ?? 0}` },
  ]

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div style={{ background: BG_BASE, minHeight: '100dvh', maxWidth: 500, margin: '0 auto', paddingBottom: 80 }}>

        <div style={{ padding: '18px 16px 14px', borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', lineHeight: 1.15 }}>
            {data.team.name}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, color: MUTED, fontSize: 12 }}>
            {data.team.country && <FlagImage country={data.team.country} size={16} />}
            <span>{[data.team.competition, data.team.city].filter(Boolean).join(' · ')}</span>
          </div>
          <div style={{ fontSize: 11, color: ORANGE, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            {t('seasonLabel')} {data.season.label}
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
            {totals.map(x => (
              <div key={x.label} style={{
                flex: 1, background: BG_CARD, padding: '9px 6px', textAlign: 'center',
                clipPath: 'polygon(0% 3%, 99% 0%, 100% 97%, 1% 100%)',
              }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                  {x.value}
                </div>
                <div style={{ fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>
                  {x.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: '14px 14px 0' }}>
          <div style={{ fontSize: 9, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            {t('squad')}
          </div>
          <TeamRoster roster={data.roster} />
        </div>

        <div style={{ padding: '20px 14px 0' }}>
          <div style={{ fontSize: 9, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            {t('rounds')}
          </div>
          <TeamFixtures fixtures={data.fixtures} roster={data.roster} />
        </div>

        {data.season.notes && (
          <div style={{ margin: '8px 14px 0', background: BG_CARD, padding: '10px 12px' }}>
            <div style={{ fontSize: 8, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>
              {t('methodNote')}
            </div>
            <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.5 }}>{data.season.notes}</div>
          </div>
        )}
      </div>
      <BottomNav />
    </>
  )
}
