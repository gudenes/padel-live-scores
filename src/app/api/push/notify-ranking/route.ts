// src/app/api/push/notify-ranking/route.ts
//
// Weekly ranking_updated bulletin. Internal — Bearer $CRON_SECRET.
// Called by padelgod's player-rankings worker after a NEW official week
// lands (same-week re-upserts are skipped on the worker side). Composes
// from latest official week vs previous official week — same function as
// admin Test — then fans out to everyone who opted into push:
//   authed web + FCM (ranking_updated.push opt-out default, skip muted)
//   anon web-push (no per-category pref; they opted in at the OS prompt)
// Dedupes authed on user_notifications.metadata.dedupe_key =
// ranking_updated:{year}-{week}. Anon collapse on-device via the week tag.

import { createServiceClient } from '@/lib/supabase'
import { paginatedSelect } from '@/lib/db-paginate'
import {
  resolvePrefs,
  type ChannelPrefs,
} from '@/lib/notification-categories'
import { sendPush } from '@/lib/push'
import { sendPushToFcmTokens } from '@/lib/push-fcm'
import { resolvePushLocale, type PushLocale } from '@/lib/push-copy'
import {
  loadLiveRankingBulletin,
  rankingPushFromBulletin,
} from '@/lib/ranking-moves-load'

const PAGE = 1000
const IN_CHUNK = 200
const SEND_CHUNK = 100

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function POST(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  let bulletin
  try {
    bulletin = await loadLiveRankingBulletin(supabase)
  } catch (err) {
    console.error('[notify-ranking] composer failed:', (err as Error).message)
    return Response.json({ ok: false, error: 'composer failed' }, { status: 500 })
  }
  if (!bulletin) {
    return Response.json({ ok: true, skipped: 'flat' })
  }

  const defaultPayload = rankingPushFromBulletin(bulletin, 'en')
  const tag = `ranking-${bulletin.year}-${String(bulletin.week).padStart(2, '0')}`
  const dedupeKey = defaultPayload.dedupeKey

  type AnonSub = { id: string; endpoint: string; p256dh_key: string; auth_key: string }
  const [webUserIds, nativeUserIds, anonSubs] = await Promise.all([
    paginatedSelect<{ user_id: string | null }>(
      (start, end) =>
        supabase.from('push_subscriptions').select('user_id').not('user_id', 'is', null).range(start, end),
      { what: 'push_subscriptions user_id', pageSize: PAGE },
    ),
    paginatedSelect<{ user_id: string | null }>(
      (start, end) =>
        supabase
          .from('native_push_subscriptions')
          .select('user_id')
          .not('user_id', 'is', null)
          .range(start, end),
      { what: 'native_push_subscriptions user_id', pageSize: PAGE },
    ),
    paginatedSelect<AnonSub>(
      (start, end) =>
        supabase
          .from('anon_push_subscriptions')
          .select('id, endpoint, p256dh_key, auth_key')
          .range(start, end),
      { what: 'anon_push_subscriptions', pageSize: PAGE },
    ),
  ])

  const userIds = [
    ...new Set(
      [...webUserIds, ...nativeUserIds]
        .map((r) => r.user_id)
        .filter((id): id is string => !!id),
    ),
  ]
  if (userIds.length === 0 && anonSubs.length === 0) {
    return Response.json({ ok: true, recipients: 0, inApp: 0, webSent: 0, fcmSent: 0, anonSent: 0 })
  }

  type ProfileRow = {
    id: string
    locale: string | null
    notification_prefs: Record<string, Partial<ChannelPrefs>> | null
    notification_mute_until: string | null
  }
  const profiles: ProfileRow[] = []
  for (const ids of chunk(userIds, IN_CHUNK)) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, locale, notification_prefs, notification_mute_until')
      .in('id', ids)
    if (error) {
      console.error('[notify-ranking] profiles read failed:', error.message)
      continue
    }
    profiles.push(...((data ?? []) as ProfileRow[]))
  }

  const already = new Set<string>()
  for (const ids of chunk(userIds, IN_CHUNK)) {
    const { data, error } = await supabase
      .from('user_notifications')
      .select('user_id')
      .eq('category', 'ranking_updated')
      .eq('metadata->>dedupe_key', dedupeKey)
      .in('user_id', ids)
    if (error) {
      console.error('[notify-ranking] dedup probe failed:', error.message)
      continue
    }
    for (const row of data ?? []) already.add(row.user_id as string)
  }

  const now = Date.now()
  const deliver: string[] = []
  const localeByUser = new Map<string, PushLocale>()
  const inAppRows: Array<{
    user_id: string
    category: 'ranking_updated'
    title: string
    body: string
    url: string
    metadata: Record<string, unknown>
  }> = []

  const payloadByLocale = new Map<PushLocale, ReturnType<typeof rankingPushFromBulletin>>()
  const payloadFor = (locale: string) => {
    const loc = resolvePushLocale(locale)
    const cached = payloadByLocale.get(loc)
    if (cached) return cached
    const built = rankingPushFromBulletin(bulletin, loc)
    payloadByLocale.set(loc, built)
    return built
  }

  for (const row of profiles) {
    if (already.has(row.id)) continue
    const pref = resolvePrefs(row.notification_prefs, 'ranking_updated')
    const muteUntil = row.notification_mute_until
    const muted =
      muteUntil === 'forever' ||
      (typeof muteUntil === 'string' && muteUntil !== 'forever' && Date.parse(muteUntil) > now)
    if (!pref.push || muted) continue

    const loc = resolvePushLocale(row.locale)
    localeByUser.set(row.id, loc)
    const c = payloadFor(loc)
    inAppRows.push({
      user_id: row.id,
      category: 'ranking_updated',
      title: c.title,
      body: c.body,
      url: c.url,
      metadata: {
        dedupe_key: dedupeKey,
        year: bulletin.year,
        week: bulletin.week,
        headline_player_id: bulletin.headline.playerId,
        headline_kind: bulletin.headlineKind,
      },
    })
    deliver.push(row.id)
  }

  let inApp = 0
  for (const rows of chunk(inAppRows, 500)) {
    const { error, count } = await supabase.from('user_notifications').insert(rows, { count: 'exact' })
    if (error) {
      console.error('[notify-ranking] in-app insert failed:', error.message)
    } else {
      inApp += count ?? rows.length
    }
  }

  let webSent = 0
  let webFired = 0
  let webStale = 0
  let fcmSent = 0
  let fcmFired = 0
  let fcmFailed = 0
  let fcmStale = 0

  if (deliver.length > 0) {
    const [subsRes, nativeRes] = await Promise.all([
      Promise.all(
        chunk(deliver, IN_CHUNK).map((ids) =>
          supabase.from('push_subscriptions').select('id, endpoint, keys, user_id').in('user_id', ids),
        ),
      ),
      Promise.all(
        chunk(deliver, IN_CHUNK).map((ids) =>
          supabase.from('native_push_subscriptions').select('device_token, user_id').in('user_id', ids),
        ),
      ),
    ])

    const subs = subsRes.flatMap((r) => {
      if (r.error) console.error('[notify-ranking] push_subscriptions read failed:', r.error.message)
      return r.data ?? []
    })
    const nativeRows = nativeRes.flatMap((r) => {
      if (r.error) console.error('[notify-ranking] native_push_subscriptions read failed:', r.error.message)
      return r.data ?? []
    }) as Array<{ device_token: string | null; user_id: string | null }>

    const staleIds: string[] = []
    webFired = subs.length
    if (subs.length > 0) {
      const results = await Promise.allSettled(
        subs.map((s) => {
          const c = payloadFor(localeByUser.get(s.user_id as string) ?? 'en')
          return sendPush(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { endpoint: s.endpoint as string, keys: s.keys as any },
            { title: c.title, body: c.body, url: c.url, tag, icon: c.icon },
          )
        }),
      )
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value === true) webSent++
        else if (r.status === 'fulfilled' && r.value === false) staleIds.push(subs[i].id as string)
      })
      webStale = staleIds.length
      if (staleIds.length > 0) {
        await supabase.from('push_subscriptions').delete().in('id', staleIds)
      }
    }

    const tokensByLocale = new Map<PushLocale, string[]>()
    for (const r of nativeRows) {
      if (!r.device_token || !r.user_id) continue
      const loc = localeByUser.get(r.user_id) ?? 'en'
      const list = tokensByLocale.get(loc) ?? []
      list.push(r.device_token)
      tokensByLocale.set(loc, list)
    }
    fcmFired = [...tokensByLocale.values()].reduce((n, t) => n + t.length, 0)
    try {
      for (const [loc, tokens] of tokensByLocale) {
        const c = payloadFor(loc)
        const res = await sendPushToFcmTokens(tokens, {
          title: c.title,
          body: c.body,
          url: c.url,
          tag,
          icon: c.icon,
        })
        fcmSent += res.success
        fcmFailed += res.failed
        fcmStale += res.invalidTokens.length
        if (res.invalidTokens.length > 0) {
          await supabase.from('native_push_subscriptions').delete().in('device_token', res.invalidTokens)
        }
      }
    } catch (err) {
      console.error('[notify-ranking] FCM send failed:', (err as Error).message)
    }
  }

  // Anon web-push: they opted into OS notifications, no per-category pref.
  // English bulletin (no locale on the device row). Collapse repeats via tag.
  let anonSent = 0
  let anonFired = anonSubs.length
  let anonStale = 0
  if (anonSubs.length > 0) {
    const anonPayload = payloadFor('en')
    const staleIds: string[] = []
    for (const batch of chunk(anonSubs, SEND_CHUNK)) {
      const results = await Promise.allSettled(
        batch.map((s) =>
          sendPush(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh_key, auth: s.auth_key } },
            {
              title: anonPayload.title,
              body: anonPayload.body,
              url: anonPayload.url,
              tag,
              icon: anonPayload.icon,
            },
          ),
        ),
      )
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value === true) anonSent++
        else if (r.status === 'fulfilled' && r.value === false) staleIds.push(batch[i].id)
      })
    }
    anonStale = staleIds.length
    if (staleIds.length > 0) {
      for (const ids of chunk(staleIds, IN_CHUNK)) {
        await supabase.from('anon_push_subscriptions').delete().in('id', ids)
      }
    }
    const surviving = anonSubs.filter((s) => !staleIds.includes(s.id)).map((s) => s.id)
    if (surviving.length > 0) {
      const seen = new Date().toISOString()
      for (const ids of chunk(surviving, IN_CHUNK)) {
        await supabase.from('anon_push_subscriptions').update({ last_seen_at: seen }).in('id', ids)
      }
    }
  }

  console.log(
    `[NotifyRanking] ${dedupeKey} kind=${bulletin.headlineKind} ` +
      `headline=${bulletin.headline.lastName} recipients=${deliver.length} ` +
      `inapp=${inApp} web=${webSent} fcm=${fcmSent} anon=${anonSent}`,
  )

  try {
    await supabase.from('notification_sends').insert({
      kind: 'category',
      title: defaultPayload.title,
      body: defaultPayload.body,
      url: defaultPayload.url,
      metadata: {
        category: 'ranking_updated',
        dedupe_key: dedupeKey,
        headline_kind: bulletin.headlineKind,
        headline_player_id: bulletin.headline.playerId,
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
    console.error('[notify-ranking] notification_sends insert failed:', (e as Error).message)
  }

  return Response.json({
    ok: true,
    year: bulletin.year,
    week: bulletin.week,
    headlineKind: bulletin.headlineKind,
    recipients: deliver.length + anonFired,
    inApp,
    webSent,
    fcmSent,
    anonSent,
  })
}
