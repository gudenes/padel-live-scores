// src/app/api/admin/backfill-set-games/route.ts
// One-time backfill: populate pair1_games / pair2_games for all sets that
// currently have NULL values. Pure DB operation — no external API calls.
//
// Logic:
//   - set_score IS NOT NULL  → parse directly from set_score (e.g. "6-3", "7-6(6)")
//   - set_score IS NULL      → use last game's game_score from the games table
//                              (e.g. game_score "1-2" → pair1=1, pair2=2)
//
// Usage: GET /api/admin/backfill-set-games
//        GET /api/admin/backfill-set-games?dry_run=true  (preview only, no writes)

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

function parseGamesFromSetScore(setScore: string): { p1: number; p2: number } | null {
  const parts = setScore.split('-')
  if (parts.length !== 2) return null
  const p1 = parseInt(parts[0])
  const p2 = parseInt(parts[1]) // parseInt stops at '(' so "6(6)" → 6
  if (isNaN(p1) || isNaN(p2)) return null
  return { p1, p2 }
}

export async function GET(request: Request) {
  const dryRun = new URL(request.url).searchParams.get('dry_run') === 'true'

  // Fetch all sets missing pair1_games or pair2_games, with their games
  const { data: sets, error } = await supabase
    .from('sets')
    .select('id, set_number, set_score, pair1_games, pair2_games, games(game_number, game_score)')
    .or('pair1_games.is.null,pair2_games.is.null')
    .order('id')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!sets || sets.length === 0) {
    return Response.json({ message: 'Nothing to backfill — all sets already have pair games.', updated: 0 })
  }

  const results: { set_id: string; set_score: string | null; pair1_games: number; pair2_games: number; source: string }[] = []
  const failures: { set_id: string; reason: string }[] = []

  for (const set of sets) {
    let p1: number | null = null
    let p2: number | null = null
    let source = ''

    if (set.set_score !== null) {
      // Completed set — parse from set_score
      const parsed = parseGamesFromSetScore(set.set_score)
      if (parsed) {
        p1 = parsed.p1
        p2 = parsed.p2
        source = 'set_score'
      } else {
        failures.push({ set_id: set.id, reason: `Could not parse set_score: "${set.set_score}"` })
        continue
      }
    } else {
      // In-progress set — find last game with a non-trivial game_score
      const games: { game_number: number; game_score: string | null }[] = (set.games ?? []) as any
      const lastGame = games
        .filter(g => g.game_score && g.game_score !== '0-0')
        .sort((a, b) => b.game_number - a.game_number)[0]

      if (lastGame?.game_score) {
        const parts = lastGame.game_score.split('-')
        if (parts.length === 2) {
          p1 = parseInt(parts[0])
          p2 = parseInt(parts[1])
          if (isNaN(p1) || isNaN(p2)) { p1 = null; p2 = null }
        }
      }

      if (p1 === null) {
        // No games data — default to 0-0
        p1 = 0
        p2 = 0
        source = 'default (no games)'
      } else {
        source = `game_score (game ${lastGame!.game_number})`
      }
    }

    results.push({ set_id: set.id, set_score: set.set_score, pair1_games: p1!, pair2_games: p2!, source })
  }

  if (!dryRun && results.length > 0) {
    // Batch update in chunks of 50
    const CHUNK = 50
    for (let i = 0; i < results.length; i += CHUNK) {
      const chunk = results.slice(i, i + CHUNK)
      for (const row of chunk) {
        await supabase
          .from('sets')
          .update({ pair1_games: row.pair1_games, pair2_games: row.pair2_games })
          .eq('id', row.set_id)
      }
    }
  }

  return Response.json({
    dry_run: dryRun,
    sets_found: sets.length,
    updated: results.length,
    skipped_failures: failures.length,
    results,
    failures,
  })
}
