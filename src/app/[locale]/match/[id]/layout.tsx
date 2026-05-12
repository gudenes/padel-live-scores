// src/app/match/[id]/layout.tsx
// Server-side layout wrapper to provide OG metadata for match pages.
// The page itself is 'use client', so generateMetadata must live here.

import { Metadata } from 'next'
import { createServerClient } from '@/lib/supabase'
import { buildAlternates } from '@/lib/seo-helpers'
import { buildMatchSummary } from '@/lib/seo/match-summary'

type Props = {
  params: Promise<{ id: string }>
  children: React.ReactNode
}

function countryName(code: string | null): string | null {
  if (!code) return null
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
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
      pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name,
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
  // Coalesce join → thin-name fallback so amateur-tier matches still
  // generate sensible titles instead of "/  / /".
  const playerName = (
    joined: unknown,
    fallback: string | null | undefined,
  ): string | undefined =>
    (joined as PlayerRef)?.name ?? (fallback?.trim() || undefined)

  const p1 = [
    lastName(playerName(match.pair1_player1, match.pair1_player1_name)),
    lastName(playerName(match.pair1_player2, match.pair1_player2_name)),
  ]
    .filter(Boolean)
    .join('/')

  const p2 = [
    lastName(playerName(match.pair2_player1, match.pair2_player1_name)),
    lastName(playerName(match.pair2_player2, match.pair2_player2_name)),
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
  let h1Text: string | null = null
  let summary: ReturnType<typeof buildMatchSummary> | null = null

  try {
    const { id } = await params
    const supabase = createServerClient()

    const { data: match } = await supabase
      .from('matches')
      .select(`
        id,
        status,
        round,
        winner_pair,
        scheduled_at, started_at, finished_at,
        pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name,
        pair1_player1:players!matches_pair1_player1_id_fkey(name),
        pair1_player2:players!matches_pair1_player2_id_fkey(name),
        pair2_player1:players!matches_pair2_player1_id_fkey(name),
        pair2_player2:players!matches_pair2_player2_id_fkey(name),
        tournament:tournaments(name, country, starts_at, ends_at, level),
        sets(set_number, pair1_games, pair2_games)
      `)
      .eq('id', id)
      .single()

    type PlayerRef = { name: string } | null
    type TournamentRef = { name: string; country: string | null; starts_at: string | null; ends_at: string | null; level: string | null } | null

    const tournament = match?.tournament as unknown as TournamentRef
    // Same coalescing pattern as generateMetadata: thin-match name
    // fallback when the player join is null (amateur-tier matches).
    const playerName = (joined: unknown, fallback: string | null | undefined): string | undefined =>
      (joined as PlayerRef)?.name ?? (fallback?.trim() || undefined)

    const p1Names = [
      playerName(match?.pair1_player1, match?.pair1_player1_name),
      playerName(match?.pair1_player2, match?.pair1_player2_name),
    ].filter((n): n is string => Boolean(n))
    const p2Names = [
      playerName(match?.pair2_player1, match?.pair2_player1_name),
      playerName(match?.pair2_player2, match?.pair2_player2_name),
    ].filter((n): n is string => Boolean(n))
    const p1 = p1Names.join(' / ')
    const p2 = p2Names.join(' / ')

    // Per-match dates — Google's SportsEvent expects the actual match
    // window, not the parent tournament's full date range. Fall back to
    // tournament.starts_at only when the match has no scheduling info at
    // all (rare for tracked matches, common for backfilled historical).
    const startDate = match?.started_at ?? match?.scheduled_at ?? tournament?.starts_at ?? null
    const endDate = match?.finished_at ?? null

    const buildTeam = (names: string[]) =>
      names.length > 0
        ? {
            '@type': 'SportsTeam',
            name: names.join(' / '),
            athlete: names.map((n) => ({ '@type': 'Person', name: n })),
          }
        : null

    const competitor = [buildTeam(p1Names), buildTeam(p2Names)].filter(Boolean)

    jsonLd =
      match && tournament && startDate
        ? {
            '@context': 'https://schema.org',
            '@type': 'SportsEvent',
            name: `${p1} vs ${p2}`,
            startDate,
            ...(endDate ? { endDate } : {}),
            location: {
              '@type': 'Place',
              name: tournament.name,
              ...(tournament.country ? { address: tournament.country } : {}),
            },
            sport: 'Padel',
            ...(competitor.length > 0 ? { competitor } : {}),
          }
        : null

    if (p1 && p2) {
      const tournamentName = tournament?.name ?? ''
      h1Text = tournamentName
        ? `${p1} vs ${p2} — ${tournamentName}`
        : `${p1} vs ${p2}`
    }

    if (match && tournament && (p1Names.length > 0 || p2Names.length > 0)) {
      summary = buildMatchSummary({
        status: match.status,
        round: match.round ?? null,
        winner_pair: match.winner_pair ?? null,
        scheduled_at: match.scheduled_at ?? null,
        finished_at: match.finished_at ?? null,
        pair1: { names: p1Names },
        pair2: { names: p2Names },
        sets: ((match.sets as Array<{
          set_number: number
          pair1_games: number | null
          pair2_games: number | null
        }>) ?? []),
        tournament: {
          name: tournament.name,
          country: countryName(tournament.country),
          level: tournament.level ?? null,
        },
      })
    }
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
      {summary ? (
        <header className="sr-only">
          <h1>{summary.headline}</h1>
          {summary.facts.length > 0 && (
            <ul>
              {summary.facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          )}
        </header>
      ) : (
        h1Text && <h1 className="sr-only">{h1Text}</h1>
      )}
      {children}
    </>
  )
}
