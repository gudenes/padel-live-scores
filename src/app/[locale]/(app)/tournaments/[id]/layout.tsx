// src/app/[locale]/(app)/tournaments/[id]/layout.tsx
// Server-side layout wrapper to provide OG metadata + JSON-LD for tournament pages.
// The page itself is 'use client', so generateMetadata must live here.

import { Metadata } from 'next'
import { createServerClient } from '@/lib/supabase'
import { buildAlternates } from '@/lib/seo-helpers'

type Props = {
  params: Promise<{ id: string }>
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

  const title = `${tournament.name} — Draws, Results & Live Scores`
  const description = `Follow ${tournament.name} live. Scores, draws, rankings and highlights.`

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
  let jsonLd: object | null = null

  try {
    const { id } = await params
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
      {children}
    </>
  )
}
