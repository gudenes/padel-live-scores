// src/app/api/cron/scores/route.ts
// Score Agent — DEV STUB version
// Inserts realistic fake Padel match data into Supabase
// Replace fetchLiveMatches() with real padelapi.org call when ready

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// ── Stub data (mirrors padelapi.org response shape exactly) ──

const STUB_MATCHES = [
  {
    id: 1001,
    status: 'live',
    coverage: 'full',
    channel: 'matches.1001',
    tournament: 'FIP Gold Marbella 2025',
    round: 'QF',
    court: 'Court 1',
    pair1: { player1: 'Alejandro Galán', player2: 'Juan Lebrón' },
    pair2: { player1: 'Pablo Lima', player2: 'Franco Stupaczuk' },
    sets: [
      {
        set_number: 1,
        set_score: '6-4',
        games: [
          { game_number: 1, game_score: '0 - 0', points: ['15:0', '30:0', '40:0', '40:15'] },
          { game_number: 2, game_score: '1 - 0', points: ['0:15', '0:30', '15:30', '30:30', '40:30'] },
        ],
      },
      {
        set_number: 2,
        set_score: null,
        games: [
          { game_number: 1, game_score: '0 - 0', points: ['15:0', '30:0', '40:0'] },
          { game_number: 2, game_score: '1 - 0', points: ['0:15', '15:15', '30:15', '40:15'] },
          { game_number: 3, game_score: '2 - 0', points: ['15:0', '15:15', '30:15'] },
        ],
      },
    ],
  },
  {
    id: 1002,
    status: 'live',
    coverage: 'full',
    channel: 'matches.1002',
    tournament: 'FIP Gold Marbella 2025',
    round: 'QF',
    court: 'Court 2',
    pair1: { player1: 'Arturo Coello', player2: 'Agustín Tapia' },
    pair2: { player1: 'Martín Di Nenno', player2: 'Lucho Capra' },
    sets: [
      {
        set_number: 1,
        set_score: '7-5',
        games: [
          { game_number: 1, game_score: '0 - 0', points: ['15:0', '30:0', '40:0'] },
        ],
      },
      {
        set_number: 2,
        set_score: '6-3',
        games: [
          { game_number: 1, game_score: '0 - 0', points: ['15:0', '30:0', '40:0'] },
        ],
      },
      {
        set_number: 3,
        set_score: null,
        games: [
          { game_number: 1, game_score: '0 - 0', points: ['15:0', '30:0'] },
          { game_number: 2, game_score: '1 - 0', points: ['0:15', '15:15', '30:15', '30:30'] },
        ],
      },
    ],
  },
  {
    id: 1003,
    status: 'live',
    coverage: 'partial',
    channel: 'matches.1003',
    tournament: 'FIP Gold Marbella 2025',
    round: 'QF',
    court: 'Court 3',
    pair1: { player1: 'Marta Ortega', player2: 'Ariana Sánchez' },
    pair2: { player1: 'Gemma Triay', player2: 'Claudia Jensen' },
    sets: [
      {
        set_number: 1,
        set_score: null,
        games: [
          { game_number: 1, game_score: '0 - 0', points: ['15:0', '15:15', '30:15', '40:15', '40:30', '40:40', 'A:40'] },
          { game_number: 2, game_score: '1 - 0', points: ['0:15', '0:30', '15:30', '30:30'] },
        ],
      },
    ],
  },
]

// ── Upsert helpers ────────────────────────────────────────────

async function upsertPlayers(
  pair1: { player1: string; player2: string },
  pair2: { player1: string; player2: string }
) {
  const players = [pair1.player1, pair1.player2, pair2.player1, pair2.player2]
  const ids: Record<string, string> = {}

  for (const name of players) {
    const externalId = name.toLowerCase().replace(/\s+/g, '-')
    const { data, error } = await supabase
      .from('players')
      .upsert({ external_id: externalId, name }, { onConflict: 'external_id' })
      .select('id')
      .single()

    if (error || !data) {
      console.error(`Failed to upsert player ${name}:`, error)
      continue
    }
    ids[name] = data.id
  }

  return ids
}

async function upsertTournament(name: string) {
  const externalId = name.toLowerCase().replace(/\s+/g, '-')
  const { data, error } = await supabase
    .from('tournaments')
    .upsert(
      { external_id: externalId, name, level: 'fip_gold' },
      { onConflict: 'external_id' }
    )
    .select('id')
    .single()

  if (error || !data) {
    console.error(`Failed to upsert tournament ${name}:`, error)
    return null
  }
  return data.id
}

async function upsertMatch(stub: (typeof STUB_MATCHES)[0]) {
  const externalId = String(stub.id)

  const tournamentId = await upsertTournament(stub.tournament)
  const playerIds = await upsertPlayers(stub.pair1, stub.pair2)

  const { data: matchRow, error: matchError } = await supabase
    .from('matches')
    .upsert(
      {
        external_id: externalId,
        tournament_id: tournamentId,
        status: stub.status,
        coverage: stub.coverage,
        pusher_channel: stub.channel,
        round: stub.round,
        court: stub.court,
        pair1_player1_id: playerIds[stub.pair1.player1],
        pair1_player2_id: playerIds[stub.pair1.player2],
        pair2_player1_id: playerIds[stub.pair2.player1],
        pair2_player2_id: playerIds[stub.pair2.player2],
        started_at: new Date().toISOString(),
        raw_payload: stub,
      },
      { onConflict: 'external_id' }
    )
    .select('id')
    .single()

  if (matchError || !matchRow) {
    console.error(`Failed to upsert match ${externalId}:`, matchError)
    return
  }

  const matchDbId = matchRow.id

  for (const set of stub.sets) {
    const isCurrentSet =
      set.set_score === null &&
      set.set_number === Math.max(...stub.sets.map((s) => s.set_number))

    const { data: setRow, error: setError } = await supabase
      .from('sets')
      .upsert(
        {
          match_id: matchDbId,
          set_number: set.set_number,
          set_score: set.set_score,
          is_current: isCurrentSet,
        },
        { onConflict: 'match_id, set_number' }
      )
      .select('id')
      .single()

    if (setError || !setRow) {
      console.error(`Failed to upsert set ${set.set_number}:`, setError)
      continue
    }

    const setDbId = setRow.id

    for (const game of set.games) {
      const isCurrentGame =
        isCurrentSet &&
        game.game_number === Math.max(...set.games.map((g) => g.game_number))

      const { error: gameError } = await supabase
        .from('games')
        .upsert(
          {
            set_id: setDbId,
            match_id: matchDbId,
            game_number: game.game_number,
            game_score: game.game_score,
            points: game.points,
            is_current: isCurrentGame,
          },
          { onConflict: 'set_id, game_number' }
        )

      if (gameError) {
        console.error(`Failed to upsert game ${game.game_number}:`, gameError)
      }
    }
  }

  console.log(
    `[Score Agent] Upserted match ${externalId} — ${stub.pair1.player1}/${stub.pair1.player2} vs ${stub.pair2.player1}/${stub.pair2.player2}`
  )
}

// ── Main handler ──────────────────────────────────────────────

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    console.log('[Score Agent] Starting stub sync...')

    const results = await Promise.allSettled(
      STUB_MATCHES.map((match) => upsertMatch(match))
    )

    const succeeded = results.filter((r) => r.status === 'fulfilled').length
    const failed = results.filter((r) => r.status === 'rejected').length

    console.log(`[Score Agent] Done. Synced: ${succeeded}, Failed: ${failed}`)

    return Response.json({
      synced: succeeded,
      failed,
      total: STUB_MATCHES.length,
      mode: 'stub',
    })
  } catch (error) {
    console.error('[Score Agent] Fatal error:', error)
    return Response.json(
      { error: 'Score agent failed', detail: String(error) },
      { status: 500 }
    )
  }
}
