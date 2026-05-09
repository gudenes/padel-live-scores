// src/app/[locale]/(app)/tournaments/[id]/bracket-builder.ts
// Pure-logic bracket-tree helpers. No React, no Supabase.

import type { Match } from '@/types/match'
import { roundCanonical } from '@/lib/round-canonical'

export type RoundCode = 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F'

export const ROUND_ORDER: RoundCode[] = ['R64', 'R32', 'R16', 'QF', 'SF', 'F']

/** Number of cells in each round, indexed by round code. */
export const ROUND_SLOTS: Record<RoundCode, number> = {
  R64: 32, R32: 16, R16: 8, QF: 4, SF: 2, F: 1,
}

export type BracketNode = {
  round: RoundCode
  positionInRound: number             // 0-based, top to bottom
  match: Match | null                 // null = upcoming/TBD slot or bye
  feedFromTop: BracketNode | null     // previous-round cell feeding top pair
  feedFromBottom: BracketNode | null  // previous-round cell feeding bottom pair
  isBye: boolean                      // true when this slot is a bye (one pair advances unopposed)
}

export type PairPath = {
  nodes: BracketNode[]            // every node where the pair appears, in round order
  eliminatedAt: RoundCode | null  // null if still active or won the tournament
}

export type DefendingChampPair = {
  player1Id: string
  player2Id: string
}

/** Stable pair identifier — order-independent, "smallerId::largerId". */
export function pairKeyFor(player1Id: string, player2Id: string): string {
  return player1Id < player2Id
    ? `${player1Id}::${player2Id}`
    : `${player2Id}::${player1Id}`
}

/**
 * Build a structured bracket tree from a flat list of matches.
 *
 * - `drawSize` is the number of pairs in the first round (16, 32, 64).
 * - Sorts matches by canonical round + draw_position.
 * - Returns one BracketNode per slot in the bracket. Missing matches
 *   produce placeholder nodes with `match: null`.
 * - A slot in round N+1 is a bye when neither of its two feeding round-N
 *   slots has a match — the seed advances unopposed.
 */
export function buildBracket(matches: Match[], drawSize: number): BracketNode[] {
  // Determine which rounds belong to this bracket size.
  // 16 → R16/QF/SF/F, 32 → R32/R16/QF/SF/F, 64 → R64/R32/R16/QF/SF/F.
  const startIdx = drawSize === 64 ? 0 : drawSize === 32 ? 1 : 2
  const rounds = ROUND_ORDER.slice(startIdx)

  // Group matches by canonical round. Position within a round is derived
  // by sorting on a stable signal: prefer `draw_position` when set
  // (FIP-populated rows), then `widget_id_composite` (Crionet
  // brackets carry the canonical order in their widget code, e.g.
  // WD006 < WD007), then `external_id` as a last resort. The matches
  // table has no dedicated `draw_position` column today.
  const matchesByRound = new Map<RoundCode, Match[]>()
  for (const m of matches) {
    const r = roundCanonical(m.round) as RoundCode | null
    if (!r || !rounds.includes(r)) continue
    const list = matchesByRound.get(r) ?? []
    list.push(m)
    matchesByRound.set(r, list)
  }
  for (const list of matchesByRound.values()) {
    list.sort(stableMatchSort)
  }

  // Determine bracket position for each first-round match. This is the
  // crucial bit for tournaments with byes: we can't use the sort index
  // directly (that packs matches into 0..N-1 and leaves the byes
  // dangling at the bottom), so instead we walk the NEXT round and place
  // each first-round match at the slot whose pair it feeds.
  //
  // Convention: even pos (0, 2, 4…) feeds pair1 of the next-round cell,
  // odd pos feeds pair2. This mirrors padelgod's fip-draw-populator,
  // which assigns Crionet's team1 → pair1 and team2 → pair2.
  const firstRound = rounds[0]
  const nextRound = rounds[1]
  const firstRoundByPos = new Map<number, Match>()
  const firstRoundUnplaced = new Set<Match>(matchesByRound.get(firstRound) ?? [])

  if (nextRound) {
    const nextMatches = matchesByRound.get(nextRound) ?? []
    for (let j = 0; j < nextMatches.length; j++) {
      const m = nextMatches[j]
      const topFeed = findFeedingMatch(firstRoundUnplaced, m.pair1_player1, m.pair1_player2)
      if (topFeed) {
        firstRoundByPos.set(2 * j, topFeed)
        firstRoundUnplaced.delete(topFeed)
      }
      const botFeed = findFeedingMatch(firstRoundUnplaced, m.pair2_player1, m.pair2_player2)
      if (botFeed) {
        firstRoundByPos.set(2 * j + 1, botFeed)
        firstRoundUnplaced.delete(botFeed)
      }
    }
  }

  // Fallback: any first-round matches we couldn't link via player IDs
  // (next round empty, or players not yet resolved) fill the remaining
  // empty slots in sort order. This preserves the old behavior on
  // tournaments where the next round hasn't been drawn yet.
  let fallbackPos = 0
  const firstSlotCount = ROUND_SLOTS[firstRound]
  for (const m of firstRoundUnplaced) {
    while (fallbackPos < firstSlotCount && firstRoundByPos.has(fallbackPos)) fallbackPos++
    if (fallbackPos >= firstSlotCount) break
    firstRoundByPos.set(fallbackPos, m)
    fallbackPos++
  }

  // Build nodes round by round so we can wire feedFromTop/Bottom on the fly.
  const nodesByRound = new Map<RoundCode, BracketNode[]>()
  for (const round of rounds) {
    const slotCount = ROUND_SLOTS[round]
    const sorted = matchesByRound.get(round) ?? []
    const nodes: BracketNode[] = []
    const prevRound = ROUND_ORDER[ROUND_ORDER.indexOf(round) - 1]
    const prevNodes = prevRound ? nodesByRound.get(prevRound) ?? [] : []

    for (let pos = 0; pos < slotCount; pos++) {
      const match = round === firstRound
        ? firstRoundByPos.get(pos) ?? null
        : sorted[pos] ?? null
      const feedFromTop = prevNodes[pos * 2] ?? null
      const feedFromBottom = prevNodes[pos * 2 + 1] ?? null
      nodes.push({
        round, positionInRound: pos, match,
        feedFromTop, feedFromBottom,
        isBye: false,
      })
    }
    nodesByRound.set(round, nodes)
  }

  // Mark byes: a slot in the FIRST round is a bye when its corresponding
  // next-round cell has a real pair on its side but no match here.
  if (nextRound) {
    const firstNodes = nodesByRound.get(firstRound)!
    const nextNodes = nodesByRound.get(nextRound)!
    for (let pos = 0; pos < firstNodes.length; pos++) {
      const node = firstNodes[pos]
      if (node.match) continue
      const nextCell = nextNodes[Math.floor(pos / 2)]
      if (!nextCell?.match) continue
      const isTopFeed = pos % 2 === 0
      const sideHasPair = isTopFeed
        ? nextCell.match.pair1_player1 != null
        : nextCell.match.pair2_player1 != null
      if (sideHasPair) node.isBye = true
    }
  }

  return rounds.flatMap(r => nodesByRound.get(r)!)
}

/** Stable per-round match ordering — see comment in buildBracket. */
function stableMatchSort(a: Match, b: Match): number {
  const ap = a.draw_position
  const bp = b.draw_position
  if (typeof ap === 'number' && typeof bp === 'number') return ap - bp
  if (typeof ap === 'number') return -1
  if (typeof bp === 'number') return 1
  const aw = (a as { widget_id_composite?: string | null }).widget_id_composite ?? ''
  const bw = (b as { widget_id_composite?: string | null }).widget_id_composite ?? ''
  if (aw && bw && aw !== bw) return aw < bw ? -1 : 1
  return (a.external_id ?? '').localeCompare(b.external_id ?? '')
}

/**
 * Find the match in `pool` whose pair1 or pair2 matches the given pair
 * (both player IDs present on the same side). Returns the first match
 * found; pool is iterated in insertion order.
 *
 * Used to derive first-round bracket positions from next-round
 * matchups: a next-round match at position j has pair1 fed by the
 * winner of the first-round match at position 2j, etc. Matching by
 * player IDs is robust even when widget order doesn't reflect bracket
 * order (e.g., bye-induced gaps in widget IDs).
 */
function findFeedingMatch(
  pool: Iterable<Match>,
  p1: { id?: string | null } | null | undefined,
  p2: { id?: string | null } | null | undefined,
): Match | undefined {
  const id1 = p1?.id, id2 = p2?.id
  if (!id1 || !id2) return undefined
  for (const m of pool) {
    const a1 = m.pair1_player1?.id, a2 = m.pair1_player2?.id
    const b1 = m.pair2_player1?.id, b2 = m.pair2_player2?.id
    const inPair1 =
      ((id1 === a1 && id2 === a2) || (id1 === a2 && id2 === a1))
    const inPair2 =
      ((id1 === b1 && id2 === b2) || (id1 === b2 && id2 === b1))
    if (inPair1 || inPair2) return m
  }
  return undefined
}

/**
 * Walk the bracket and return every node where the given pair appears,
 * in round order, plus the round where they were eliminated.
 *
 * - A pair is "in" a node when both of its player IDs appear in either
 *   the pair1 or pair2 slot of that node's match.
 * - eliminatedAt is null when the pair won the tournament OR is still active.
 *   To distinguish: if the last node has winner_pair set AND winner_pair's
 *   players match the tracked pair, they're a champion. Otherwise they
 *   were eliminated at the last node's round.
 */
export function tracePairPath(
  bracket: BracketNode[],
  pairKey: string | null,
): PairPath {
  if (!pairKey) return { nodes: [], eliminatedAt: null }

  const nodes: BracketNode[] = []
  for (const node of bracket) {
    const m = node.match
    if (!m) continue
    const p1Key = m.pair1_player1?.id && m.pair1_player2?.id
      ? pairKeyFor(m.pair1_player1.id, m.pair1_player2.id)
      : null
    const p2Key = m.pair2_player1?.id && m.pair2_player2?.id
      ? pairKeyFor(m.pair2_player1.id, m.pair2_player2.id)
      : null
    if (p1Key === pairKey || p2Key === pairKey) {
      nodes.push(node)
    }
  }

  if (nodes.length === 0) return { nodes: [], eliminatedAt: null }

  const last = nodes[nodes.length - 1]
  const m = last.match!
  const wonLast =
    m.winner_pair === 1
      ? m.pair1_player1?.id && m.pair1_player2?.id &&
        pairKeyFor(m.pair1_player1.id, m.pair1_player2.id) === pairKey
      : m.winner_pair === 2
      ? m.pair2_player1?.id && m.pair2_player2?.id &&
        pairKeyFor(m.pair2_player1.id, m.pair2_player2.id) === pairKey
      : null

  // If they won the final, no elimination round.
  if (last.round === 'F' && wonLast) return { nodes, eliminatedAt: null }
  // If they won their last node but it wasn't the final, they're still
  // active (next round hasn't happened yet) — no elimination.
  if (wonLast) return { nodes, eliminatedAt: null }
  // If winner_pair is null (match not finished), they're still active.
  if (m.winner_pair == null) return { nodes, eliminatedAt: null }
  // Otherwise they lost their last match → eliminated at that round.
  return { nodes, eliminatedAt: last.round }
}

/**
 * Resolve the default tracked pair for a draw.
 *
 * Priority:
 * 1. A pair containing one of `bookmarkedPlayerIds`. If multiple pairs
 *    qualify, prefer the one with the lowest seed number (most-seeded).
 *    If none of the candidate pairs are seeded, prefer the pair whose
 *    first player has the alphabetically-first surname (deterministic).
 * 2. The pair containing both `defendingChampPair` players (exact match).
 * 3. null.
 */
export function defaultTrackedPair(
  bracket: BracketNode[],
  bookmarkedPlayerIds: string[],
  defendingChampPair: DefendingChampPair | null,
): string | null {
  // Collect every distinct pair that appears in the bracket and what we
  // know about them (seed and lastname).
  type PairInfo = {
    key: string
    playerIds: string[]
    seed: number | null
    sortName: string  // for the deterministic tiebreak
  }
  const seen = new Map<string, PairInfo>()
  for (const node of bracket) {
    const m = node.match
    if (!m) continue
    for (const side of [1, 2] as const) {
      const p1 = side === 1 ? m.pair1_player1 : m.pair2_player1
      const p2 = side === 1 ? m.pair1_player2 : m.pair2_player2
      const seed = side === 1 ? m.pair1_seed : m.pair2_seed
      if (!p1?.id || !p2?.id) continue
      const key = pairKeyFor(p1.id, p2.id)
      if (seen.has(key)) continue
      const sortName = (p1.name ?? '').toLowerCase()
      seen.set(key, { key, playerIds: [p1.id, p2.id], seed: seed ?? null, sortName })
    }
  }

  // 1. Bookmarked-player match
  const bookmarked = new Set(bookmarkedPlayerIds)
  const bookmarkCandidates = [...seen.values()].filter(p =>
    p.playerIds.some(id => bookmarked.has(id)),
  )
  if (bookmarkCandidates.length > 0) {
    bookmarkCandidates.sort((a, b) => {
      const aSeed = a.seed ?? Number.POSITIVE_INFINITY
      const bSeed = b.seed ?? Number.POSITIVE_INFINITY
      if (aSeed !== bSeed) return aSeed - bSeed
      return a.sortName.localeCompare(b.sortName)
    })
    return bookmarkCandidates[0].key
  }

  // 2. Defending champion (exact pair match)
  if (defendingChampPair) {
    const champKey = pairKeyFor(defendingChampPair.player1Id, defendingChampPair.player2Id)
    if (seen.has(champKey)) return champKey
  }

  return null
}
