// src/app/api/play/_signals.ts
//
// The two decision signals the deck card shows beyond the price: each
// player's recent form, and the two pairs' head-to-head record.
//
// ── Four things that are load-bearing here ──────────────────────────────
//
// 1. ORDER BY finished_at. NEVER scheduled_at. `matches.scheduled_at` is NULL
//    on 1,191 of 16,292 finished rows, and its maximum value on a FINISHED row
//    is in the future (2026-12-01). Postgres sorts NULLs first on DESC, so
//    ordering by it hoists a future-dated match to the head of "last 5" and
//    hands two OPPOSING players the identical sequence — an impossible result,
//    and the way this bug announces itself. `finished_at` is NULL on 3 rows.
//    The sanity check to keep: partners may share a sequence, opponents cannot.
//
// 2. One round of queries for the WHOLE page, never one per market. 30 markets
//    × 4 players = 120 players; a per-market lookup would be 120 round trips
//    behind a single swipe-deck paint.
//
// 3. The id set is CHUNKED because PostgREST puts filters in the URL. Four
//    `in.()` lists of 120 UUIDs is a ~17 KB query string, which nothing in the
//    path between here and Postgres promises to accept.
//
// 4. There are no serve/return stats to add to this file. `match_stats` is
//    Premier-tier only and these markets are fip_platinum, so a stats slot
//    would be empty on every card that exists today.

import { paginatedSelect } from '@/lib/db-paginate'
import {
  PLAYER_SLOTS,
  matchPlayerIds,
  type HeadToHead,
  type MarketRow,
  type PlayerForm,
} from './_shared'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Tuning ─────────────────────────────────────────────────────────────

/** Matches sampled for the form line. */
const FORM_SAMPLE = 5

/**
 * Fewer than this many sampled matches and `form` is null: the UI drops the
 * line rather than printing "0 of 1", which reads as a damning record when it
 * is really an absence of one.
 */
const FORM_MIN_SAMPLE = 3

/**
 * How far back the form window reaches.
 *
 * Measured, not guessed: over a 120-day window, 384 of the 406 players ranked
 * inside the top 200 have a full 5 finished matches and 387 have at least 3,
 * while the read stays around 2.4k rows for that whole set (it is 5.3k at 180
 * days and 8k unbounded). A player with fewer than three matches in four
 * months has no *recent* form, so capping the window is not only cheaper, it
 * is the more honest reading of the phrase.
 */
const FORM_WINDOW_DAYS = 120

/**
 * Players per form request. 4 columns × 25 UUIDs ≈ 3.8 KB of query string.
 */
const FORM_CHUNK = 25

/**
 * Markets per head-to-head request. The filter is an AND over all four player
 * columns, so a chunk of 8 markets means a 32-UUID set and ≈ 4.8 KB of query
 * string — and an extremely selective scan, since only historical matches
 * whose entire roster is drawn from those 32 players come back.
 */
const H2H_MARKET_CHUNK = 8

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// ── Row shapes ─────────────────────────────────────────────────────────

interface FinishedMatchRow {
  id: string
  finished_at: string | null
  winner_pair: number | null
  pair1_player1_id: string | null
  pair1_player2_id: string | null
  pair2_player1_id: string | null
  pair2_player2_id: string | null
}

const FINISHED_SELECT =
  'id, finished_at, winner_pair, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id'

/** Which pair (1 or 2) a player was on, or null if they were not in the match. */
function pairOf(row: FinishedMatchRow, playerId: string): 1 | 2 | null {
  if (row.pair1_player1_id === playerId || row.pair1_player2_id === playerId) return 1
  if (row.pair2_player1_id === playerId || row.pair2_player2_id === playerId) return 2
  return null
}

// ── Recent form ────────────────────────────────────────────────────────

/**
 * Every distinct player UUID across a page of markets, in first-seen order.
 */
export function collectPlayerIds(rows: MarketRow[]): string[] {
  const seen = new Set<string>()
  for (const row of rows) {
    for (const id of matchPlayerIds(row.match)) {
      if (id) seen.add(id)
    }
  }
  return [...seen]
}

/**
 * `playerId → form` for every player with at least FORM_MIN_SAMPLE finished
 * matches inside the window. Players below that threshold are simply absent
 * from the map, which describeMarket renders as `form: null`.
 *
 * Failure is non-fatal by design: the form line is one of three signals on the
 * card, and losing it must not cost the user the whole deck. A failed chunk
 * logs and contributes nothing.
 */
export async function fetchRecentForm(
  supabase: SupabaseClient,
  playerIds: string[],
): Promise<Map<string, PlayerForm>> {
  const out = new Map<string, PlayerForm>()
  if (playerIds.length === 0) return out

  const since = new Date(Date.now() - FORM_WINDOW_DAYS * 86_400_000).toISOString()
  /** playerId → 'W'/'L' newest-first. Rows arrive already sorted. */
  const seq = new Map<string, string[]>()

  await Promise.all(
    chunk(playerIds, FORM_CHUNK).map(async (ids) => {
      const list = `(${ids.join(',')})`
      // A chunk attributes rows ONLY to its own players. A match returned for
      // chunk 2 very often also contains a chunk-1 player — crediting it there
      // would splice chunk 2's result stream into chunk 1's, in whatever order
      // the two requests happened to land, and the "last 5" would stop being
      // the last 5. Measured: with one chunk a player read WLWWW (matching the
      // reference SQL) and with two chunks the same player read WWLLW.
      const wanted = new Set(ids)
      try {
        // Bounded by the 120-day window and the chunk's 25 players, so it
        // cannot approach the PostgREST 10k cap — paginatedSelect is still
        // used so a surprise (a very busy window) pages instead of truncating.
        const rows = await paginatedSelect<FinishedMatchRow>(
          (start, end) =>
            supabase
              .from('matches')
              .select(FINISHED_SELECT)
              .eq('status', 'finished')
              .not('winner_pair', 'is', null)
              .not('finished_at', 'is', null)
              .gte('finished_at', since)
              .or(
                PLAYER_SLOTS.map((slot) => `${slot}_id.in.${list}`).join(','),
              )
              // finished_at, never scheduled_at. See note 1 at the top.
              .order('finished_at', { ascending: false })
              // Ties are COMMON, not theoretical: fip-results-writer stamps a
              // placeholder midday timestamp, so a player routinely has two
              // matches at exactly 12:00:00Z — one won, one lost. Without a
              // second sort key their order is whatever Postgres feels like,
              // and the streak reshuffles between two reloads of the same
              // card. `id` is arbitrary but stable, which is the property we
              // actually need; the true order is not recoverable from the data.
              .order('id', { ascending: false })
              .range(start, end),
          { what: 'play form window' },
        )

        for (const row of rows) {
          if (row.winner_pair === null) continue
          for (const slot of PLAYER_SLOTS) {
            const pid = row[`${slot}_id`]
            if (!pid || !wanted.has(pid)) continue
            const bucket = seq.get(pid) ?? []
            if (bucket.length >= FORM_SAMPLE) continue
            bucket.push(pairOf(row, pid) === row.winner_pair ? 'W' : 'L')
            seq.set(pid, bucket)
          }
        }
      } catch (err) {
        console.error(
          '[play/signals] form chunk failed:',
          err instanceof Error ? err.message : String(err),
        )
      }
    }),
  )

  for (const [pid, marks] of seq) {
    if (marks.length < FORM_MIN_SAMPLE) continue
    out.set(pid, {
      wins: marks.filter((m) => m === 'W').length,
      of: marks.length,
      streak: marks.join(''),
    })
  }
  return out
}

// ── Head-to-head ───────────────────────────────────────────────────────

/** Order-independent key for a pair of player UUIDs. */
function pairKey(a: string | null, b: string | null): string | null {
  if (!a || !b) return null
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

interface H2HTarget {
  marketId: string
  matchId: string | null
  pair1Key: string
  pair2Key: string
  ids: string[]
}

/** Markets whose four player slots all resolved — the only ones h2h applies to. */
function h2hTargets(rows: MarketRow[]): H2HTarget[] {
  const out: H2HTarget[] = []
  for (const row of rows) {
    const [a, b, c, d] = matchPlayerIds(row.match)
    const pair1Key = pairKey(a ?? null, b ?? null)
    const pair2Key = pairKey(c ?? null, d ?? null)
    if (!pair1Key || !pair2Key || pair1Key === pair2Key) continue
    out.push({
      marketId: row.id,
      matchId: row.match?.id ?? null,
      pair1Key,
      pair2Key,
      ids: [a!, b!, c!, d!],
    })
  }
  return out
}

/**
 * `marketId → head-to-head`. Zeroes are a real, and frequent, answer: most of
 * these pairs have never met. A market only goes missing from the map when all
 * four players did not resolve or the lookup failed, which the UI renders as
 * "no h2h row" rather than "never met".
 *
 * Exactness: a true meeting has all four of its players inside the market, so
 * it is inside the chunk's id set, so the AND-of-four-`in` filter returns it.
 * The filter is a superset (it also returns unrelated matches assembled from
 * other markets' players in the same chunk); the signature comparison below
 * discards those.
 */
export async function fetchHeadToHead(
  supabase: SupabaseClient,
  rows: MarketRow[],
): Promise<Map<string, HeadToHead>> {
  const out = new Map<string, HeadToHead>()
  const targets = h2hTargets(rows)
  if (targets.length === 0) return out

  await Promise.all(
    chunk(targets, H2H_MARKET_CHUNK).map(async (group) => {
      const ids = [...new Set(group.flatMap((g) => g.ids))]
      try {
        const { data, error } = await supabase
          .from('matches')
          .select(FINISHED_SELECT)
          .eq('status', 'finished')
          .not('winner_pair', 'is', null)
          .in('pair1_player1_id', ids)
          .in('pair1_player2_id', ids)
          .in('pair2_player1_id', ids)
          .in('pair2_player2_id', ids)
        if (error) throw new Error(error.message)

        const history = (data ?? []) as unknown as FinishedMatchRow[]
        for (const target of group) {
          let pair1Wins = 0
          let pair2Wins = 0
          for (const row of history) {
            if (row.id === target.matchId) continue
            const rowA = pairKey(row.pair1_player1_id, row.pair1_player2_id)
            const rowB = pairKey(row.pair2_player1_id, row.pair2_player2_id)
            if (!rowA || !rowB) continue
            // The market's pair 1 may have been the historical match's pair 2.
            const straight = rowA === target.pair1Key && rowB === target.pair2Key
            const swapped = rowA === target.pair2Key && rowB === target.pair1Key
            if (!straight && !swapped) continue
            const marketPairThatWon =
              row.winner_pair === 1 ? (straight ? 1 : 2) : straight ? 2 : 1
            if (marketPairThatWon === 1) pair1Wins++
            else pair2Wins++
          }
          out.set(target.marketId, { pair1Wins, pair2Wins })
        }
      } catch (err) {
        console.error(
          '[play/signals] head-to-head chunk failed:',
          err instanceof Error ? err.message : String(err),
        )
      }
    }),
  )

  return out
}
