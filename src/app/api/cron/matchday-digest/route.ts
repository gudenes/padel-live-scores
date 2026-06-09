// src/app/api/cron/matchday-digest/route.ts
//
// Morning "your players today" matchday digest. USER-CENTRIC batch sender —
// the sibling /api/push/notify* routes are ENTITY-centric (one event → its
// followers) and can't compose a per-user, per-tournament digest, so this is a
// purpose-built sender.
//
// Runs hourly. For each tournament whose LOCAL time has just crossed into the
// morning (08:00), it composes one digest per recipient listing the matches
// (today, that tournament) involving players they follow or matches they
// bookmarked, and pushes it once (idempotent via claimNotificationEvent).
//
// SHIP-DARK: gated behind ENABLE_MATCHDAY_DIGEST !== 'true' (default off). The
// daily_oop category is currently comingSoon in the settings UI, so no one is
// promised this alert until both flip together.
//
// Transport (web push + FCM + anon) mirrors /api/push/notify-event exactly:
// flat PushPayload/FcmPayload (title/body/url/tag), false → stale (delete by
// id), res.invalidTokens → delete by device_token, anon last_seen_at bump.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { logOpsEvent } from '@/lib/ops-logger'
import { paginatedSelect } from '@/lib/db-paginate'
import {
  getTournamentTimezone,
  localHourIn,
  zonedDayBoundsUtc,
} from '@/lib/tournament-day-window'
import {
  isApproximateLabel,
  formatDigestBody,
  groupRecipients,
  type DigestMatch,
  type DigestItem,
} from '@/lib/matchday-digest'
import { claimNotificationEvent } from '@/lib/notification-events'
import { resolvePrefs, shouldDeliverToRecipient } from '@/lib/notification-categories'
import { isPro, type Plan } from '@/lib/entitlements'
import { sendPush } from '@/lib/push'
import { sendPushToFcmTokens } from '@/lib/push-fcm'

export const maxDuration = 120

const CATEGORY = 'daily_oop' as const
// Local hour (tournament tz) at/after which the morning digest may fire.
const MORNING_HOUR = 8

type CandidateMatch = {
  id: string
  scheduled_at: string
  schedule_label: string | null
  tournament_id: string
  pair1_player1_id: string | null
  pair1_player2_id: string | null
  pair2_player1_id: string | null
  pair2_player2_id: string | null
}

// Short form of a player name — last whitespace-delimited token — to keep
// digest lines compact ("Tapia 09:00 · Galán 11:30*").
function shortName(name: string | null | undefined): string {
  if (!name) return ''
  const parts = name.trim().split(/\s+/)
  return parts[parts.length - 1] || name
}

export async function GET(req: NextRequest) {
  // Auth: same Bearer pattern other Vercel crons use.
  const authHeader = req.headers.get('authorization')
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Ship-dark gate — default off until the daily_oop sender is launched.
  if (process.env.ENABLE_MATCHDAY_DIGEST !== 'true') {
    return NextResponse.json({ disabled: true })
  }

  try {
    const meta = await logOpsEvent('cron:matchday-digest', async () => {
      const supabase = createServiceClient()
      const now = new Date()

      // ── 1. Candidate matches: a wide UTC window that covers "today" in any
      //    timezone (UTC-12 .. UTC+14). Per-tournament tz math narrows it. ──
      const fromIso = new Date(now.getTime() - 18 * 3600_000).toISOString()
      const toIso = new Date(now.getTime() + 30 * 3600_000).toISOString()

      const candidates = await paginatedSelect<CandidateMatch>(
        (start, end) =>
          supabase
            .from('matches')
            .select(
              'id, scheduled_at, schedule_label, tournament_id, ' +
                'pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id',
            )
            .gte('scheduled_at', fromIso)
            .lt('scheduled_at', toIso)
            .range(start, end),
        { what: 'matchday-digest candidate matches' },
      )

      // ── 2. Group candidates by tournament. ──
      const byTournament = new Map<string, CandidateMatch[]>()
      for (const m of candidates) {
        if (!m.tournament_id || !m.scheduled_at) continue
        const arr = byTournament.get(m.tournament_id) ?? []
        arr.push(m)
        byTournament.set(m.tournament_id, arr)
      }

      let tournamentsConsidered = 0
      let tournamentsSent = 0
      let skippedNoTz = 0
      let recipients = 0
      let sent = 0

      for (const [tid, tMatches] of byTournament) {
        tournamentsConsidered++

        // 3a. Resolve the tournament's timezone.
        const tz = await getTournamentTimezone(supabase, tid)
        if (!tz) {
          console.warn(`[matchday-digest] no timezone for tournament ${tid} — skipping`)
          skippedNoTz++
          continue
        }

        // 3b. Only fire once the tournament's local clock has reached morning.
        if (localHourIn(tz, now) < MORNING_HOUR) continue

        // 3c. Filter this tournament's candidates to its LOCAL "today".
        const { localDate, startUtc, endUtc } = zonedDayBoundsUtc(tz, now)
        const todayMatches = tMatches
          .filter((m) => m.scheduled_at >= startUtc && m.scheduled_at < endUtc)
          .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
        if (todayMatches.length === 0) continue

        // 3d. Resolve tournament name + player display names.
        const matchIds = todayMatches.map((m) => m.id)
        const allPlayerIds = Array.from(
          new Set(
            todayMatches.flatMap((m) => [
              m.pair1_player1_id,
              m.pair1_player2_id,
              m.pair2_player1_id,
              m.pair2_player2_id,
            ]),
          ),
        ).filter((id): id is string => !!id)

        const [tRes, pRes] = await Promise.all([
          supabase.from('tournaments').select('name').eq('id', tid).maybeSingle(),
          allPlayerIds.length > 0
            ? supabase.from('players').select('id, name').in('id', allPlayerIds)
            : Promise.resolve({ data: [] as { id: string; name: string | null }[], error: null }),
        ])
        const tournamentName = (tRes.data?.name as string | null) ?? 'Tournament'
        const playerName = new Map<string, string>()
        for (const p of (pRes.data ?? []) as { id: string; name: string | null }[]) {
          playerName.set(p.id, shortName(p.name))
        }

        // ── 4. Resolve recipients (authed + anon) for today's matches. ──
        const [
          playerFollowsRes,
          matchBookmarksRes,
          anonPlayerBmRes,
          anonMatchBmRes,
        ] = await Promise.all([
          allPlayerIds.length > 0
            ? supabase
                .from('user_bookmarks')
                .select('user_id, target_id')
                .eq('bookmark_type', 'player')
                .in('target_id', allPlayerIds)
            : Promise.resolve({ data: [] as { user_id: string; target_id: string }[], error: null }),
          supabase
            .from('user_bookmarks')
            .select('user_id, target_id')
            .eq('bookmark_type', 'match')
            .in('target_id', matchIds),
          allPlayerIds.length > 0
            ? supabase
                .from('anon_bookmarks')
                .select('device_id, target_id')
                .eq('bookmark_type', 'player')
                .in('target_id', allPlayerIds)
            : Promise.resolve({ data: [] as { device_id: string; target_id: string }[], error: null }),
          supabase
            .from('anon_bookmarks')
            .select('device_id, target_id')
            .eq('bookmark_type', 'match')
            .in('target_id', matchIds),
        ])

        const digestMatches: DigestMatch[] = todayMatches.map((m) => ({
          matchId: m.id,
          players: [
            m.pair1_player1_id,
            m.pair1_player2_id,
            m.pair2_player1_id,
            m.pair2_player2_id,
          ],
        }))

        const playerFollows = (playerFollowsRes.data ?? []) as { user_id: string; target_id: string }[]
        const matchBookmarks = (matchBookmarksRes.data ?? []) as { user_id: string; target_id: string }[]
        const byUser = groupRecipients(digestMatches, playerFollows, matchBookmarks)

        // Anon: reuse groupRecipients by treating device_id as the "user_id".
        const anonPlayerFollows = ((anonPlayerBmRes.data ?? []) as { device_id: string; target_id: string }[])
          .map((r) => ({ user_id: r.device_id, target_id: r.target_id }))
        const anonMatchBookmarks = ((anonMatchBmRes.data ?? []) as { device_id: string; target_id: string }[])
          .map((r) => ({ user_id: r.device_id, target_id: r.target_id }))
        const byDevice = groupRecipients(digestMatches, anonPlayerFollows, anonMatchBookmarks)

        if (byUser.size === 0 && byDevice.size === 0) continue

        // Per-match lookups for composing digest lines.
        const matchById = new Map(todayMatches.map((m) => [m.id, m]))
        const timeFmt = new Intl.DateTimeFormat('en-GB', {
          timeZone: tz,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })

        // Build the DigestItem[] (sorted by scheduled_at) for a recipient's
        // mapped matchIds. `label` is a player from the match (short form).
        const buildItems = (mids: string[]): DigestItem[] => {
          const items = mids
            .map((mid) => matchById.get(mid))
            .filter((m): m is CandidateMatch => !!m)
            .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
            .map((m) => {
              const pid =
                [m.pair1_player1_id, m.pair1_player2_id, m.pair2_player1_id, m.pair2_player2_id].find(
                  (id) => id && playerName.get(id),
                ) ?? null
              const label = (pid && playerName.get(pid)) || 'Match'
              return {
                label,
                time: timeFmt.format(new Date(m.scheduled_at)),
                approximate: isApproximateLabel(m.schedule_label),
              }
            })
          return items
        }

        const title = `${tournamentName} — your players today`
        const tag = `matchday-${tid}`

        // ── 5. Authed prefs — batch fetch profiles. ──
        const authedUserIds = [...byUser.keys()]
        const prefsByUser = new Map<string, Record<string, { push?: boolean }>>()
        const muteByUser = new Map<string, string | null>()
        const proByUser = new Map<string, boolean>()
        if (authedUserIds.length > 0) {
          const { data: profiles, error: profErr } = await supabase
            .from('profiles')
            .select('id, notification_prefs, notification_mute_until, plan, plan_expires_at')
            .in('id', authedUserIds)
          if (profErr) {
            console.error(`[matchday-digest] profiles read failed for ${tid}:`, profErr.message)
          }
          for (const row of profiles ?? []) {
            const id = row.id as string
            prefsByUser.set(id, (row.notification_prefs ?? {}) as Record<string, { push?: boolean }>)
            muteByUser.set(id, (row as { notification_mute_until?: string | null }).notification_mute_until ?? null)
            proByUser.set(
              id,
              isPro({
                plan: (row as { plan?: Plan }).plan ?? 'free',
                plan_expires_at: (row as { plan_expires_at?: string | null }).plan_expires_at ?? null,
              }),
            )
          }
        }

        const nowMs = now.getTime()

        // Per-tournament telemetry accumulators (mirror notify-event shape).
        let webFired = 0, webSent = 0, webStale = 0
        let fcmFired = 0, fcmSent = 0, fcmFailed = 0, fcmStale = 0
        let anonFired = 0, anonSent = 0, anonStale = 0
        let recipientsThisTournament = 0

        // ── 6. Compose + send per AUTHED recipient. ──
        for (const [userId, mids] of byUser) {
          // 6a. Pref + mute gate FIRST (claim AFTER, so a muted user can still
          //     receive tomorrow — claiming a muted user today would burn the
          //     day's idempotency key and silently skip the next morning).
          const pref = resolvePrefs(prefsByUser.get(userId), CATEGORY)
          const muteUntil = muteByUser.get(userId) ?? null
          const muted =
            muteUntil === 'forever' ||
            (typeof muteUntil === 'string' && muteUntil !== 'forever' && Date.parse(muteUntil) > nowMs)
          if (!pref.push || muted) continue
          // Tier gate — free category, always true; future-proof if it flips.
          if (!shouldDeliverToRecipient(CATEGORY, proByUser.get(userId) ?? false)) continue

          // 6b. Idempotency claim — one digest per (recipient, tournament, day).
          const claimed = await claimNotificationEvent(
            supabase,
            `${CATEGORY}:${tid}:${localDate}:${userId}`,
            CATEGORY,
          )
          if (!claimed) continue

          // 6c. Compose.
          const items = buildItems(mids)
          if (items.length === 0) continue
          const body = formatDigestBody(items)

          recipientsThisTournament++

          // 6d. Send — fetch this user's web + native subs, fan out.
          const [subsRes, nativeRes] = await Promise.all([
            supabase.from('push_subscriptions').select('id, endpoint, keys').eq('user_id', userId),
            supabase.from('native_push_subscriptions').select('device_token').eq('user_id', userId),
          ])

          // Web Push.
          const subs = subsRes.data ?? []
          webFired += subs.length
          if (subs.length > 0) {
            const staleIds: string[] = []
            const results = await Promise.allSettled(
              subs.map((s) =>
                sendPush(
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  { endpoint: s.endpoint as string, keys: s.keys as any },
                  { title, body, url: '/matches', tag },
                ),
              ),
            )
            results.forEach((r, i) => {
              if (r.status === 'fulfilled' && r.value === true) webSent++
              else if (r.status === 'fulfilled' && r.value === false) staleIds.push(subs[i].id as string)
            })
            webStale += staleIds.length
            if (staleIds.length > 0) {
              await supabase.from('push_subscriptions').delete().in('id', staleIds)
            }
          }

          // FCM (native devices).
          const tokens = (nativeRes.data ?? [])
            .map((r) => r.device_token as string)
            .filter(Boolean)
          fcmFired += tokens.length
          if (tokens.length > 0) {
            try {
              const res = await sendPushToFcmTokens(tokens, { title, body, url: '/matches', tag })
              fcmSent += res.success
              fcmFailed += res.failed
              fcmStale += res.invalidTokens.length
              if (res.invalidTokens.length > 0) {
                await supabase
                  .from('native_push_subscriptions')
                  .delete()
                  .in('device_token', res.invalidTokens)
              }
            } catch (err) {
              console.error('[matchday-digest] FCM send failed:', (err as Error).message)
            }
          }
        }

        // ── 7. Compose + send per ANON recipient (no prefs/mute/tier). ──
        for (const [deviceId, mids] of byDevice) {
          const claimed = await claimNotificationEvent(
            supabase,
            `${CATEGORY}:${tid}:${localDate}:anon:${deviceId}`,
            CATEGORY,
          )
          if (!claimed) continue

          const items = buildItems(mids)
          if (items.length === 0) continue
          const body = formatDigestBody(items)

          recipientsThisTournament++

          const { data: anonSubs } = await supabase
            .from('anon_push_subscriptions')
            .select('id, endpoint, p256dh_key, auth_key')
            .eq('device_id', deviceId)
          const subs = (anonSubs ?? []) as Array<{
            id: string
            endpoint: string
            p256dh_key: string
            auth_key: string
          }>
          anonFired += subs.length
          if (subs.length === 0) continue

          const staleIds: string[] = []
          const results = await Promise.allSettled(
            subs.map((s) =>
              sendPush(
                { endpoint: s.endpoint, keys: { p256dh: s.p256dh_key, auth: s.auth_key } },
                { title, body, url: '/matches', tag },
              ),
            ),
          )
          subs.forEach((s, i) => {
            const r = results[i]
            if (r.status === 'fulfilled' && r.value === true) anonSent++
            else if (r.status === 'fulfilled' && r.value === false) staleIds.push(s.id)
          })
          anonStale += staleIds.length
          if (staleIds.length > 0) {
            await supabase.from('anon_push_subscriptions').delete().in('id', staleIds)
          }
          const surviving = subs.filter((s) => !staleIds.includes(s.id)).map((s) => s.id)
          if (surviving.length > 0) {
            await supabase
              .from('anon_push_subscriptions')
              .update({ last_seen_at: new Date().toISOString() })
              .in('id', surviving)
          }
        }

        recipients += recipientsThisTournament
        sent += webSent + fcmSent + anonSent
        if (recipientsThisTournament > 0) tournamentsSent++

        // ── 8. Telemetry — one notification_sends row per tournament. ──
        try {
          await supabase.from('notification_sends').insert({
            kind: 'category',
            title: 'matchday digest',
            url: '/matches',
            metadata: {
              category: CATEGORY,
              tournament_id: tid,
              local_date: localDate,
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
          console.error('[matchday-digest] notification_sends insert failed:', (e as Error).message)
        }
      }

      return { tournamentsConsidered, tournamentsSent, skippedNoTz, recipients, sent }
    })

    return NextResponse.json({ ok: true, ...meta })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
