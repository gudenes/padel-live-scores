// src/app/api/push/notify-event/route.ts
//
// Generic, entity-scoped notification fan-out. Internal — Bearer $CRON_SECRET.
// Called by padelgod's notifyEvent (Task 4) and the tournament-start worker
// (Task 5). Sibling to /api/push/notify, which stays match-specific; this
// route handles the broader premium catalog (player/tournament-scoped events).
//
// BODY:
//   { category, entityType: 'player'|'tournament', entityId,
//     title, body, url?, metadata?, icon?, dedupeKey? }
//
// PIPELINE (mirrors /api/push/notify):
//   1. Resolve followers of the entity (resolveEntityFollowers).
//   2. Batch-fetch profiles → prefs, mute, plan(isPro).
//   3. In-app dedup: skip users who already have a (category, dedupe_key) row.
//   4. Tier gate (shouldDeliverToRecipient): Pro categories are withheld
//      ENTIRELY (push + inbox) from non-Pro recipients. Free categories pass.
//   5. In-app insert (always, when not deduped + tier-allowed).
//   6. Push fan-out (web + FCM) gated by per-category push pref AND mute.
//
// Push payload shape matches /api/push/notify + public/sw.js exactly: the
// service worker reads TOP-LEVEL title/body/url/icon/tag off the JSON payload
// (event.data.json()). There is NO nested `data` wrapper — sendPush/FcmPayload
// take flat fields. Don't add fields the SW won't read.

import { createServiceClient } from '@/lib/supabase'
import { resolveEntityFollowers, type EntityType } from '@/lib/notify-recipients'
import {
  isKnownCategory,
  resolvePrefs,
  shouldDeliverToRecipient,
  type ChannelPrefs,
  type NotificationCategory,
} from '@/lib/notification-categories'
import { isPro, type Plan } from '@/lib/entitlements'
import { sendPush } from '@/lib/push'
import { sendPushToFcmTokens } from '@/lib/push-fcm'

type Body = {
  category?: unknown
  entityType?: unknown
  entityId?: unknown
  title?: unknown
  body?: unknown
  url?: unknown
  metadata?: unknown
  icon?: unknown
  dedupeKey?: unknown
}

const ENTITY_TYPES = new Set<EntityType>(['player', 'tournament'])

export async function POST(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const b = (await request.json().catch(() => null)) as Body | null
  if (!b) return Response.json({ error: 'Invalid JSON' }, { status: 400 })

  if (!isKnownCategory(b.category)) {
    return Response.json({ error: 'unknown category' }, { status: 400 })
  }
  const category = b.category
  if (typeof b.entityType !== 'string' || !ENTITY_TYPES.has(b.entityType as EntityType)) {
    return Response.json({ error: 'bad entityType' }, { status: 400 })
  }
  const entityType = b.entityType as EntityType
  if (typeof b.entityId !== 'string' || !b.entityId) {
    return Response.json({ error: 'bad entityId' }, { status: 400 })
  }
  const entityId = b.entityId
  if (typeof b.title !== 'string' || !b.title || typeof b.body !== 'string' || !b.body) {
    return Response.json({ error: 'title/body required' }, { status: 400 })
  }
  const title = b.title
  const body = b.body
  const url = typeof b.url === 'string' && b.url ? b.url : '/'
  const icon = typeof b.icon === 'string' && b.icon ? b.icon : undefined
  const metadata =
    b.metadata && typeof b.metadata === 'object' && !Array.isArray(b.metadata)
      ? (b.metadata as Record<string, unknown>)
      : {}
  const dedupeKey =
    typeof b.dedupeKey === 'string' && b.dedupeKey
      ? b.dedupeKey
      : `${category}:${entityType}:${entityId}`
  // Stable tag so repeat pushes for the same event collapse on-device.
  const tag = `${entityType}-${entityId}-${category}`

  const supabase = createServiceClient()

  // ── 1. Resolve followers ───────────────────────────────────
  const { userIds } = await resolveEntityFollowers(supabase, entityType, entityId)
  if (userIds.length === 0) {
    return Response.json({ ok: true, recipients: 0, inApp: 0, webSent: 0, fcmSent: 0 })
  }

  // ── 2. Batch-fetch prefs + plan in parallel with the dedup probe ──
  const [profilesRes, alreadyRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, notification_prefs, notification_mute_until, plan, plan_expires_at')
      .in('id', userIds),
    supabase
      .from('user_notifications')
      .select('user_id')
      .eq('category', category)
      .eq('metadata->>dedupe_key', dedupeKey)
      .in('user_id', userIds),
  ])

  // A read error here silently degrades delivery (profiles → everyone treated as
  // free; dedup probe → dedup disabled, possible re-send). Log loudly so a
  // degraded run is diagnosable instead of an invisible mis-delivery.
  if (profilesRes.error) console.error(`[notify-event] profiles read failed for ${category}:`, profilesRes.error.message)
  if (alreadyRes.error) console.error(`[notify-event] dedup probe failed for ${category}/${dedupeKey}:`, alreadyRes.error.message)

  const prefsByUser = new Map<string, Record<string, Partial<ChannelPrefs>>>()
  const muteByUser = new Map<string, string | null>()
  const proByUser = new Map<string, boolean>()
  for (const row of profilesRes.data ?? []) {
    const id = row.id as string
    prefsByUser.set(id, (row.notification_prefs ?? {}) as Record<string, Partial<ChannelPrefs>>)
    muteByUser.set(id, (row as { notification_mute_until?: string | null }).notification_mute_until ?? null)
    proByUser.set(
      id,
      isPro({
        plan: (row as { plan?: Plan }).plan ?? 'free',
        plan_expires_at: (row as { plan_expires_at?: string | null }).plan_expires_at ?? null,
      }),
    )
  }

  const alreadyById = new Set((alreadyRes.data ?? []).map((r) => r.user_id as string))

  // ── 3. Resolve per-user: in-app rows + push recipients ──────
  const inAppRows: Array<{
    user_id: string
    category: NotificationCategory
    title: string
    body: string
    url: string
    metadata: Record<string, unknown>
  }> = []
  const deliver: string[] = []
  const now = Date.now()

  for (const userId of userIds) {
    // Dedup: already sent this (category, dedupe_key) to this user.
    if (alreadyById.has(userId)) continue
    // Tier gate: Pro categories withheld entirely (push + inbox) from non-Pro.
    if (!shouldDeliverToRecipient(category, proByUser.get(userId) ?? false)) continue

    inAppRows.push({
      user_id: userId,
      category,
      title,
      body,
      url,
      metadata: {
        ...metadata,
        dedupe_key: dedupeKey,
        entity_type: entityType,
        entity_id: entityId,
      },
    })

    // Push fan-out is gated by the per-category push pref AND not-muted.
    const pref = resolvePrefs(prefsByUser.get(userId), category)
    const muteUntil = muteByUser.get(userId) ?? null
    const muted =
      muteUntil === 'forever' ||
      (typeof muteUntil === 'string' && muteUntil !== 'forever' && Date.parse(muteUntil) > now)
    if (pref.push && !muted) deliver.push(userId)
  }

  // ── 5. In-app insert (independent of push outcome) ──────────
  let inApp = 0
  if (inAppRows.length > 0) {
    const { error: insErr, count } = await supabase
      .from('user_notifications')
      .insert(inAppRows, { count: 'exact' })
    if (insErr) {
      console.error('[NotifyEvent] in-app insert failed:', insErr.message)
    } else {
      inApp = count ?? inAppRows.length
    }
  }

  // ── 6. Push fan-out — Web Push + FCM ────────────────────────
  let webSent = 0
  let fcmSent = 0

  if (deliver.length > 0) {
    const [subsRes, nativeRes] = await Promise.all([
      supabase.from('push_subscriptions').select('id, endpoint, keys').in('user_id', deliver),
      supabase.from('native_push_subscriptions').select('device_token').in('user_id', deliver),
    ])
    if (subsRes.error) console.error(`[notify-event] push_subscriptions read failed for ${category}:`, subsRes.error.message)
    if (nativeRes.error) console.error(`[notify-event] native_push_subscriptions read failed for ${category}:`, nativeRes.error.message)

    // Web Push.
    const subs = subsRes.data ?? []
    const staleIds: string[] = []
    if (subs.length > 0) {
      const results = await Promise.allSettled(
        subs.map((s) =>
          sendPush(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { endpoint: s.endpoint as string, keys: s.keys as any },
            { title, body, url, tag, ...(icon ? { icon } : {}) },
          ),
        ),
      )
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value === true) {
          webSent++
        } else if (r.status === 'fulfilled' && r.value === false) {
          // sendPush returns false on 410/404 → stale subscription.
          staleIds.push(subs[i].id as string)
        }
      })
      if (staleIds.length > 0) {
        await supabase.from('push_subscriptions').delete().in('id', staleIds)
        console.log(`[NotifyEvent] Cleaned ${staleIds.length} stale subscriptions`)
      }
    }

    // FCM (native devices). Same flat payload as Web Push.
    const tokens = (nativeRes.data ?? [])
      .map((r) => r.device_token as string)
      .filter(Boolean)
    if (tokens.length > 0) {
      try {
        const res = await sendPushToFcmTokens(tokens, {
          title,
          body,
          url,
          tag,
          ...(icon ? { icon } : {}),
        })
        fcmSent = res.success
        if (res.invalidTokens.length > 0) {
          await supabase
            .from('native_push_subscriptions')
            .delete()
            .in('device_token', res.invalidTokens)
          console.log(`[NotifyEvent] Cleaned ${res.invalidTokens.length} stale FCM tokens`)
        }
      } catch (err) {
        console.error('[NotifyEvent] FCM send failed:', (err as Error).message)
      }
    }
  }

  console.log(
    `[NotifyEvent] category=${category} ${entityType}=${entityId} ` +
      `recipients=${userIds.length} inapp=${inApp} web=${webSent} fcm=${fcmSent}`,
  )

  return Response.json({
    ok: true,
    recipients: userIds.length,
    inApp,
    webSent,
    fcmSent,
  })
}
