// src/app/api/user/account/route.ts
// DELETE — permanently removes the authenticated user.
// Runs buildDeletePlan() inside a single BEGIN/COMMIT transaction via pg.
// Auth is validated BEFORE any DB access via getUserOrFail().

import { getUserOrFail } from '../_auth'
import { buildDeletePlan } from '@/lib/delete-plan'
import { createPool } from '@/lib/pg'

export async function DELETE() {
  const { user, error } = await getUserOrFail()
  if (error) return error

  const pool = createPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const stmt of buildDeletePlan(user.id)) {
      await client.query(stmt.sql, stmt.params)
    }
    await client.query('COMMIT')
  } catch (e) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // ignore rollback failure — original error is more interesting
    }
    const message = e instanceof Error ? e.message : 'account delete failed'
    return Response.json({ error: message }, { status: 500 })
  } finally {
    client.release()
    await pool.end().catch(() => {})
  }

  return new Response(null, { status: 204 })
}
