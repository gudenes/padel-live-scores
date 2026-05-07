// apps/labs/src/lib/usage.ts
// Per-user daily rate limit for the chat endpoint. Phase 2 = free tier only,
// hardcoded at 10/day. Phase 4 introduces Pro tier 100/day + Stripe gating.

import { supabaseService } from './db'

export const FREE_DAILY_QUOTA = 10

export async function checkAndRecordUsage(args: { userId: string }): Promise<{
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

  const { error: insErr } = await supabase
    .from('labs_usage_events')
    .insert({ user_id: args.userId, kind: 'chat', cost_units: 1 })
  if (insErr) throw new Error(`usage insert: ${insErr.message}`)

  return { allowed: true, used: used + 1, quota: FREE_DAILY_QUOTA }
}

function startOfUtcDay(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  return x.toISOString()
}
