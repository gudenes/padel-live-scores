// apps/ops/src/lib/broadcast-queries.ts
import { createServiceClient } from './supabase'

export interface NotificationSendRow {
  id: string
  created_at: string
  kind: 'broadcast' | 'match'
  title: string
  label: string | null
  dry_run: boolean
  recipients_total: number
  accepted_total: number
  clicks: number
}

export async function listRecentSends(limit = 50): Promise<NotificationSendRow[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('notification_sends')
    .select('id, created_at, kind, title, label, dry_run, recipients_total, accepted_total, clicks')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`listRecentSends: ${error.message}`)
  return (data ?? []) as NotificationSendRow[]
}
