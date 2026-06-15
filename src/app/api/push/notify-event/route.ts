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
  entityIds?: unknown
  title?: unknown
  body?: unknown
  url?: unknown
  metadata?: unknown
  icon?: unknown
  dedupeKey?: unknown
  dryRun?: unknown
}

const ENTITY_TYPES = new Set<EntityType>(['player', 'tournament', 'match'])

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
  // Optional batch of entity IDs. When present (and entityType is 'player'),
  // followers are resolved as the UNION across all of them in ONE request, and
  // the per-user fan-out below naturally collapses to a single notification
  // per user — even a fan who follows several of the IDs. This is how
  // `player_entered` coalesces every newly-entered player in a tournament into
  // one "New tournament entry" push per user. `entityId` is still required
  // (drives the on-device tag, metadata, and stats key).
  const entityIds =
    Array.isArray(b.entityIds)
      ? Array.from(new Set(b.entityIds.filter((x): x is string => typeof x === 'string' && !!x)))
      : null
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
  // dryRun: resolve reach (followers post dedup + tier-gate + pref + mute) and
  // return it WITHOUT any writes or sends. Powers the console's reach count.
  const dryRun = b.dryRun === true

  const supabase = createServiceClient()

  // ── 1. Resolve followers ───────────────────────────────────
  // anonSubs are anonymous web-push subscriptions (no account). They get NO
  // tier gate, NO in-app row, and NO per-category pref — they're free by
  // definition. Resolved here so an anon-only entity (zero authed followers)
  // still fans out below. Tournament events resolve anonSubs: [].
  const { userIds, anonSubs } = await resolveEntityFollowers(
    supabase,
    entityType,
    entityIds && entityIds.length > 0 ? entityIds : entityId,
  )
  if (userIds.length === 0 && anonSubs.length === 0) {
    return Response.json({ ok: true, recipients: 0, inApp: 0, webSent: 0, fcmSent: 0, anonSent: 0 })
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

  // dryRun: report reach (post dedup + tier-gate + pref + mute) without any
  // writes or sends. anonWould = anonSubs.length (anon always receives).
  if (dryRun) {
    return Response.json({
      ok: true,
      dryRun: true,
      recipients: deliver.length,
      inAppWould: inAppRows.length,
      anonWould: anonSubs.length,
    })
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
  // Channel attempt/stale accumulators lifted to function scope so the
  // analytics insert below can read them (the values are computed inside the
  // block-scoped fan-out below). fired = attempts, accepted ≤ fired.
  let webFired = 0, webStale = 0
  let fcmFired = 0, fcmFailed = 0, fcmStale = 0
  let anonFired = 0, anonStale = 0

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
    webFired = subs.length
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
      webStale = staleIds.length
      if (staleIds.length > 0) {
        await supabase.from('push_subscriptions').delete().in('id', staleIds)
        console.log(`[NotifyEvent] Cleaned ${staleIds.length} stale subscriptions`)
      }
    }

    // FCM (native devices). Same flat payload as Web Push.
    const tokens = (nativeRes.data ?? [])
      .map((r) => r.device_token as string)
      .filter(Boolean)
    fcmFired = tokens.length
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
        fcmFailed = res.failed
        fcmStale = res.invalidTokens.length
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

  // ── 7. Anon web-push fan-out ────────────────────────────────
  // Anon recipients are free by definition: no tier gate, no in-app row, no
  // per-category pref. Mirrors /api/push/notify:660-723 (send → stale cleanup
  // → last_seen_at bump). Tournament events resolve anonSubs: [] → no-op.
  let anonSent = 0
  anonFired = anonSubs.length
  if (anonSubs.length > 0) {
    const anonStaleIds: string[] = []
    const anonResults = await Promise.allSettled(
      anonSubs.map((s) =>
        sendPush(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh_key, auth: s.auth_key } },
          { title, body, url, tag, ...(icon ? { icon } : {}) },
        ),
      ),
    )
    anonSubs.forEach((s, i) => {
      const r = anonResults[i]
      if (r.status === 'fulfilled' && r.value === true) {
        anonSent++
      } else if (r.status === 'fulfilled' && r.value === false) {
        // sendPush returns false on 410/404 → stale subscription.
        anonStaleIds.push(s.id)
      }
    })

    anonStale = anonStaleIds.length
    if (anonStaleIds.length > 0) {
      await supabase.from('anon_push_subscriptions').delete().in('id', anonStaleIds)
      console.log(`[NotifyEvent] Cleaned ${anonStaleIds.length} stale anon subscriptions`)
    }

    // Bump last_seen_at for surviving anon subs that received a push — used by
    // the 90-day cleanup cron.
    const survivingAnonIds = anonSubs
      .filter((s) => !anonStaleIds.includes(s.id))
      .map((s) => s.id)
    if (survivingAnonIds.length > 0) {
      await supabase
        .from('anon_push_subscriptions')
        .update({ last_seen_at: new Date().toISOString() })
        .in('id', survivingAnonIds)
    }
  }

  console.log(
    `[NotifyEvent] category=${category} ${entityType}=${entityId} ` +
      `recipients=${userIds.length} inapp=${inApp} web=${webSent} fcm=${fcmSent} ` +
      `anon=${anonSubs.length} anon_sent=${anonSent}`,
  )

  // Persist a notification_sends analytics row (kind='category'). Additive —
  // purely observability; failure must never break delivery. Only on the real
  // path (dryRun returns above; zero-recipient returns at the top).
  try {
    await supabase.from('notification_sends').insert({
      kind: 'category',
      title,
      body,
      url,
      metadata: {
        category,
        entity_type: entityType,
        entity_id: entityId,
        dedupe_key: dedupeKey,
        inapp_written: inApp,
      },
      web_fired: webFired,
      web_accepted: webSent,
      web_stale: webStale,
      fcm_fired: fcmFired,
      fcm_accepted: fcmSent,
      fcm_failed: fcmFailed,
      fcm_stale: fcmStale,
      anon_fired: anonFired,
      anon_accepted: anonSent,
      anon_stale: anonStale,
      recipients_total: webFired + fcmFired + anonFired,
      accepted_total: webSent + fcmSent + anonSent,
    })
  } catch (e) {
    console.error('[notify-event] notification_sends insert failed:', (e as Error).message)
  }

  return Response.json({
    ok: true,
    recipients: userIds.length,
    inApp,
    webSent,
    fcmSent,
    anonSent,
  })
}
