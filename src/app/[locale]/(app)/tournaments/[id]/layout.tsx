// src/app/[locale]/(app)/tournaments/[id]/layout.tsx
// Server-side layout wrapper to provide OG metadata + JSON-LD for tournament pages.
// The page itself is 'use client', so generateMetadata must live here.
//
// Also hosts the SSR EditorialHero (Wave 2) — renders auto-generated tournament
// previews / recaps as the first content block of the page when one exists.

import { Metadata } from 'next'
import { createServerClient } from '@/lib/supabase'
import { buildAlternates } from '@/lib/seo-helpers'
import { EditorialHero } from '@/components/EditorialHero'

type Props = {
  params: Promise<{ locale: string; id: string }>
  children: React.ReactNode
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params

  let supabase
  try { supabase = createServerClient() } catch { return { title: 'Tournament | Padel Nachos' } }

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, name, country, level, starts_at, ends_at')
    .eq('id', id)
    .single()

  if (!tournament) {
    return { title: 'Tournament | Padel Nachos' }
  }

  const title = `${tournament.name} — Results & Live Scores`
  const description = `Follow ${tournament.name} live. Scores, rankings and highlights.`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
    },
    ...buildAlternates(`/tournaments/${id}`),
  }
}

export default async function TournamentLayout({ params, children }: Props) {
  const { id, locale } = await params
  let jsonLd: object | null = null

  try {
    const supabase = createServerClient()

    const { data: tournament } = await supabase
      .from('tournaments')
      .select('id, name, country, starts_at, ends_at')
      .eq('id', id)
      .single()

    jsonLd = tournament
      ? {
          '@context': 'https://schema.org',
          '@type': 'SportsEvent',
          name: tournament.name,
          startDate: tournament.starts_at,
          endDate: tournament.ends_at,
          location: { '@type': 'Place', name: tournament.country },
          sport: 'Padel',
        }
      : null
  } catch {
    // DB unavailable — render children without JSON-LD
  }

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <div style={{ maxWidth: 500, margin: '0 auto' }}>
        <EditorialHero tournamentId={id} locale={locale} />
      </div>
      {children}
    </>
  )
}
