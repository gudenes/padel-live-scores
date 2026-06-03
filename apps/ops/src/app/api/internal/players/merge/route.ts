// apps/ops/src/app/api/internal/players/merge/route.ts
// Merge two duplicate players: keep one, reassign every FK that references the
// loser, then delete the loser — all inside ONE transaction.
//
// Why a transaction (and raw pg, not supabase-js): the old version fired a
// sequence of independent PostgREST updates and deleted last. If the final
// DELETE failed on a foreign-key it didn't know about (e.g.
// player_tournament_earnings), the matches/draws were ALREADY reassigned —
// leaving a half-merged player behind. BEGIN/COMMIT makes the whole merge
// atomic: any error rolls everything back.
//
// Auth: Auth.js session — requires isOperator flag on the session user.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { pgPool } from '@/lib/db'
import type { PoolClient } from 'pg'

// Columns the operator may carry over from the loser onto the survivor.
// Allowlisted so the dynamic UPDATE can never touch an unexpected column.
const MERGE_FIELDS = [
  'name', 'display_name', 'country', 'category', 'ranking', 'points', 'ranking_move',
  'external_id', 'fip_id', 'side', 'avatar_url', 'height', 'birthdate',
  'birthplace', 'hand', 'titles', 'finals', 'semifinals',
] as const

async function tableExists(client: PoolClient, table: string): Promise<boolean> {
  const r = await client.query('SELECT to_regclass($1) AS t', [`public.${table}`])
  return r.rows[0]?.t != null
}

// Plain pointer reassignment (no unique constraint to worry about).
async function reassign(client: PoolClient, table: string, col: string, keepId: string, deleteId: string): Promise<number> {
  if (!(await tableExists(client, table))) return 0
  const r = await client.query(`UPDATE ${table} SET ${col} = $1 WHERE ${col} = $2`, [keepId, deleteId])
  return r.rowCount ?? 0
}

// Reassign rows to the survivor, but skip any that would collide with a row the
// survivor already has on the given unique key. Optionally drop the skipped
// leftovers (required when the FK has no ON DELETE CASCADE).
async function reassignUnique(
  client: PoolClient,
  table: string,
  col: string,
  uniqueOtherCols: string[],
  keepId: string,
  deleteId: string,
  dropLeftovers: boolean,
): Promise<void> {
  if (!(await tableExists(client, table))) return
  const dupCond = uniqueOtherCols.map(c => `c.${c} = t.${c}`).join(' AND ')
  await client.query(
    `UPDATE ${table} AS t SET ${col} = $1
     WHERE t.${col} = $2
       AND NOT EXISTS (
         SELECT 1 FROM ${table} c WHERE c.${col} = $1 AND ${dupCond}
       )`,
    [keepId, deleteId],
  )
  if (dropLeftovers) {
    await client.query(`DELETE FROM ${table} WHERE ${col} = $1`, [deleteId])
  }
}

// -- POST: Merge two players ─────────────────────────────────────
export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { keepId, deleteId, mergedFields } = body as {
    keepId: string
    deleteId: string
    mergedFields?: Record<string, unknown>
  }

  if (!keepId || !deleteId) {
    return NextResponse.json({ error: 'Missing required fields: keepId, deleteId' }, { status: 400 })
  }
  if (keepId === deleteId) {
    return NextResponse.json({ error: 'keepId and deleteId must be different' }, { status: 400 })
  }

  const client = await pgPool().connect()
  try {
    await client.query('BEGIN')

    // Both players must exist (guards against a stale UI / double-submit).
    const present = await client.query('SELECT id FROM players WHERE id = ANY($1::uuid[])', [[keepId, deleteId]])
    if (present.rowCount !== 2) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'One or both players not found' }, { status: 404 })
    }

    // 1. Apply the operator's per-field picks onto the survivor (allowlisted).
    if (mergedFields && typeof mergedFields === 'object') {
      const cols = Object.keys(mergedFields).filter(k => (MERGE_FIELDS as readonly string[]).includes(k))
      if (cols.length > 0) {
        const setClause = cols.map((c, i) => `"${c}" = $${i + 2}`).join(', ')
        const values = cols.map(c => mergedFields[c])
        await client.query(`UPDATE players SET ${setClause} WHERE id = $1`, [keepId, ...values])
      }
    }

    // 2. Reassign match FKs across all 4 player columns. No unique constraint.
    let matchesUpdated = 0
    for (const col of ['pair1_player1_id', 'pair1_player2_id', 'pair2_player1_id', 'pair2_player2_id']) {
      matchesUpdated += await reassign(client, 'matches', col, keepId, deleteId)
    }

    // 3. Reassign tournament_draws (both player columns).
    let drawsUpdated = 0
    for (const col of ['player1_id', 'player2_id']) {
      drawsUpdated += await reassign(client, 'tournament_draws', col, keepId, deleteId)
    }

    // 4. Reassign the remaining plain pointers (nullable, no unique key).
    await reassign(client, 'games', 'server_player_id', keepId, deleteId)
    await reassign(client, 'match_points', 'server_player_id', keepId, deleteId)
    await reassign(client, 'racket_clicks', 'player_id', keepId, deleteId)
    await reassign(client, 'schema_payloads_unresolved', 'resolved_player_id', keepId, deleteId)

    // 5. Conflict-safe reassignments where a unique key could collide.
    //    earnings has NO cascade → leftovers MUST be dropped (the bug we're fixing).
    await reassignUnique(client, 'player_tournament_earnings', 'player_id', ['tournament_id', 'category'], keepId, deleteId, true)
    await reassignUnique(client, 'player_equipment', 'player_id', ['racket_id', 'started_at'], keepId, deleteId, true)
    //    ranking snapshots cascade on delete → keep non-conflicting history, let the rest cascade.
    await reassignUnique(client, 'player_ranking_snapshots', 'player_id', ['type', 'year', 'week'], keepId, deleteId, false)

    // 6. entity_external_ids is polymorphic (no FK), unique on (entity_type, entity_id, source).
    //    Move the loser's source IDs / aliases to the survivor so lookups keep resolving;
    //    drop any the survivor already owns.
    if (await tableExists(client, 'entity_external_ids')) {
      await client.query(
        `UPDATE entity_external_ids AS x SET entity_id = $1
         WHERE x.entity_type = 'player' AND x.entity_id = $2
           AND NOT EXISTS (
             SELECT 1 FROM entity_external_ids c
             WHERE c.entity_type = 'player' AND c.entity_id = $1 AND c.source = x.source
           )`,
        [keepId, deleteId],
      )
      await client.query(`DELETE FROM entity_external_ids WHERE entity_type = 'player' AND entity_id = $1`, [deleteId])
    }

    // 7. Derived analytics (Monte-Carlo tournament odds) — pair-keyed, regenerated
    //    hourly by the model worker. Reassigning could corrupt a pair, so just drop
    //    the loser's rows; they rebuild on the next snapshot.
    if (await tableExists(client, 'model_tournament_predictions')) {
      await client.query(
        `DELETE FROM model_tournament_predictions WHERE pair_player1_id = $1 OR pair_player2_id = $1`,
        [deleteId],
      )
    }

    // 8. Remove the duplicate. Remaining ON DELETE CASCADE FKs (ranking-snapshot
    //    leftovers, player-dedup/content-tag tables) clean themselves up.
    await client.query('DELETE FROM players WHERE id = $1', [deleteId])

    await client.query('COMMIT')
    return NextResponse.json({ matchesUpdated, drawsUpdated, deleted: true })
  } catch (e: unknown) {
    await client.query('ROLLBACK').catch(() => {})
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `Merge failed (rolled back): ${message}` }, { status: 500 })
  } finally {
    client.release()
  }
}
