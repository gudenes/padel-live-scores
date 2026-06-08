// src/app/api/push/notify/route.ts
//
// Internal endpoint — fired by padelgod's live-poller + Vercel score cron
// on match state transitions. Protected by CRON_SECRET.
//
// REQUEST: { matchId }  (same as before — no event param needed)
//
// AUTO-DETECT EVENT FROM match.status:
//   - scheduled / on_court / live → "Match is Live" / "X is on court" category
//     (match_live_bookmark / match_live_follow)
//   - finished / retired / walkover → "Match finished" / "X won/lost"
//     (match_finished)
//
// Callers don't pass an event — the endpoint reads match.status and picks
// the right content + category. Simplifies the caller API (padelgod just
// says "notify about this match" whenever it writes a transition) and
// prevents mismatches between caller intent and DB truth.
//
// RECIPIENT FAN-OUT:
//   1. Users who BOOKMARKED the match       → reason 'bookmark'
//   2. Users who FOLLOW any of the 4 players → reason 'follow'
//   When a user is in both groups, the follow reason wins (more specific).
//
// Per-user prefs gate each channel via resolvePrefs(). push flag gates
// sendPush, inApp flag gates user_notifications insert. Both branches
// run via Promise.allSettled — independent success/failure.
//
// DEDUP (2026-04-23): for finished events, a (user_id, match_id, category)
// row in user_notifications means we already sent it — skip the whole
// pipeline for that user. Protects against double-fires when both
// padelgod's closeMatch and Vercel's writeFinalState try to notify on the
// same transition. Live events don't need this guard because the writer
// guards with prevStatus === 'scheduled' at the caller side.

import { createClient } from '@supabase/supabase-js'
import { sendPush } from '@/lib/push'
import { sendPushToFcmTokens } from '@/lib/push-fcm'
import { resolvePrefs, shouldDeliverToRecipient, type ChannelPrefs, type NotificationCategory } from '@/lib/notification-categories'
import { isPro, type Plan } from '@/lib/entitlements'
import { resolveNotificationIcon } from '@/lib/notification-icon'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

interface PlayerLite { id: string; name: string | null; display_name: string | null; avatar_url: string | null }
interface SetLite {
  set_number: number | null
  set_score: string | null
  pair1_games: number | null
  pair2_games: number | null
}
interface MatchRow {
  id: string
  status: string | null
  round: string | null
  winner_pair: number | null
  pair1_player1_id: string | null
  pair1_player2_id: string | null
  pair2_player1_id: string | null
  pair2_player2_id: string | null
  tournament: { name: string | null; level: string | null } | null
  pair1_player1: PlayerLite | null
  pair1_player2: PlayerLite | null
  pair2_player1: PlayerLite | null
  pair2_player2: PlayerLite | null
  sets: SetLite[] | null
}

const FINISHED_STATUSES = new Set(['finished', 'retired', 'walkover', 'ended'])

function lastName(fullName: string | null | undefined): string {
  if (!fullName) return ''
  const parts = fullName.trim().split(/\s+/)
  return parts[parts.length - 1] ?? ''
}

// Last token of the player's preferred name. Reads display_name when set
// (e.g. "Gemma Triay Pons" → display_name "Gemma Triay" → "Triay") so push
// titles like "<player> won" use the form fans recognize, not the canonical
// double-surname tail. Falls back to canonical name when display_name is null.
function playerLastName(p: PlayerLite | null | undefined): string {
  if (!p) return ''
  return lastName(p.display_name?.trim() || p.name)
}

function buildBody(m: MatchRow): string {
  const lastNames = (a: PlayerLite | null, b: PlayerLite | null) =>
    [a, b].filter((p): p is PlayerLite => !!p && !!(p.display_name || p.name))
      .map(p => playerLastName(p)).join('/')
  const team1 = lastNames(m.pair1_player1, m.pair1_player2)
  const team2 = lastNames(m.pair2_player1, m.pair2_player2)
  const tournament = m.tournament?.name ?? ''
  const round = m.round ?? ''
  return `${team1} vs ${team2}${tournament ? ` — ${tournament}` : ''}${round ? ` ${round}` : ''}`
}

// ── Finished-event helpers ──────────────────────────────────────────
//
// Render a compact final score from the sets array. Prefers `set_score`
// (the authoritative string written by padelapi/relay, e.g. "6-3") and
// falls back to `{pair1_games}-{pair2_games}` for sets where the score
// string never landed (live-inferred sets). Sets are rendered in
// set_number order and joined with `, ` — "6-3, 4-6, 7-5".
function renderFinalScore(sets: SetLite[] | null | undefined): string {
  if (!sets || sets.length === 0) return ''
  const ordered = [...sets].sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0))
  const parts: string[] = []
  for (const s of ordered) {
    if (s.set_score) {
      parts.push(s.set_score)
      continue
    }
    if (s.pair1_games != null && s.pair2_games != null) {
      parts.push(`${s.pair1_games}-${s.pair2_games}`)
    }
  }
  return parts.join(', ')
}

// Build "<winners> won" name pair for the title, OR return null when we
// can't confidently identify the winners (missing winner_pair, missing
// player names). Callers fall back to a generic "Match finished" title.
function winnerPairName(m: MatchRow): string | null {
  if (m.winner_pair !== 1 && m.winner_pair !== 2) return null
  const pair = m.winner_pair === 1
    ? [m.pair1_player1, m.pair1_player2]
    : [m.pair2_player1, m.pair2_player2]
  const names = pair
    .map(p => (p?.display_name || p?.name ? playerLastName(p) : null))
    .filter((n): n is string => !!n)
  if (names.length === 0) return null
  return names.join('/')
}

interface FinishedContent {
  title: string
  body: string
}

// Finished-event content, tailored per recipient reason.
//
// bookmark (user bookmarked the match):
//   Title: "Match finished 🏆"
//   Body:  "Triay/Brea won 6-3, 6-4 — Brussels P2 R16"
//
// follow (user follows one of the 4 players):
//   Title: "<lastName> won 🏆"   OR   "<lastName> lost"
//   Body:  "6-3, 6-4 vs Rodriguez/Pozzo — Brussels P2 R16"
//   (The body shows the OPPONENT team to give the user their player's
//    context. Score is written from the followed-player's perspective.)
//
// retired/walkover:
//   Title: "Match ended"
//   Body:  "6-3 (retired) — …"  or "Walkover — …"
function buildFinishedContent(
  m: MatchRow,
  reason: RecipientReason,
  followedPlayerId: string | null,
): FinishedContent {
  const tournament = m.tournament?.name ?? ''
  const round = m.round ?? ''
  const tail = [tournament, round].filter(Boolean).join(' ')
  const status = (m.status ?? '').toLowerCase()
  const isRetired = status === 'retired'
  const isWalkover = status === 'walkover'

  const score = renderFinalScore(m.sets)
  const winners = winnerPairName(m)

  // ── Walkover / retired special cases ─────────────────────────────
  if (isWalkover) {
    return {
      title: 'Match ended',
      body: `Walkover${tail ? ` — ${tail}` : ''}`,
    }
  }
  if (isRetired) {
    return {
      title: 'Match ended',
      body: `${score ? `${score} ` : ''}(retired)${tail ? ` — ${tail}` : ''}`,
    }
  }

  // ── Follow-reason — tailor title from the user's player's perspective ──
  if (reason.kind === 'follow' && reason.followedPlayerName && followedPlayerId) {
    const followedInPair1 = m.pair1_player1?.id === followedPlayerId || m.pair1_player2?.id === followedPlayerId
    const followedPairNum = followedInPair1 ? 1 : 2
    const userWon = m.winner_pair === followedPairNum
    const title = userWon
      ? `${reason.followedPlayerName} won 🏆`
      : `${reason.followedPlayerName} lost`
    // Opponent team for context
    const opp = followedPairNum === 1
      ? [m.pair2_player1, m.pair2_player2]
      : [m.pair1_player1, m.pair1_player2]
    const oppNames = opp
      .map(p => (p?.display_name || p?.name ? playerLastName(p) : null))
      .filter((n): n is string => !!n)
      .join('/')
    const body = [
      score,
      oppNames ? `vs ${oppNames}` : '',
      tail ? `— ${tail}` : '',
    ].filter(Boolean).join(' ')
    return { title, body }
  }

  // ── Bookmark reason (or follow fallback with no winner data) ─────
  const title = 'Match finished 🏆'
  const body = winners && score
    ? `${winners} won ${score}${tail ? ` — ${tail}` : ''}`
    : score
      ? `${score}${tail ? ` — ${tail}` : ''}`
      : buildBody(m) // final fallback — reuse the live-event body format
  return { title, body }
}

interface RecipientReason {
  kind: 'bookmark' | 'follow'
  followedPlayerName?: string
  // Needed for finished-event body rendering — lets us tell which pair
  // the user's player was on (so we can render "won 6-3, 6-4" vs the
  // other team). Not used for live events.
  followedPlayerId?: string
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
  //    status + winner_pair + sets drive the event-type branch below.
  //    For live matches those three are often empty/null — harmless,
  //    we only read them when status is in FINISHED_STATUSES.
  const { data: matchRaw } = await supabase
    .from('matches')
    .select(`
      id, status, round, winner_pair,
      pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id,
      tournament:tournaments(name, level),
      pair1_player1:players!matches_pair1_player1_id_fkey(id, name, display_name, avatar_url),
      pair1_player2:players!matches_pair1_player2_id_fkey(id, name, display_name, avatar_url),
      pair2_player1:players!matches_pair2_player1_id_fkey(id, name, display_name, avatar_url),
      pair2_player2:players!matches_pair2_player2_id_fkey(id, name, display_name, avatar_url),
      sets(set_number, set_score, pair1_games, pair2_games)
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
  const playerAvatarById = new Map<string, string>()
  for (const p of [match.pair1_player1, match.pair1_player2, match.pair2_player1, match.pair2_player2]) {
    if (p?.id && (p.display_name || p.name)) playerNameById.set(p.id, playerLastName(p))
    if (p?.id && p.avatar_url) playerAvatarById.set(p.id, p.avatar_url)
  }
  const tournamentLevel = match.tournament?.level ?? null

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
      recipientReason.set(userId, {
        kind: 'follow',
        followedPlayerName: playerDisplayName,
        followedPlayerId: playerId,
      })
    }
  }

  // NOTE: the previous "early return when no authed recipients" check has been
  // removed because anon recipients (Spec 2) live in a separate table that's
  // queried later in this route. Bailing here would skip the anon fan-out for
  // anon-only matches. The user-side blocks below short-circuit naturally on
  // empty arrays (Promise.allSettled([]) resolves immediately) so the wasted
  // work is negligible — typically a single SELECT with no rows.

  // ── Event resolution ──────────────────────────────────────
  // The endpoint auto-detects finished vs live from match.status.
  // 'ended' is a transitional state (score being confirmed) — treated
  // as finished for notify purposes since the match is no longer active.
  const isFinishedEvent = FINISHED_STATUSES.has((match.status ?? '').toLowerCase())

  const userIds = [...recipientReason.keys()]

  // ── Dedup for finished events ─────────────────────────────
  // If user_notifications already has a (user, match, match_finished)
  // row, we've already notified — skip that user entirely. Prevents
  // double-push when both padelgod's closeMatch and Vercel's scores
  // cron writeFinalState try to fire for the same transition. Live
  // events don't need this guard (caller-side prevStatus check handles
  // it) so we skip the extra query for speed.
  const alreadyNotifiedUsers = new Set<string>()
  if (isFinishedEvent) {
    const { data: existing } = await supabase
      .from('user_notifications')
      .select('user_id')
      .eq('category', 'match_finished')
      .eq('metadata->>match_id', matchId)
      .in('user_id', userIds)
    for (const row of existing ?? []) {
      if (row.user_id) alreadyNotifiedUsers.add(row.user_id as string)
    }
  }
  // Filter recipients to only those not yet notified for this event type.
  for (const uid of alreadyNotifiedUsers) recipientReason.delete(uid)
  // NOTE: previous "early return when no authed recipients remain after dedup"
  // is removed — the finished dedup only filters AUTHED users (via
  // user_notifications), so bailing here would skip the anon fan-out for
  // finished events. The user-side blocks below handle empty arrays
  // naturally; the anon block runs unconditionally further down.
  const filteredUserIds = [...recipientReason.keys()]

  // ── Batch-fetch prefs + subscriptions in parallel ──────────
  const [prefsRes, subsRes] = await Promise.all([
    supabase.from('profiles').select('id, notification_prefs, notification_mute_until, plan, plan_expires_at').in('id', filteredUserIds),
    supabase.from('push_subscriptions').select('id, user_id, endpoint, keys').in('user_id', filteredUserIds),
  ])

  const prefsByUser = new Map<string, Record<string, Partial<ChannelPrefs>>>()
  const muteUntilByUser = new Map<string, string | null>()
  const planByUser = new Map<string, boolean>() // userId → isPro
  for (const row of prefsRes.data ?? []) {
    prefsByUser.set(
      row.id as string,
      (row.notification_prefs ?? {}) as Record<string, Partial<ChannelPrefs>>,
    )
    muteUntilByUser.set(row.id as string, (row as { notification_mute_until?: string | null }).notification_mute_until ?? null)
    planByUser.set(
      row.id as string,
      isPro({
        plan: (row as { plan?: Plan }).plan ?? 'free',
        plan_expires_at: (row as { plan_expires_at?: string | null }).plan_expires_at ?? null,
      }),
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
  // Live-event body is shared across recipients. Finished content is built
  // per-recipient because the title depends on which player the user
  // follows (won vs lost) and the body swaps the opponent team in.
  const liveBody = buildBody(match)
  const inAppRows: Array<{
    user_id: string
    category: string
    title: string
    body: string
    url: string
    metadata: Record<string, unknown>
  }> = []
  type PushJob = { sub: { id: string; endpoint: string; keys: unknown }; title: string; body: string; url: string; tag: string; icon: string }
  const pushJobs: PushJob[] = []
  // Track reason-per-sub for per-reason counters
  const reasonBySubId = new Map<string, 'bookmark' | 'follow'>()
  // Per-user payload, used by the FCM branch below so the SAME payload
  // we built for Web Push gets reused for native devices.
  type UserFcmPayload = { title: string; body: string; url: string; tag: string; icon: string }
  const fcmPayloadByUser = new Map<string, UserFcmPayload>()

  for (const [userId, reason] of recipientReason) {
    // Category depends on event type: finished matches always land in
    // match_finished (single bucket regardless of bookmark/follow), while
    // live matches split by reason kind for channel-level preference.
    const category = isFinishedEvent
      ? 'match_finished'
      : (reason.kind === 'follow' ? 'match_live_follow' : 'match_live_bookmark')
    // Tier gate: Pro categories are withheld entirely (push + in-app) from non-Pro users.
    if (!shouldDeliverToRecipient(category as NotificationCategory, planByUser.get(userId) ?? false)) {
      continue
    }
    const resolved = resolvePrefs(prefsByUser.get(userId), category)
    let title: string
    let body: string
    if (isFinishedEvent) {
      const content = buildFinishedContent(match, reason, reason.followedPlayerId ?? null)
      title = content.title
      body = content.body
    } else {
      title = reason.kind === 'follow' && reason.followedPlayerName
        ? `${reason.followedPlayerName} is on court! 🟢`
        : 'Match is Live! 🟢'
      body = liveBody
    }

    // In-app delivery is always on as of 2026-05-27. The inbox is benign and
    // never benefited from per-category opt-out — see notification-categories.ts.
    // Push delivery below (the noisy channel) is still gated by resolved.push.
    inAppRows.push({
      user_id: userId,
      category,
      title,
      body,
      url: `/match/${matchId}`,
      metadata: {
        match_id: matchId,
        reason: reason.kind,
        event: isFinishedEvent ? 'finished' : 'live',
        ...(reason.followedPlayerName ? { followed_player_name: reason.followedPlayerName } : {}),
      },
    })

    // Skip push fan-out for users with an active mute. In-app delivery
    // still runs (history preserved). Mute is push-only.
    const muteUntil = muteUntilByUser.get(userId) ?? null
    const isMuted = muteUntil === 'forever' ||
      (typeof muteUntil === 'string' && muteUntil !== 'forever' && new Date(muteUntil) > new Date())

    if (!isMuted && resolved.push) {
      // Resolve the icon URL once per recipient (same for web push + FCM):
      // follow → followed player's avatar (fallback to circuit logo if no avatar)
      // bookmark → circuit logo based on tournament.level
      const icon = resolveNotificationIcon({
        reason: reason.kind,
        tournamentLevel,
        followedPlayerAvatarUrl: reason.followedPlayerId
          ? playerAvatarById.get(reason.followedPlayerId) ?? null
          : null,
      })

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
          icon,
        })
      }
      // Mirror the same payload for the FCM branch (native devices).
      // Single push pref gates both transports — see plan rationale.
      fcmPayloadByUser.set(userId, {
        title,
        body,
        url: `/match/${matchId}`,
        tag: `match-${matchId}`,
        icon,
      })
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
            title: job.title, body: job.body, url: job.url, tag: job.tag, icon: job.icon,
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

  // ── FCM fan-out (native devices) ─────────────────────────────────
  // Parallel branch to the Web Push send above. Pulls device tokens
  // from native_push_subscriptions for the same recipients (filtered
  // by the same push pref — see fcmPayloadByUser population). Tokens
  // FCM rejects as unregistered get cleaned from the table.
  let fcmSent = 0
  let fcmFailed = 0
  let fcmStaleCleaned = 0
  if (fcmPayloadByUser.size > 0) {
    const eligibleUserIds = [...fcmPayloadByUser.keys()]
    const { data: nativeSubs } = await supabase
      .from('native_push_subscriptions')
      .select('user_id, device_token')
      .in('user_id', eligibleUserIds)

    const tokensByUser = new Map<string, string[]>()
    for (const row of nativeSubs ?? []) {
      const uid = row.user_id as string
      const tok = row.device_token as string
      if (!uid || !tok) continue
      const arr = tokensByUser.get(uid) ?? []
      arr.push(tok)
      tokensByUser.set(uid, arr)
    }

    const invalidTokens: string[] = []
    await Promise.allSettled(
      [...tokensByUser.entries()].map(async ([userId, tokens]) => {
        const payload = fcmPayloadByUser.get(userId)
        if (!payload) return
        try {
          const result = await sendPushToFcmTokens(tokens, payload)
          fcmSent += result.success
          fcmFailed += result.failed
          if (result.invalidTokens.length > 0) {
            invalidTokens.push(...result.invalidTokens)
          }
        } catch (err) {
          console.error('[Push] FCM send failed:', (err as Error).message)
          fcmFailed += tokens.length
        }
      })
    )

    if (invalidTokens.length > 0) {
      const { error: delErr } = await supabase
        .from('native_push_subscriptions')
        .delete()
        .in('device_token', invalidTokens)
      if (!delErr) fcmStaleCleaned = invalidTokens.length
      console.log(`[Push] Cleaned ${invalidTokens.length} stale FCM tokens`)
    }
  }

  // ── Anonymous recipient fan-out ───────────────────────────
  // Devices whose anon_bookmarks reference this match (bookmark) or
  // any of its 4 player IDs (follow). Anonymous recipients have no
  // profile → no per-channel prefs and no in-app notifications; we
  // just send the push.
  //
  // Two-step query (no embedded join — there's no declared FK between
  // anon_push_subscriptions and anon_bookmarks; the device_id link is
  // many-to-many):
  //   1. Find device_ids whose anon_bookmarks match this match's targets.
  //   2. Fetch anon_push_subscriptions for those device_ids.

  const matchBookmarksPromise = supabase
    .from('anon_bookmarks')
    .select('device_id')
    .eq('bookmark_type', 'match')
    .eq('target_id', matchId)

  const playerBookmarksPromise = playerIds.length > 0
    ? supabase
        .from('anon_bookmarks')
        .select('device_id')
        .eq('bookmark_type', 'player')
        .in('target_id', playerIds)
    : Promise.resolve({ data: [] as Array<{ device_id: string }>, error: null })

  const [matchBookmarksRes, playerBookmarksRes] = await Promise.all([
    matchBookmarksPromise,
    playerBookmarksPromise,
  ])

  // Collect unique device_ids across both result sets.
  const matchedDeviceIds = new Set<string>()
  for (const row of matchBookmarksRes.data ?? []) {
    if (row.device_id) matchedDeviceIds.add(row.device_id as string)
  }
  for (const row of playerBookmarksRes.data ?? []) {
    if (row.device_id) matchedDeviceIds.add(row.device_id as string)
  }

  let anonSubs: Array<{
    id: string
    device_id: string
    endpoint: string
    p256dh_key: string
    auth_key: string
  }> = []

  if (matchedDeviceIds.size > 0) {
    const { data: subsData, error: subsErr } = await supabase
      .from('anon_push_subscriptions')
      .select('id, device_id, endpoint, p256dh_key, auth_key')
      .in('device_id', [...matchedDeviceIds])
    if (subsErr) {
      console.error('[Push] anon_push_subscriptions fetch failed', subsErr)
    } else {
      anonSubs = (subsData ?? []).map(s => ({
        id: s.id as string,
        device_id: s.device_id as string,
        endpoint: s.endpoint as string,
        p256dh_key: s.p256dh_key as string,
        auth_key: s.auth_key as string,
      }))
    }
  }
  let anonSent = 0
  const anonStaleIds: string[] = []

  if (anonSubs.length > 0) {
    // Build a generic anon push payload. Anon recipients don't have a
    // per-recipient reason (that's a sign-in concept), so we use the
    // bookmark-reason content for both follow and bookmark cases —
    // bookmark phrasing is more universal ("Match is Live! 🟢" vs
    // "<lastName> is on court").
    const anonContent = isFinishedEvent
      ? buildFinishedContent(match, { kind: 'bookmark' }, null)
      : { title: 'Match is Live! 🟢', body: buildBody(match) }
    // Anon users have no follow concept — always circuit logo per
    // tournament.level. Skips the avatar branch in resolveNotificationIcon.
    const anonIcon = resolveNotificationIcon({
      reason: 'bookmark',
      tournamentLevel,
    })

    const anonResults = await Promise.allSettled(
      anonSubs.map(s =>
        sendPush(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh_key, auth: s.auth_key },
          },
          {
            title: anonContent.title,
            body: anonContent.body,
            url: `/match/${matchId}`,
            tag: `match-${matchId}`,
            icon: anonIcon,
          },
        ),
      ),
    )
    anonSubs.forEach((s, i) => {
      const r = anonResults[i]
      if (r.status === 'fulfilled' && r.value === true) {
        anonSent++
      } else if (r.status === 'fulfilled' && r.value === false) {
        // sendPush returns false on 410/404 → stale subscription
        anonStaleIds.push(s.id)
      }
    })
  }

  // Delete stale anon subscriptions; trigger handles bookmark cleanup.
  if (anonStaleIds.length > 0) {
    await supabase
      .from('anon_push_subscriptions')
      .delete()
      .in('id', anonStaleIds)
    console.log(`[Push] Cleaned ${anonStaleIds.length} stale anon subscriptions`)
  }

  // Bump last_seen_at for surviving anon subs that successfully received
  // a push — used by the 90-day cleanup cron.
  const survivingAnonIds = anonSubs
    .filter(s => !anonStaleIds.includes(s.id))
    .map(s => s.id)
  if (survivingAnonIds.length > 0) {
    await supabase
      .from('anon_push_subscriptions')
      .update({ last_seen_at: new Date().toISOString() })
      .in('id', survivingAnonIds)
  }

  console.log(
    `[Push] match=${matchId} recipients=${recipientReason.size} ` +
    `inapp=${inappWritten} push=${pushSent} fcm=${fcmSent} ` +
    `(bookmark=${bookmarkSent} follow=${followSent}) ` +
    `stale=${staleIds.length} fcm_stale=${fcmStaleCleaned} fcm_failed=${fcmFailed} ` +
    `anon=${anonSubs.length} anon_sent=${anonSent} anon_stale=${anonStaleIds.length}`
  )

  // Persist a notification_sends analytics row (kind='match'). Additive —
  // purely observability; failure must never break delivery.
  try {
    await supabase.from('notification_sends').insert({
      kind: 'match',
      title: 'Match notification',
      body: null,
      url: null,
      metadata: {
        match_id: matchId,
        by_reason: { bookmark: bookmarkSent, follow: followSent },
        inapp_written: inappWritten,
      },
      // Use SUBSCRIPTION/token counts (not user counts) so match rows share
      // the same semantics as broadcast rows: fired = attempts, and
      // accepted ≤ fired always holds within a channel.
      web_fired: pushJobs.length,
      web_accepted: pushSent,
      web_stale: staleIds.length,
      fcm_fired: fcmSent + fcmFailed,
      fcm_accepted: fcmSent,
      fcm_failed: fcmFailed,
      fcm_stale: fcmStaleCleaned,
      anon_fired: anonSubs.length,
      anon_accepted: anonSent,
      anon_stale: anonStaleIds.length,
      recipients_total: pushJobs.length + (fcmSent + fcmFailed) + anonSubs.length,
      accepted_total: pushSent + fcmSent + anonSent,
    })
  } catch (e) {
    console.error('[Push] notification_sends insert failed:', (e as Error).message)
  }

  return Response.json({
    ok: true,
    recipients: recipientReason.size,
    inapp_written: inappWritten,
    sent: pushSent,
    fcm_sent: fcmSent,
    by_reason: { bookmark: bookmarkSent, follow: followSent },
    stale_cleaned: staleIds.length,
    fcm_stale_cleaned: fcmStaleCleaned,
    anon_recipients: anonSubs.length,
    anon_sent: anonSent,
  })
}
