// src/app/api/internal/notification-catalog/route.ts
// GET → { categories: CatalogRow[] }. Internal (Bearer $CRON_SECRET).
import { createServiceClient } from '@/lib/supabase'
import { buildCatalog, type SendAgg } from '@/lib/notification-catalog'

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createServiceClient()
  const sinceIso = new Date(Date.now() - 7 * 24 * 3600_000).toISOString()
  const { data, error } = await supabase
    .from('notification_sends')
    .select('created_at, metadata, recipients_total, fcm_failed')
    .eq('kind', 'category')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(5000)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const aggByCat = new Map<string, SendAgg>()
  for (const row of data ?? []) {
    const cat = (row.metadata as { category?: string } | null)?.category
    if (!cat) continue
    const a = aggByCat.get(cat) ?? { category: cat, lastFiredAt: null, count7d: 0, recipients7d: 0, failed7d: 0 }
    a.count7d += 1
    a.recipients7d += (row.recipients_total as number) ?? 0
    a.failed7d += (row.fcm_failed as number) ?? 0
    const ts = row.created_at as string
    if (!a.lastFiredAt || ts > a.lastFiredAt) a.lastFiredAt = ts
    aggByCat.set(cat, a)
  }
  const categories = buildCatalog([...aggByCat.values()], Date.now())
  return Response.json({ categories })
}
