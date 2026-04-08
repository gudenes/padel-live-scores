// src/app/api/push/notify/route.ts
//
// Internal endpoint: sends push notifications when a match goes live.
// Protected by CRON_SECRET. Called by the score cron when a match
// transitions to live.
//
// RECIPIENT FAN-OUT (two paths, deduped per user):
//   1. Users who BOOKMARKED the match
//      → message: "Match is Live! 🟢 — {team1} vs {team2}"
//   2. Users who FOLLOW any of the 4 players in the match
//      → message: "{LastName} is on court! 🟢 — {team1} vs {team2}"
//      → personalized to mention the player they actually follow
//
// If a user is in BOTH groups (followed a player AND bookmarked the
// match), the player-follow message wins because it's more specific.
//
// Notifications are deduplicated at the OS level via the `tag` field
// (`match-${matchId}`) so a user gets at most ONE notification per
// match transition, even if they follow multiple players in that match.

import { createClient } from '@supabase/supabase-js'
import { sendPush } from '@/lib/push'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

interface PlayerLite {
  id: string
  name: string | null
}

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

// "Firstname Lastname Lastname2" → "Lastname2"
function lastName(fullName: string | null | undefined): string {
  if (!fullName) return ''
  const parts = fullName.trim().split(/\s+/)
  return parts[parts.length - 1] ?? ''
}

// Build the "team1 vs team2 — Tournament Round" body shared by every payload
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
  followedPlayerName?: string  // last-name display, only set when kind === 'follow'
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

  // ── Fetch match details (incl. player IDs for follow-fan-out) ──
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

  // Cast through unknown so the joined player columns get our PlayerLite shape
  const match = matchRaw as unknown as MatchRow

  // ── Build recipient → reason map ─────────────────────────────
  // We do bookmarks first (less specific message), then overlay player
  // follows (more specific message wins). Result is one entry per user.
  const recipientReason = new Map<string, RecipientReason>()

  // Path 1: bookmarkers of the match itself
  const { data: bookmarks } = await supabase
    .from('user_bookmarks')
    .select('user_id')
    .eq('bookmark_type', 'match')
    .eq('target_id', matchId)

  for (const b of bookmarks ?? []) {
    if (b.user_id) recipientReason.set(b.user_id as string, { kind: 'bookmark' })
  }

  // Path 2: followers of any of the 4 players in this match
  const playerIds = [
    match.pair1_player1_id,
    match.pair1_player2_id,
    match.pair2_player1_id,
    match.pair2_player2_id,
  ].filter((id): id is string => !!id)

  // Map each player_id → display name (last name) so we can personalize
  const playerNameById = new Map<string, string>()
  if (match.pair1_player1?.id && match.pair1_player1.name) {
    playerNameById.set(match.pair1_player1.id, lastName(match.pair1_player1.name))
  }
  if (match.pair1_player2?.id && match.pair1_player2.name) {
    playerNameById.set(match.pair1_player2.id, lastName(match.pair1_player2.name))
  }
  if (match.pair2_player1?.id && match.pair2_player1.name) {
    playerNameById.set(match.pair2_player1.id, lastName(match.pair2_player1.name))
  }
  if (match.pair2_player2?.id && match.pair2_player2.name) {
    playerNameById.set(match.pair2_player2.id, lastName(match.pair2_player2.name))
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
      // Skip if we already recorded a follow for this user — first match wins.
      // (Handles the "user follows multiple players in the same match" case.)
      const existing = recipientReason.get(userId)
      if (existing?.kind === 'follow') continue
      const playerDisplayName = playerNameById.get(playerId)
      if (!playerDisplayName) continue
      recipientReason.set(userId, { kind: 'follow', followedPlayerName: playerDisplayName })
    }
  }

  if (recipientReason.size === 0) {
    return Response.json({ ok: true, sent: 0, reason: 'no recipients' })
  }

  // ── Fetch subscriptions for all unique recipients ───────────
  const userIds = [...recipientReason.keys()]
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('id, user_id, endpoint, keys')
    .in('user_id', userIds)

  if (!subscriptions?.length) {
    return Response.json({ ok: true, sent: 0, reason: 'no subscriptions' })
  }

  // ── Build body once, send personalized title per subscription ──
  const body = buildBody(match)
  let sent = 0
  let bookmarkSent = 0
  let followSent = 0
  const staleIds: string[] = []

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const reason = recipientReason.get(sub.user_id as string)
      if (!reason) return
      const title = reason.kind === 'follow' && reason.followedPlayerName
        ? `${reason.followedPlayerName} is on court! 🟢`
        : 'Match is Live! 🟢'
      const payload = {
        title,
        body,
        url: `/match/${matchId}`,
        // Same tag for both reasons → OS dedupes to a single notification
        // per match transition per device, even if a user is both a
        // bookmarker and a player-follower.
        tag: `match-${matchId}`,
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const success = await sendPush({ endpoint: sub.endpoint as string, keys: sub.keys as any }, payload)
      if (success) {
        sent++
        if (reason.kind === 'follow') followSent++
        else bookmarkSent++
      } else {
        staleIds.push(sub.id as string)
      }
    })
  )

  // Clean up stale subscriptions
  if (staleIds.length > 0) {
    await supabase
      .from('push_subscriptions')
      .delete()
      .in('id', staleIds)
    console.log(`[Push] Cleaned ${staleIds.length} stale subscriptions`)
  }

  console.log(
    `[Push] match=${matchId} recipients=${recipientReason.size} sent=${sent} ` +
    `(bookmark=${bookmarkSent} follow=${followSent}) stale=${staleIds.length}`
  )

  return Response.json({
    ok: true,
    recipients: recipientReason.size,
    sent,
    by_reason: { bookmark: bookmarkSent, follow: followSent },
    stale_cleaned: staleIds.length,
  })
}
