// src/app/[locale]/player/[id]/layout.tsx
// Server-side layout wrapper to provide OG metadata + JSON-LD for player pages.
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

  const supabase = createServerClient()

  const { data: player } = await supabase
    .from('players')
    .select('id, name, country, ranking, category')
    .eq('id', id)
    .single()

  if (!player) {
    return { title: 'Player | Padel Nachos' }
  }

  const title = `${player.name} — Padel Player Profile & Stats`
  const description = player.ranking
    ? `#${player.ranking} ${player.name} from ${player.country}. Match history, stats, and equipment.`
    : `${player.name} from ${player.country}. Match history, stats, and equipment.`

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
    ...buildAlternates(`/player/${id}`),
  }
}

export default async function PlayerLayout({ params, children }: Props) {
  const { id } = await params

  const supabase = createServerClient()

  const { data: player } = await supabase
    .from('players')
    .select('id, name, country')
    .eq('id', id)
    .single()

  const jsonLd = player
    ? {
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: player.name,
        nationality: player.country,
        sport: 'Padel',
      }
    : null

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
