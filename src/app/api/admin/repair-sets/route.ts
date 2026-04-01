// src/app/api/admin/repair-sets/route.ts
// Repair: extract sets + games from raw_payload for matches that have
// payload data but no sets in the sets table. Pure DB operation — no external API calls.
//
// Usage:
//   GET /api/admin/repair-sets                      — dry-run: shows which matches need repair
//   GET /api/admin/repair-sets?run=true              — repair all
//   GET /api/admin/repair-sets?run=true&tournament=<uuid>  — repair single tournament

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function GET(request: Request) {
  const url = new URL(request.url)
  const run = url.searchParams.get('run') === 'true'
  const tournamentFilter = url.searchParams.get('tournament')

  // Find matches with raw_payload that have sets data but no rows in the sets table
  let query = supabase
    .from('matches')
    .select('id, external_id, tournament_id, raw_payload, sets(id)')
    .not('raw_payload', 'is', null)

  if (tournamentFilter) {
    query = query.eq('tournament_id', tournamentFilter)
  }

  // Paginate to avoid 1000-row limit
  const allMatches: any[] = []
  let offset = 0
  while (true) {
    const { data, error } = await query.range(offset, offset + 499)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) break
    allMatches.push(...data)
    if (data.length < 500) break
    offset += 500
  }

  // Filter to matches that have sets in raw_payload but none in the sets table
  const needsRepair = allMatches.filter(m => {
    const payloadSets = m.raw_payload?.sets ?? []
    const dbSets = m.sets ?? []
    return payloadSets.length > 0 && dbSets.length === 0
  })

  if (!run) {
    return Response.json({
      mode: 'dry-run',
      totalWithPayload: allMatches.length,
      needsRepair: needsRepair.length,
      alreadyOk: allMatches.length - needsRepair.length,
      matches: needsRepair.slice(0, 20).map(m => ({
        id: m.id,
        external_id: m.external_id,
        payloadSets: m.raw_payload?.sets?.length ?? 0,
      })),
    })
  }

  // Repair: write sets + games from raw_payload
  let repaired = 0
  let setsWritten = 0
  let gamesWritten = 0
  const errors: string[] = []

  for (const match of needsRepair) {
    const payload = match.raw_payload
    const liveSets = payload?.sets ?? []

    let matchOk = true

    for (const set of liveSets) {
      // Parse set_score into pair1_games / pair2_games
      let pair1Games: number | null = null
      let pair2Games: number | null = null
      if (set.set_score) {
        const parts = set.set_score.split('-')
        if (parts.length === 2) {
          pair1Games = parseInt(parts[0]) || 0
          pair2Games = parseInt(parts[1]) || 0
        }
      }

      const { data: setRow, error: setError } = await supabase
        .from('sets')
        .upsert(
          {
            match_id: match.id,
            set_number: set.set_number,
            set_score: set.set_score,
            pair1_games: pair1Games,
            pair2_games: pair2Games,
            is_current: false,
            score_source: 'api',
          },
          { onConflict: 'match_id, set_number' }
        )
        .select('id')
        .single()

      if (setError || !setRow) {
        errors.push(`Match ${match.external_id} set ${set.set_number}: ${setError?.message ?? 'no row returned'}`)
        matchOk = false
        continue
      }

      setsWritten++

      // Write games
      for (const game of set.games ?? []) {
        const cleanPoints = (game.points ?? []).filter((p: string) => p !== '0:0')
        const { error: gameError } = await supabase
          .from('games')
          .upsert(
            {
              set_id: setRow.id,
              match_id: match.id,
              game_number: game.game_number,
              game_score: game.game_score,
              points: cleanPoints,
              is_current: false,
            },
            { onConflict: 'set_id, game_number' }
          )

        if (gameError) {
          errors.push(`Match ${match.external_id} set ${set.set_number} game ${game.game_number}: ${gameError.message}`)
        } else {
          gamesWritten++
        }
      }
    }

    if (matchOk) repaired++
  }

  return Response.json({
    matchesRepaired: repaired,
    setsWritten,
    gamesWritten,
    errors: errors.slice(0, 50),
    totalErrors: errors.length,
  })
}
