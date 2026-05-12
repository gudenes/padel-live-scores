// src/app/[locale]/player/[id]/layout.tsx
// Server-side layout wrapper to provide OG metadata + JSON-LD for player pages.
// The page itself is 'use client', so generateMetadata must live here.

import { Metadata } from 'next'
import { createServerClient } from '@/lib/supabase'
import { buildAlternates } from '@/lib/seo-helpers'
import { buildPlayerSummary, RecentMatchInput } from '@/lib/seo/player-summary'

type Props = {
  params: Promise<{ id: string }>
  children: React.ReactNode
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params

  let supabase
  try { supabase = createServerClient() } catch { return { title: 'Player | Padel Nachos' } }

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

type PlayerRow = {
  id: string
  name: string
  country: string | null
  ranking: number | null
  category: string | null
  total_matches: number | null
  win_rate: number | null
}

type DbRecent = {
  id: string
  round: string | null
  winner_pair: number | null
  finished_at: string | null
  scheduled_at: string | null
  pair1_player1_id: string | null
  pair1_player2_id: string | null
  pair2_player1_id: string | null
  pair2_player2_id: string | null
  pair1_player1: { name: string } | null
  pair1_player2: { name: string } | null
  pair2_player1: { name: string } | null
  pair2_player2: { name: string } | null
  tournament: { name: string } | null
  sets: Array<{ set_number: number; pair1_games: number | null; pair2_games: number | null }>
}

const lastName = (full: string): string => {
  const parts = full.trim().split(/\s+/)
  return parts.length > 1 ? parts.slice(1).join(' ') : parts[0]
}

export default async function PlayerLayout({ params, children }: Props) {
  let jsonLd: object | null = null
  let playerName: string | null = null
  let summary = null

  try {
    const { id } = await params
    const supabase = createServerClient()

    // Parallel: player + last 5 finished matches involving them. The matches
    // query is bounded (limit 5) and uses indexed FK columns, so it's cheap.
    const [playerRes, recentRes] = await Promise.all([
      supabase
        .from('players')
        .select('id, name, country, ranking, category, total_matches, win_rate')
        .eq('id', id)
        .single(),
      supabase
        .from('matches')
        .select(`
          id, round, winner_pair, finished_at, scheduled_at,
          pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id,
          pair1_player1:players!matches_pair1_player1_id_fkey(name),
          pair1_player2:players!matches_pair1_player2_id_fkey(name),
          pair2_player1:players!matches_pair2_player1_id_fkey(name),
          pair2_player2:players!matches_pair2_player2_id_fkey(name),
          tournament:tournaments(name),
          sets(set_number, pair1_games, pair2_games)
        `)
        .or(
          `pair1_player1_id.eq.${id},pair1_player2_id.eq.${id},pair2_player1_id.eq.${id},pair2_player2_id.eq.${id}`,
        )
        .in('status', ['finished', 'retired', 'walkover'])
        .order('finished_at', { ascending: false, nullsFirst: false })
        .limit(5),
    ])

    const player = playerRes.data as PlayerRow | null
    const recentRows = recentRes.data ?? []

    const recent: RecentMatchInput[] = (recentRows as unknown as DbRecent[])
      .filter(
        (m) =>
          m.tournament &&
          (m.pair1_player1 || m.pair1_player2 || m.pair2_player1 || m.pair2_player2),
      )
      .map((m) => {
        const playerSide =
          m.pair1_player1_id === id || m.pair1_player2_id === id ? 1 : 2
        const opponentNames =
          playerSide === 1
            ? [m.pair2_player1?.name, m.pair2_player2?.name]
            : [m.pair1_player1?.name, m.pair1_player2?.name]
        const opponents = opponentNames
          .filter((n): n is string => Boolean(n))
          .map(lastName)

        const score = m.sets
          .slice()
          .sort((a, b) => a.set_number - b.set_number)
          .map((s) =>
            playerSide === 1
              ? `${s.pair1_games ?? '?'}-${s.pair2_games ?? '?'}`
              : `${s.pair2_games ?? '?'}-${s.pair1_games ?? '?'}`,
          )
          .join(', ')

        const won = m.winner_pair != null ? m.winner_pair === playerSide : null
        const verb = won === true ? 'won' : won === false ? 'lost' : 'played'
        const result = score ? `${verb} ${score}` : verb

        return {
          tournament_name: m.tournament?.name ?? '',
          round: m.round,
          opponents: opponents.length > 0 ? [opponents.join(' / ')] : [],
          result,
          played_on: (m.finished_at ?? m.scheduled_at ?? '').slice(0, 10),
        }
      })

    playerName = player?.name ?? null
    jsonLd = player
      ? {
          '@context': 'https://schema.org',
          '@type': 'Person',
          name: player.name,
          nationality: player.country,
          sport: 'Padel',
        }
      : null

    summary = player
      ? buildPlayerSummary({
          name: player.name,
          country: player.country,
          category: player.category,
          ranking: player.ranking,
          total_matches: player.total_matches,
          win_rate: player.win_rate,
          recent,
        })
      : null
  } catch {
    // DB unavailable — render children without JSON-LD or summary
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
          <ul>
            {summary.facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
          {summary.recentLines.length > 0 && (
            <>
              <h2>Recent matches</h2>
              <ul>
                {summary.recentLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </header>
      ) : (
        playerName && (
          <h1 className="sr-only">{playerName} — Padel Player Profile & Stats</h1>
        )
      )}
      {children}
    </>
  )
}
