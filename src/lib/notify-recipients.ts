// src/lib/notify-recipients.ts
// Resolve "followers of entity X" for event-driven notifications.
// player/tournament/match events fan out to bookmarks of the matching type.
//
// Authed recipients come from user_bookmarks; anon recipients come from
// anon_bookmarks → device_ids → anon_push_subscriptions. Query shapes mirror
// the match-specific route in /api/push/notify exactly.
//
//   player     → bookmark_type='player'      (authed + anon)
//   tournament → bookmark_type='tournament'  (authed only; no tournament anon)
//   match      → bookmark_type='match' UNION player-follows on the 4 player FKs
//                (authed + anon)
//
// anon_bookmarks.bookmark_type only supports 'player' and 'match' (NOT
// tournament), so the tournament path resolves no anon subs.

import type { SupabaseClient } from '@supabase/supabase-js'

export type EntityType = 'player' | 'tournament' | 'match'

export type AnonSub = { id: string; endpoint: string; p256dh_key: string; auth_key: string; device_id?: string }

export type EntityFollowers = {
  userIds: string[]
  anonSubs: AnonSub[]
}

const EMPTY: EntityFollowers = { userIds: [], anonSubs: [] }

type Supa = Pick<SupabaseClient, 'from'>

// Fetch anon_push_subscriptions for a set of device_ids (the many-to-many link
// between anon_bookmarks and anon_push_subscriptions). Dedups subs by id.
async function fetchAnonSubsForDevices(
  supabase: Supa,
  deviceIds: Set<string>,
): Promise<AnonSub[]> {
  if (deviceIds.size === 0) return []
  const { data, error } = await supabase
    .from('anon_push_subscriptions')
    .select('id, endpoint, p256dh_key, auth_key, device_id')
    .in('device_id', [...deviceIds])
  if (error || !data) return []
  const byId = new Map<string, AnonSub>()
  for (const s of data as Array<{ id: string; endpoint: string; p256dh_key: string; auth_key: string; device_id?: string }>) {
    if (s.id) {
      byId.set(s.id, {
        id: s.id,
        endpoint: s.endpoint,
        p256dh_key: s.p256dh_key,
        auth_key: s.auth_key,
        device_id: s.device_id,
      })
    }
  }
  return [...byId.values()]
}

export async function resolveEntityFollowers(
  supabase: Supa,
  entityType: EntityType,
  entityId: string | string[],
): Promise<EntityFollowers> {
  // Runtime guard — a caller passing an unsupported entityType (despite the
  // compile-time union) gets an empty result, never a misdirected query.
  if (entityType !== 'player' && entityType !== 'tournament' && entityType !== 'match') {
    return EMPTY
  }

  // Normalize the target into an id list. A plain string keeps the original
  // single-id `.eq` query shape; an array fans out via `.in` so ONE call
  // resolves the UNION of followers across several entities. The batch form
  // backs per-tournament coalescing of `player_entered` sends — every fan who
  // follows any of the newly-entered players is resolved once, deduped, and
  // notified a single time (see fip-entry-list-populator). match schedules use the same union to produce one alert per refresh.
  const isBatch = Array.isArray(entityId)
  const ids = (isBatch ? entityId : [entityId]).filter(Boolean) as string[]
  if (ids.length === 0) return EMPTY

  try {
    if (entityType === 'player' || entityType === 'tournament') {
      // ── Authed: user_bookmarks of the matching type ──────────
      const authedBase = supabase
        .from('user_bookmarks')
        .select('user_id')
        .eq('bookmark_type', entityType)
      const { data, error } = await (isBatch
        ? authedBase.in('target_id', ids)
        : authedBase.eq('target_id', ids[0]))
      if (error) return EMPTY
      const userIds = Array.from(
        new Set((data as { user_id: string }[] | null ?? []).map((r) => r.user_id).filter(Boolean)),
      )

      // ── Anon: only 'player' has an anon_bookmarks type ───────
      if (entityType === 'tournament') {
        return { userIds, anonSubs: [] }
      }

      const anonBase = supabase
        .from('anon_bookmarks')
        .select('device_id')
        .eq('bookmark_type', 'player')
      const { data: anonBm, error: anonErr } = await (isBatch
        ? anonBase.in('target_id', ids)
        : anonBase.eq('target_id', ids[0]))
      if (anonErr) return { userIds, anonSubs: [] }
      const deviceIds = new Set<string>()
      for (const row of (anonBm as { device_id: string }[] | null) ?? []) {
        if (row.device_id) deviceIds.add(row.device_id)
      }
      const anonSubs = await fetchAnonSubsForDevices(supabase, deviceIds)
      return { userIds, anonSubs }
    }

    // ── match ──────────────────────────────────────────────────
    // Read the player FKs from every match, then union match-bookmarks
    // with player-follows across both authed + anon tables.
    const matchQuery = supabase.from('matches')
      .select('pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')
    const { data: matchRows, error: matchErr } = await (isBatch
      ? matchQuery.in('id', ids) : matchQuery.eq('id', ids[0]).single())
    if (matchErr) return EMPTY
    const rows = (isBatch ? matchRows ?? [] : [matchRows ?? {}]) as Array<Record<string, string | null>>
    const playerIds = [...new Set(rows.flatMap(m => [
      m.pair1_player1_id, m.pair1_player2_id, m.pair2_player1_id, m.pair2_player2_id,
    ]).filter((id): id is string => !!id))]

    // ── Authed: match-bookmarks + player-follows ─────────────
    const userIdSet = new Set<string>()

    const matchBookmarks = supabase
      .from('user_bookmarks')
      .select('user_id')
      .eq('bookmark_type', 'match')
    const { data: matchBm, error: matchBmErr } = await (isBatch
      ? matchBookmarks.in('target_id', ids) : matchBookmarks.eq('target_id', ids[0]))
    if (matchBmErr) return EMPTY
    for (const r of (matchBm as { user_id: string }[] | null) ?? []) {
      if (r.user_id) userIdSet.add(r.user_id)
    }

    if (playerIds.length > 0) {
      const { data: playerFollows, error: pfErr } = await supabase
        .from('user_bookmarks')
        .select('user_id')
        .eq('bookmark_type', 'player')
        .in('target_id', playerIds)
      if (pfErr) return EMPTY
      for (const r of (playerFollows as { user_id: string }[] | null) ?? []) {
        if (r.user_id) userIdSet.add(r.user_id)
      }
    }

    // ── Anon: match-bookmarks + player-bookmarks → device_ids ──
    const deviceIds = new Set<string>()

    const anonMatchBookmarks = supabase
      .from('anon_bookmarks')
      .select('device_id')
      .eq('bookmark_type', 'match')
    const { data: anonMatchBm, error: anonMatchErr } = await (isBatch
      ? anonMatchBookmarks.in('target_id', ids) : anonMatchBookmarks.eq('target_id', ids[0]))
    if (!anonMatchErr) {
      for (const r of (anonMatchBm as { device_id: string }[] | null) ?? []) {
        if (r.device_id) deviceIds.add(r.device_id)
      }
    }

    if (playerIds.length > 0) {
      const { data: anonPlayerBm, error: anonPlayerErr } = await supabase
        .from('anon_bookmarks')
        .select('device_id')
        .eq('bookmark_type', 'player')
        .in('target_id', playerIds)
      if (!anonPlayerErr) {
        for (const r of (anonPlayerBm as { device_id: string }[] | null) ?? []) {
          if (r.device_id) deviceIds.add(r.device_id)
        }
      }
    }

    const anonSubs = await fetchAnonSubsForDevices(supabase, deviceIds)
    return { userIds: [...userIdSet], anonSubs }
  } catch {
    // Fail soft — a resolution error must never block the rest of a notify run.
    return EMPTY
  }
}

/** Draw audiences include tournament followers and followers of bracket players. */
export async function resolveDrawFollowers(supabase: Supa, tournamentId: string): Promise<EntityFollowers> {
  const tournament = await resolveEntityFollowers(supabase, 'tournament', tournamentId)
  const { data, error } = await supabase.from('tournament_draws')
    .select('player1_id, player2_id').eq('tournament_id', tournamentId)
  if (error) throw new Error(`Draw recipients unavailable: ${error.message}`)
  const playerIds = [...new Set((data ?? []).flatMap(row => [row.player1_id, row.player2_id])
    .filter((id): id is string => typeof id === 'string' && !!id))]
  const players = await resolveEntityFollowers(supabase, 'player', playerIds)
  return {
    userIds: [...new Set([...tournament.userIds, ...players.userIds])],
    anonSubs: players.anonSubs,
  }
}
