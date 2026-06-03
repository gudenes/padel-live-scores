// src/app/api/admin/broadcast-push/route.ts
// Operator broadcast: send ONE push to the entire installed base (logged-in
// web + Android + anonymous web). CRON_SECRET-protected. Records a
// notification_sends row (dry runs included, for auditability).

import { createClient } from '@supabase/supabase-js'
import { paginatedSelect } from '@/lib/db-paginate'
import { sendPush } from '@/lib/push'
import { sendPushToFcmTokens } from '@/lib/push-fcm'
import { runBroadcast, resultToCountsRow, type BroadcastDeps, type WebSub } from '@/lib/broadcast-push'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const DEFAULT_ICON = 'https://padelnachos.com/padelnachos-logo-v2.png'

export async function POST(request: Request) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const raw = await request.json().catch(() => ({}))
  const { title, body, url, label, dryRun } = raw as {
    title?: string; body?: string; url?: string; label?: string; dryRun?: boolean
  }
  if (!title || !body) {
    return Response.json({ error: 'title and body are required' }, { status: 400 })
  }

  // 1) Insert a pending row to obtain send_id (carried in the payload).
  const { data: row, error: insErr } = await supabase
    .from('notification_sends')
    .insert({ kind: 'broadcast', title, body, url: url ?? '/', label: label ?? null, dry_run: !!dryRun })
    .select('id')
    .single()
  if (insErr || !row) {
    return Response.json({ error: 'insert_failed', message: insErr?.message }, { status: 500 })
  }
  const sendId = row.id as string

  // 2) Build Supabase-backed deps.
  const deps: BroadcastDeps = {
    fetchWebSubs: () =>
      paginatedSelect<{ id: string; endpoint: string; keys: { p256dh: string; auth: string } }>(
        (s, e) => supabase.from('push_subscriptions').select('id, endpoint, keys').range(s, e),
        { what: 'push_subscriptions (broadcast)' },
      ),
    fetchFcmTokens: async () => {
      const rows = await paginatedSelect<{ device_token: string }>(
        (s, e) => supabase.from('native_push_subscriptions').select('device_token').range(s, e),
        { what: 'native_push_subscriptions (broadcast)' },
      )
      return rows.map((r) => r.device_token)
    },
    fetchAnonSubs: async () => {
      const rows = await paginatedSelect<{ id: string; endpoint: string; p256dh_key: string; auth_key: string }>(
        (s, e) => supabase.from('anon_push_subscriptions').select('id, endpoint, p256dh_key, auth_key').range(s, e),
        { what: 'anon_push_subscriptions (broadcast)' },
      )
      return rows.map<WebSub>((r) => ({
        id: r.id,
        endpoint: r.endpoint,
        keys: { p256dh: r.p256dh_key, auth: r.auth_key },
      }))
    },
    sendWeb: (sub, payload) => sendPush(sub, payload),
    sendFcm: (tokens, payload) =>
      sendPushToFcmTokens(tokens, { title: payload.title, body: payload.body, url: payload.url, tag: payload.tag, icon: payload.icon, sendId: payload.sendId }),
    cleanupWebStale: async (ids) => {
      await supabase.from('push_subscriptions').delete().in('id', ids)
    },
    cleanupFcmStale: async (tokens) => {
      await supabase.from('native_push_subscriptions').delete().in('device_token', tokens)
    },
    cleanupAnonStale: async (ids) => {
      await supabase.from('anon_push_subscriptions').delete().in('id', ids)
    },
  }

  // 3) Run + record final counts. (label is already stored on the row above;
  //    it is intentionally NOT passed to runBroadcast.)
  const result = await runBroadcast(
    { title, body, url, icon: DEFAULT_ICON, sendId, dryRun: !!dryRun },
    deps,
  )
  await supabase.from('notification_sends').update(resultToCountsRow(result)).eq('id', sendId)

  console.log(
    `[Broadcast] send=${sendId} dry=${result.dry_run} recipients=${result.recipients_total} accepted=${result.accepted_total}`,
  )

  return Response.json({ ok: true, send_id: sendId, ...result })
}
