// src/app/api/push/notify/route.ts
//
// Internal endpoint — fired by the score cron when a match goes live.
// Protected by CRON_SECRET. Same request shape as before: { matchId }.
//
// RECIPIENT FAN-OUT (unchanged from the pre-rewire version):
//   1. Users who BOOKMARKED the match       → reason 'bookmark'
//   2. Users who FOLLOW any of the 4 players → reason 'follow'
//   When a user is in both groups, the follow reason wins (more specific).
//
// NEW: per-user prefs gate each channel:
//   - category = reason.kind === 'follow' ? 'match_live_follow' : 'match_live_bookmark'
//   - resolvePrefs(userPrefs, category) → { push, inApp }
//   - push  flag gates the existing sendPush() call
//   - inApp flag gates a row insert into user_notifications
//   - Both branches run independently via Promise.allSettled — a failure
//     in one does not prevent the other.

import { createClient } from '@supabase/supabase-js'
import { sendPush } from '@/lib/push'
import { resolvePrefs, type ChannelPrefs } from '@/lib/notification-categories'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

interface PlayerLite { id: string; name: string | null }
interface MatchRow {
  id: string
  round: string | null
  pair1_player1_id: string | null
  pair1_player2_id: string | null
  pair2_player1_id: string | null
  pair2_player2_id: string | null
  tournament: { name: string | null } | null
  pair1_player1: PlayerLite | null
  pair1_player2: PlayerLite | null
  pair2_player1: PlayerLite | null
  pair2_player2: PlayerLite | null
}

function lastName(fullName: string | null | undefined): string {
  if (!fullName) return ''
  const parts = fullName.trim().split(/\s+/)
  return parts[parts.length - 1] ?? ''
}

function buildBody(m: MatchRow): string {
  const lastNames = (a: PlayerLite | null, b: PlayerLite | null) =>
    [a?.name, b?.name].filter(Boolean).map(n => lastName(n)).join('/')
  const team1 = lastNames(m.pair1_player1, m.pair1_player2)
  const team2 = lastNames(m.pair2_player1, m.pair2_player2)
  const tournament = m.tournament?.name ?? ''
  const round = m.round ?? ''
  return `${team1} vs ${team2}${tournament ? ` — ${tournament}` : ''}${round ? ` ${round}` : ''}`
}

interface RecipientReason {
  kind: 'bookmark' | 'follow'
  followedPlayerName?: string
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { matchId } = await request.json()
  if (!matchId) {
    return Response.json({ error: 'Missing matchId' }, { status: 400 })
  }

  // ── Fetch match details ────────────────────────────────────
  const { data: matchRaw } = await supabase
    .from('matches')
    .select(`
      id, round,
      pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id,
      tournament:tournaments(name),
      pair1_player1:players!matches_pair1_player1_id_fkey(id, name),
      pair1_player2:players!matches_pair1_player2_id_fkey(id, name),
      pair2_player1:players!matches_pair2_player1_id_fkey(id, name),
      pair2_player2:players!matches_pair2_player2_id_fkey(id, name)
    `)
    .eq('id', matchId)
    .single()

  if (!matchRaw) {
    return Response.json({ error: 'Match not found' }, { status: 404 })
  }
  const match = matchRaw as unknown as MatchRow

  // ── Build recipient → reason map ───────────────────────────
  const recipientReason = new Map<string, RecipientReason>()

  const { data: bookmarks } = await supabase
    .from('user_bookmarks')
    .select('user_id')
    .eq('bookmark_type', 'match')
    .eq('target_id', matchId)

  for (const b of bookmarks ?? []) {
    if (b.user_id) recipientReason.set(b.user_id as string, { kind: 'bookmark' })
  }

  const playerIds = [
    match.pair1_player1_id, match.pair1_player2_id,
    match.pair2_player1_id, match.pair2_player2_id,
  ].filter((id): id is string => !!id)

  const playerNameById = new Map<string, string>()
  for (const p of [match.pair1_player1, match.pair1_player2, match.pair2_player1, match.pair2_player2]) {
    if (p?.id && p.name) playerNameById.set(p.id, lastName(p.name))
  }

  if (playerIds.length > 0) {
    const { data: playerFollows } = await supabase
      .from('user_bookmarks')
      .select('user_id, target_id')
      .eq('bookmark_type', 'player')
      .in('target_id', playerIds)
    for (const f of playerFollows ?? []) {
      const userId = f.user_id as string | null
      const playerId = f.target_id as string | null
      if (!userId || !playerId) continue
      const existing = recipientReason.get(userId)
      if (existing?.kind === 'follow') continue
      const playerDisplayName = playerNameById.get(playerId)
      if (!playerDisplayName) continue
      recipientReason.set(userId, { kind: 'follow', followedPlayerName: playerDisplayName })
    }
  }

  if (recipientReason.size === 0) {
    return Response.json({ ok: true, recipients: 0, sent: 0, inapp_written: 0, reason: 'no recipients' })
  }

  const userIds = [...recipientReason.keys()]

  // ── Batch-fetch prefs + subscriptions in parallel ──────────
  const [prefsRes, subsRes] = await Promise.all([
    supabase.from('profiles').select('id, notification_prefs').in('id', userIds),
    supabase.from('push_subscriptions').select('id, user_id, endpoint, keys').in('user_id', userIds),
  ])

  const prefsByUser = new Map<string, Record<string, Partial<ChannelPrefs>>>()
  for (const row of prefsRes.data ?? []) {
    prefsByUser.set(
      row.id as string,
      (row.notification_prefs ?? {}) as Record<string, Partial<ChannelPrefs>>,
    )
  }

  const subsByUser = new Map<string, typeof subsRes.data>()
  for (const sub of subsRes.data ?? []) {
    const uid = sub.user_id as string
    const list = subsByUser.get(uid) ?? []
    list.push(sub)
    subsByUser.set(uid, list)
  }

  // ── Per-recipient resolve → split into in-app inserts + push payloads ──
  const body = buildBody(match)
  const inAppRows: Array<{
    user_id: string
    category: string
    title: string
    body: string
    url: string
    metadata: Record<string, unknown>
  }> = []
  type PushJob = { sub: { id: string; endpoint: string; keys: unknown }; title: string; body: string; url: string; tag: string }
  const pushJobs: PushJob[] = []
  // Track reason-per-sub for per-reason counters
  const reasonBySubId = new Map<string, 'bookmark' | 'follow'>()

  for (const [userId, reason] of recipientReason) {
    const category = reason.kind === 'follow' ? 'match_live_follow' : 'match_live_bookmark'
    const resolved = resolvePrefs(prefsByUser.get(userId), category)
    const title = reason.kind === 'follow' && reason.followedPlayerName
      ? `${reason.followedPlayerName} is on court! 🟢`
      : 'Match is Live! 🟢'

    if (resolved.inApp) {
      inAppRows.push({
        user_id: userId,
        category,
        title,
        body,
        url: `/match/${matchId}`,
        metadata: {
          match_id: matchId,
          reason: reason.kind,
          ...(reason.followedPlayerName ? { followed_player_name: reason.followedPlayerName } : {}),
        },
      })
    }

    if (resolved.push) {
      const subs = subsByUser.get(userId) ?? []
      for (const sub of subs) {
        const subId = sub.id as string
        reasonBySubId.set(subId, reason.kind)
        pushJobs.push({
          sub: { id: subId, endpoint: sub.endpoint as string, keys: sub.keys },
          title,
          body,
          url: `/match/${matchId}`,
          tag: `match-${matchId}`,
        })
      }
    }
  }

  // ── Independent delivery: in-app insert + push send, both allSettled ──
  let inappWritten = 0
  let pushSent = 0
  let bookmarkSent = 0
  let followSent = 0
  const staleIds: string[] = []

  await Promise.allSettled([
    (async () => {
      if (inAppRows.length === 0) return
      const { error: insErr, count } = await supabase
        .from('user_notifications')
        .insert(inAppRows, { count: 'exact' })
      if (insErr) {
        console.error('[Push] in-app insert failed:', insErr.message)
      } else {
        inappWritten = count ?? inAppRows.length
      }
    })(),
    (async () => {
      await Promise.allSettled(
        pushJobs.map(async (job) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const success = await sendPush({ endpoint: job.sub.endpoint, keys: job.sub.keys as any }, {
            title: job.title, body: job.body, url: job.url, tag: job.tag,
          })
          if (success) {
            pushSent++
            const kind = reasonBySubId.get(job.sub.id)
            if (kind === 'follow') followSent++
            else bookmarkSent++
          } else {
            staleIds.push(job.sub.id)
          }
        })
      )
    })(),
  ])

  if (staleIds.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', staleIds)
    console.log(`[Push] Cleaned ${staleIds.length} stale subscriptions`)
  }

  console.log(
    `[Push] match=${matchId} recipients=${recipientReason.size} ` +
    `inapp=${inappWritten} push=${pushSent} ` +
    `(bookmark=${bookmarkSent} follow=${followSent}) stale=${staleIds.length}`
  )

  return Response.json({
    ok: true,
    recipients: recipientReason.size,
    inapp_written: inappWritten,
    sent: pushSent,
    by_reason: { bookmark: bookmarkSent, follow: followSent },
    stale_cleaned: staleIds.length,
  })
}
