// src/hooks/useLiveMatch.ts
//
// Per-match realtime hook. When `enabled`, opens a Supabase channel
// scoped to a single match id (matches + sets + games filtered to that
// id) and refetches the match on every change with no debounce. The
// match-detail page is the gold standard for live accuracy; this hook
// brings the same pattern to every card surface so home / matches /
// tournament-detail update with identical fidelity.
//
// Each card subscribes for itself when its match goes live, so a point
// landing on match A only re-renders match A — match B doesn't even
// know. Fans get the "individual update" feel.
//
// Usage:
//   const live = useLiveMatch(match.id, isLive, match)
//   // `live` is the latest Match snapshot, or the fallback while not
//   // enabled / before first fetch resolves.

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchMatchById } from '@/lib/match-fetch'
import type { Match } from '@/types/match'

interface LiveSnapshot {
  /** matchId this snapshot belongs to. Bundled with the match so we can
   *  detect (during render) whether the snapshot is stale due to the
   *  parent recycling the card slot for a different match. */
  id: string
  match: Match
}

/**
 * Subscribe to live updates for a single match.
 *
 * @param matchId  Canonical match UUID.
 * @param enabled  Only opens the channel + initial fetch when true. Caller
 *                 typically passes `match.status === 'live' || 'on_court'`.
 *                 When this flips false, the channel is torn down and the
 *                 hook returns the fallback prop.
 * @param fallback The match prop the parent already has. Used as the
 *                 initial value and whenever the hook hasn't (yet)
 *                 produced a fresher snapshot.
 *
 * @returns The freshest Match snapshot the hook knows about. Always
 *          non-null because `fallback` is the floor.
 */
export function useLiveMatch(
  matchId: string,
  enabled: boolean,
  fallback: Match,
): Match {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null)

  useEffect(() => {
    // When disabled, render falls back to the parent prop via the
    // `enabled` gate below. We don't clear the snapshot here — that
    // would be a setState during render's effect cycle (and is
    // unnecessary anyway since the gate handles staleness).
    if (!enabled) return

    let cancelled = false

    const refetch = async () => {
      const next = await fetchMatchById(supabase, matchId)
      if (cancelled || !next) return
      setSnapshot({ id: matchId, match: next })
    }

    refetch()

    const channel = supabase
      .channel(`match-${matchId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        refetch,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sets', filter: `match_id=eq.${matchId}` },
        refetch,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'games', filter: `match_id=eq.${matchId}` },
        refetch,
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [matchId, enabled])

  // Only return the live snapshot if (a) we're enabled and (b) it
  // belongs to the current matchId. The `enabled` gate ensures a stale
  // snapshot from a previous live phase doesn't shadow a fresh prop
  // when a match transitions out of live state. The matchId check
  // protects against the parent recycling the card slot for a
  // different match.
  if (enabled && snapshot && snapshot.id === matchId) return snapshot.match
  return fallback
}
