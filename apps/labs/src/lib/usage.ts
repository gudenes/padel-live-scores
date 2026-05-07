// apps/labs/src/lib/usage.ts
// Per-user daily rate limit for the chat endpoint. Phase 2 = free tier only,
// hardcoded at 10/day. Phase 4 introduces Pro tier 100/day + Stripe gating.
//
// Two-phase pattern:
//   1. checkUsage()  — gate check only, NO insert. Call before running the LLM.
//   2. recordUsage() — inserts the event. Call only on success.
// This ensures a quota slot is never consumed when the LLM call fails.

import { supabaseService } from './db'

export const FREE_DAILY_QUOTA = 10

export async function checkUsage(args: { userId: string }): Promise<{
  allowed: boolean
  used: number
  quota: number
}> {
  const supabase = supabaseService()
  const startOfDayUtc = startOfUtcDay(new Date())

  const { count, error: countErr } = await supabase
    .from('labs_usage_events')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', args.userId)
    .eq('kind', 'chat')
    .gte('at', startOfDayUtc)

  if (countErr) throw new Error(`usage count: ${countErr.message}`)
  const used = count ?? 0

  if (used >= FREE_DAILY_QUOTA) {
    return { allowed: false, used, quota: FREE_DAILY_QUOTA }
  }

  return { allowed: true, used, quota: FREE_DAILY_QUOTA }
}

export async function recordUsage(args: { userId: string }): Promise<void> {
  const supabase = supabaseService()
  const startOfDayUtc = startOfUtcDay(new Date())

  const { data: inserted, error: insErr } = await supabase
    .from('labs_usage_events')
    .insert({ user_id: args.userId, kind: 'chat', cost_units: 1 })
    .select('id')
    .single()
  if (insErr) throw new Error(`usage insert: ${insErr.message}`)

  // Post-insert race guard: two concurrent requests could both pass checkUsage
  // at count=9, both insert, and push the day's count to 11. After inserting,
  // re-count; if we're over quota, delete the just-inserted row and return
  // silently. The caller already has its answer — this just prevents the count
  // from drifting. Future checkUsage calls will correctly deny.
  const { count, error: countErr } = await supabase
    .from('labs_usage_events')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', args.userId)
    .eq('kind', 'chat')
    .gte('at', startOfDayUtc)

  if (countErr) return // best-effort; don't fail the request over telemetry

  if ((count ?? 0) > FREE_DAILY_QUOTA) {
    // Roll back the over-counted insert silently.
    await supabase.from('labs_usage_events').delete().eq('id', inserted.id)
  }
}

function startOfUtcDay(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  return x.toISOString()
}
