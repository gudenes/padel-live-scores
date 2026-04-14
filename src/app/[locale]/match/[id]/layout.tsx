// src/app/match/[id]/layout.tsx
// Server-side layout wrapper to provide OG metadata for match pages.
// The page itself is 'use client', so generateMetadata must live here.

import { Metadata } from 'next'
import { createServerClient } from '@/lib/supabase'
import { buildAlternates } from '@/lib/seo-helpers'

type Props = {
  params: Promise<{ id: string }>
  children: React.ReactNode
}

function lastName(fullName: string | null | undefined): string {
  if (!fullName) return ''
  const parts = fullName.trim().split(' ')
  return parts.length > 1 ? parts.slice(1).join(' ') : parts[0]
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params

  let supabase
  try { supabase = createServerClient() } catch { return { title: 'Match | Padel Nachos' } }

  const { data: match } = await supabase
    .from('matches')
    .select(`
      id,
      status,
      round,
      winner_pair,
      pair1_player1:players!matches_pair1_player1_id_fkey(name, display_name),
      pair1_player2:players!matches_pair1_player2_id_fkey(name, display_name),
      pair2_player1:players!matches_pair2_player1_id_fkey(name, display_name),
      pair2_player2:players!matches_pair2_player2_id_fkey(name, display_name),
      tournament:tournaments(name),
      sets(set_number, pair1_games, pair2_games)
    `)
    .eq('id', id)
    .single()

  if (!match) {
    return { title: 'Match | Padel Nachos' }
  }

  type PlayerRef = { name: string } | null
  const p1 = [
    lastName((match.pair1_player1 as unknown as PlayerRef)?.name),
    lastName((match.pair1_player2 as unknown as PlayerRef)?.name),
  ]
    .filter(Boolean)
    .join('/')

  const p2 = [
    lastName((match.pair2_player1 as unknown as PlayerRef)?.name),
    lastName((match.pair2_player2 as unknown as PlayerRef)?.name),
  ]
    .filter(Boolean)
    .join('/')

  type TournamentRef = { name: string } | null
  const tournamentName = (match.tournament as unknown as TournamentRef)?.name ?? ''
  const round = match.round ?? ''
  const roundSuffix = round ? ` ${round}` : ''

  // Sort sets by set_number for score string
  type SetRow = { set_number: number; pair1_games: number | null; pair2_games: number | null }
  const sets: SetRow[] = ((match.sets as SetRow[]) ?? []).sort(
    (a, b) => a.set_number - b.set_number
  )

  let title: string

  if (match.status === 'finished' || match.status === 'ended') {
    const scoreStr = sets
      .map((s) => `${s.pair1_games ?? '?'}-${s.pair2_games ?? '?'}`)
      .join(', ')

    const winnerLabel =
      match.winner_pair === 1
        ? p1
        : match.winner_pair === 2
          ? p2
          : p1 || p2

    if (scoreStr) {
      title = `${winnerLabel} won ${scoreStr} — ${tournamentName}${roundSuffix}`
    } else {
      title = `${p1} vs ${p2} — ${tournamentName}${roundSuffix}`
    }
  } else if (match.status === 'live') {
    title = `LIVE: ${p1} vs ${p2} — ${tournamentName}`
  } else {
    // scheduled / upcoming
    title = `${p1} vs ${p2} — ${tournamentName}${roundSuffix}`
  }

  const description = 'Follow live padel scores on PadelNachos'

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
    ...buildAlternates(`/match/${id}`),
  }
}

export default async function MatchLayout({ params, children }: Props) {
  let jsonLd: object | null = null

  try {
    const { id } = await params
    const supabase = createServerClient()

    const { data: match } = await supabase
      .from('matches')
      .select(`
        id,
        status,
        pair1_player1:players!matches_pair1_player1_id_fkey(name),
        pair1_player2:players!matches_pair1_player2_id_fkey(name),
        pair2_player1:players!matches_pair2_player1_id_fkey(name),
        pair2_player2:players!matches_pair2_player2_id_fkey(name),
        tournament:tournaments(name, starts_at, ends_at)
      `)
      .eq('id', id)
      .single()

    type PlayerRef = { name: string } | null
    type TournamentRef = { name: string; starts_at: string | null; ends_at: string | null } | null

    const tournament = match?.tournament as unknown as TournamentRef
    const p1 = [
      (match?.pair1_player1 as unknown as PlayerRef)?.name,
      (match?.pair1_player2 as unknown as PlayerRef)?.name,
    ]
      .filter(Boolean)
      .join(' / ')
    const p2 = [
      (match?.pair2_player1 as unknown as PlayerRef)?.name,
      (match?.pair2_player2 as unknown as PlayerRef)?.name,
    ]
      .filter(Boolean)
      .join(' / ')

    jsonLd =
      match && tournament
        ? {
            '@context': 'https://schema.org',
            '@type': 'SportsEvent',
            name: `${p1} vs ${p2}`,
            startDate: tournament.starts_at,
            endDate: tournament.ends_at,
            location: { '@type': 'Place', name: tournament.name },
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
