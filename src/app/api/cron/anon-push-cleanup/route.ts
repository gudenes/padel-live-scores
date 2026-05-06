// /api/cron/anon-push-cleanup
//
// Weekly cron — deletes anon_push_subscriptions rows whose
// last_seen_at is older than 90 days. The cascade trigger in the
// migration drops the device's anon_bookmarks rows automatically.
//
// Vercel cron schedule registered in vercel.json.

import { createClient } from '@supabase/supabase-js'
import { padelapiPausedResponse } from '@/lib/padelapi-pause'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

export async function GET(req: Request) {
  // Cron-secret auth (matches the convention used by other Vercel crons).
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Honor the global padelapi pause flag — not because we touch padelapi
  // (we don't) but because the same flag often indicates a wider incident
  // window where housekeeping should pause too.
  const pause = padelapiPausedResponse('anon-push-cleanup')
  if (pause) return pause

  const cutoff = new Date(Date.now() - NINETY_DAYS_MS).toISOString()

  const { data, error } = await supabase
    .from('anon_push_subscriptions')
    .delete()
    .lt('last_seen_at', cutoff)
    .select('id')

  if (error) {
    console.error('[anon-push-cleanup] delete failed', error)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }

  return Response.json({
    ok: true,
    deleted: data?.length ?? 0,
    cutoff,
  })
}
