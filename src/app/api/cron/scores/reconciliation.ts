// src/app/api/cron/scores/reconciliation.ts
// Reconciliation module for the Score Agent
// Detects and repairs incomplete finished matches on every cron run
// Add this to the bottom of your GET handler in route.ts

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const PADELAPI_BASE = 'https://padelapi.org/api'
const PADELAPI_TOKEN = process.env.PADELAPI_TOKEN!

// ── Types ─────────────────────────────────────────────────────
interface ApiMatchDetail {
  id: number
  status: string
  winner_pair?: number | null
  sets?: Array<{
    set_number: number
    set_score: string | null
    games: Array<{
      game_number: number
      game_score: string
      points: string[]
    }>
  }>
}

// ── Fetch match detail from REST (not live endpoint) ──────────
async function fetchMatchDetail(externalId: string): Promise<ApiMatchDetail | null> {
  try {
    const res = await fetch(`${PADELAPI_BASE}/matches/${externalId}`, {
      headers: { Authorization: `Bearer ${PADELAPI_TOKEN}` },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// ── Repair a single incomplete match ─────────────────────────
async function repairMatch(matchDbId: string, externalId: string): Promise<string> {
  const detail = await fetchMatchDetail(externalId)

  if (!detail) {
    return `skipped — no API data for match ${externalId}`
  }

  // 1. Update match status and winner_pair
  await supabase
    .from('matches')
    .update({
      status: detail.status ?? 'finished',
      winner_pair: detail.winner_pair ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', matchDbId)

  // 2. Upsert sets from the REST response
  if (detail.sets && detail.sets.length > 0) {
    for (const set of detail.sets) {
      // Skip sets with no score — these are orphan tracking artifacts
      if (!set.set_score) continue

      const { data: setRow } = await supabase
        .from('sets')
        .upsert(
          {
            match_id: matchDbId,
            set_number: set.set_number,
            set_score: set.set_score,
            is_current: false, // match is finished
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'match_id, set_number' }
        )
        .select('id')
        .single()

      if (!setRow) continue

      // 3. Upsert games for this set
      for (const game of set.games ?? []) {
        await supabase
          .from('games')
          .upsert(
            {
              set_id: setRow.id,
              match_id: matchDbId,
              game_number: game.game_number,
              game_score: game.game_score,
              points: game.points,
              is_current: false,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'set_id, game_number' }
          )
      }
    }

    // 4. Delete any remaining null-score sets (orphan cleanup)
    await supabase
      .from('sets')
      .delete()
      .eq('match_id', matchDbId)
      .is('set_score', null)
  }

  return `repaired match ${externalId} (winner=${detail.winner_pair}, sets=${detail.sets?.filter(s => s.set_score).length ?? 0})`
}

// ── Main reconciliation function ──────────────────────────────
// Call this at the end of every cron run
export async function reconcileIncompleteMatches(): Promise<{
  checked: number
  repaired: number
  skipped: number
  details: string[]
}> {
  // Find finished matches that look incomplete:
  // - winner_pair is null, OR
  // - all sets have no score (total null sets = total sets)
  const { data: incompleteMatches, error } = await supabase
    .from('matches')
    .select(`
      id,
      external_id,
      winner_pair,
      finished_at,
      sets (id, set_score)
    `)
    .eq('status', 'finished')
    .is('winner_pair', null)
    // Only check matches that finished in the last 7 days
    // (older ones are likely just missing from the API permanently)
    .gte('finished_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order('finished_at', { ascending: false })
    .limit(20) // Process max 20 per cron run to stay within rate limits

  if (error || !incompleteMatches) {
    console.error('[Reconciliation] Failed to fetch incomplete matches:', error)
    return { checked: 0, repaired: 0, skipped: 0, details: [] }
  }

  if (incompleteMatches.length === 0) {
    console.log('[Reconciliation] No incomplete matches found ✓')
    return { checked: 0, repaired: 0, skipped: 0, details: [] }
  }

  console.log(`[Reconciliation] Found ${incompleteMatches.length} incomplete match(es) to repair`)

  let repaired = 0
  let skipped = 0
  const details: string[] = []

  for (const match of incompleteMatches) {
    const result = await repairMatch(match.id, match.external_id)
    details.push(result)

    if (result.startsWith('skipped')) {
      skipped++
    } else {
      repaired++
    }
  }

  console.log(`[Reconciliation] Done. Repaired: ${repaired}, Skipped: ${skipped}`)

  return {
    checked: incompleteMatches.length,
    repaired,
    skipped,
    details,
  }
}
