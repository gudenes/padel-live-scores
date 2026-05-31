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
  /** When `isBye`, this is the seeded pair walking the bye — resolved
   *  from the corresponding next-round cell so the UI can show
   *  "Coello/Tapia [BYE]" instead of an opaque "— BYE —" placeholder.
   *  Null for non-bye slots. */
  byePair: {
    player1: NonNullable<Match['pair1_player1']>
    player2: NonNullable<Match['pair1_player2']>
    seed: number | null
  } | null
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
  const firstSlotCount = ROUND_SLOTS[firstRound]
  const firstRoundByPos = new Map<number, Match>()
  const firstRoundUnplaced = new Set<Match>(matchesByRound.get(firstRound) ?? [])

  // Pass 0: widget heap index — authoritative when present. FIP/Crionet
  // widget codes (e.g. "FIP-2026-2801:MD034", "…:WD034") embed the bracket
  // node's heap number: MD001 is the final, R32 cells are MD016..MD031,
  // R64 cells MD032..MD063. A round with `slotCount` cells occupies heap
  // nodes [slotCount, 2*slotCount-1], so the first-round slot is
  // `heapNum - slotCount`. This places matches at their true bracket
  // position directly, without depending on next-round player-linking —
  // which can't fire before the round is played (every next-round winner
  // side is still TBD/null). The player-link + fallback passes below then
  // handle only widget-less (OOP-sourced) matches.
  for (const m of [...firstRoundUnplaced]) {
    const num = widgetHeapNumber(m)
    if (num == null) continue
    const slot = num - firstSlotCount
    if (slot < 0 || slot >= firstSlotCount || firstRoundByPos.has(slot)) continue
    firstRoundByPos.set(slot, m)
    firstRoundUnplaced.delete(m)
  }

  if (nextRound) {
    const nextMatches = matchesByRound.get(nextRound) ?? []
    for (let j = 0; j < nextMatches.length; j++) {
      const m = nextMatches[j]
      // Seed-bye detection: a seeded pair with the opposite side fully empty
      // is a bye. Pass 1 (exact UUID) still runs — it catches carry-forward
      // seeds whose feeder DID play in the previous round. But Pass 2 (name
      // tokens) is skipped, because common Spanish first names (Juan, Javier,
      // Jose, Gabriel, Maximiliano …) shared with unrelated previous-round
      // players were falsely linking seeds to non-feeders, displacing the bye
      // marker and orphaning a slot elsewhere as "Winner of TBD".
      const topIsSeedBye =
        m.pair1_seed != null && !m.pair2_player1 && !m.pair2_player2
      const botIsSeedBye =
        m.pair2_seed != null && !m.pair1_player1 && !m.pair1_player2
      const topFeed = findFeedingMatch(
        firstRoundUnplaced, m.pair1_player1, m.pair1_player2,
        { skipNameFallback: topIsSeedBye },
      )
      if (topFeed && !firstRoundByPos.has(2 * j)) {
        firstRoundByPos.set(2 * j, topFeed)
        firstRoundUnplaced.delete(topFeed)
      }
      const botFeed = findFeedingMatch(
        firstRoundUnplaced, m.pair2_player1, m.pair2_player2,
        { skipNameFallback: botIsSeedBye },
      )
      if (botFeed && !firstRoundByPos.has(2 * j + 1)) {
        firstRoundByPos.set(2 * j + 1, botFeed)
        firstRoundUnplaced.delete(botFeed)
      }
    }
  }

  // Fallback for first-round matches that couldn't be linked via
  // players (most often: next round hasn't been drawn yet, OR upstream
  // dedup left duplicate player records and the name-pass missed too).
  //
  // CRITICAL: only fill positions that aren't already byes. A "bye"
  // here is a position whose corresponding next-round cell has a real
  // pair on the relevant side (top or bottom). Filling those would
  // overwrite a seed's bye walk-through with the wrong R32 match.
  //
  // When the next round isn't drawn at all, every empty slot is fair
  // game — that's the original "no bracket yet" path.
  const isLikelyBye = (pos: number): boolean => {
    if (!nextRound) return false
    const nextMatches = matchesByRound.get(nextRound) ?? []
    const nextCell = nextMatches[Math.floor(pos / 2)]
    if (!nextCell) return false
    const isTopFeed = pos % 2 === 0
    const sidePlayer = isTopFeed ? nextCell.pair1_player1 : nextCell.pair2_player1
    return sidePlayer != null
  }
  let fallbackPos = 0
  for (const m of firstRoundUnplaced) {
    while (
      fallbackPos < firstSlotCount &&
      (firstRoundByPos.has(fallbackPos) || isLikelyBye(fallbackPos))
    ) {
      fallbackPos++
    }
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
        byePair: null,
      })
    }
    nodesByRound.set(round, nodes)
  }

  // Mark byes: a slot in the FIRST round is a bye when its corresponding
  // next-round cell has a real pair on its side but no match here. Pull
  // the seeded pair off the next-round cell so the UI can render
  // "Coello/Tapia [BYE]" instead of "— BYE —".
  if (nextRound) {
    const firstNodes = nodesByRound.get(firstRound)!
    const nextNodes = nodesByRound.get(nextRound)!
    for (let pos = 0; pos < firstNodes.length; pos++) {
      const node = firstNodes[pos]
      if (node.match) continue
      const nextCell = nextNodes[Math.floor(pos / 2)]
      if (!nextCell?.match) continue
      const isTopFeed = pos % 2 === 0
      const p1 = isTopFeed ? nextCell.match.pair1_player1 : nextCell.match.pair2_player1
      const p2 = isTopFeed ? nextCell.match.pair1_player2 : nextCell.match.pair2_player2
      const seed = isTopFeed ? nextCell.match.pair1_seed : nextCell.match.pair2_seed
      if (p1 && p2) {
        node.isBye = true
        node.byePair = { player1: p1, player2: p2, seed: seed ?? null }
      }
    }
  }

  return rounds.flatMap(r => nodesByRound.get(r)!)
}

/** Stable per-round match ordering — see comment in buildBracket.
 *
 * When matches lack `draw_position` (the common case for OOP-sourced
 * matches that landed before the bracket scrape — Buenos Aires P1 R64
 * the day before the draw publishes), fall through a chain of stable
 * tiebreakers so the same match always lands in the same cell across
 * reloads. The `id` (UUID) terminal key guarantees determinism even
 * when widget_id_composite + external_id are both null. */
function stableMatchSort(a: Match, b: Match): number {
  const ap = a.draw_position
  const bp = b.draw_position
  if (typeof ap === 'number' && typeof bp === 'number') return ap - bp
  if (typeof ap === 'number') return -1
  if (typeof bp === 'number') return 1
  const aw = (a as { widget_id_composite?: string | null }).widget_id_composite ?? ''
  const bw = (b as { widget_id_composite?: string | null }).widget_id_composite ?? ''
  if (aw && bw && aw !== bw) return aw < bw ? -1 : 1
  const ae = a.external_id ?? ''
  const be = b.external_id ?? ''
  if (ae !== be) return ae.localeCompare(be)
  return (a.id ?? '').localeCompare(b.id ?? '')
}

/**
 * Find the match in `pool` whose pair1 or pair2 matches the given pair.
 * First tries exact ID match (the common case), then falls back to a
 * name-token match — a defensive workaround for player records that
 * got duplicated across rounds (e.g., "Nuria Rodriguez" with one fip_id
 * in R32 and "Nuria Camacho" with a different fip_id in R16, both
 * referring to the same person Nuria Rodriguez Camacho).
 *
 * Used to derive first-round bracket positions from next-round
 * matchups: a next-round match at position j has pair1 fed by the
 * winner of the first-round match at position 2j, etc. Matching only
 * via player UUIDs would silently misplace matches whenever upstream
 * dedup hasn't merged a duplicate player.
 */
type PlayerLike = { id?: string | null; name?: string | null } | null | undefined

function findFeedingMatch(
  pool: Iterable<Match>,
  p1: PlayerLike,
  p2: PlayerLike,
  opts: { skipNameFallback?: boolean } = {},
): Match | undefined {
  const id1 = p1?.id, id2 = p2?.id
  // Pass 1: exact UUID match on either side of an R32 match.
  if (id1 && id2) {
    for (const m of pool) {
      const a1 = m.pair1_player1?.id, a2 = m.pair1_player2?.id
      const b1 = m.pair2_player1?.id, b2 = m.pair2_player2?.id
      const inPair1 =
        ((id1 === a1 && id2 === a2) || (id1 === a2 && id2 === a1))
      const inPair2 =
        ((id1 === b1 && id2 === b2) || (id1 === b2 && id2 === b1))
      if (inPair1 || inPair2) return m
    }
  }
  // Pass 2: name-token fallback. Each target must have at least one
  // distinctive name token (>= 4 chars) that overlaps with a different
  // candidate's tokens. Two different targets must match two different
  // candidates so a single shared first name (e.g. "Nuria") doesn't
  // collapse a pair.
  //
  // `skipNameFallback` is set by the caller when the target pair is a
  // seed-bye (seeded pair with the opposite side fully TBD). For those,
  // there can't be a real feeder match — and shared first names (Juan,
  // Javier, Jose …) would otherwise produce a false positive that
  // displaces the bye marker.
  if (opts.skipNameFallback) return undefined
  const t1 = nameTokens(p1?.name)
  const t2 = nameTokens(p2?.name)
  if (t1.size === 0 || t2.size === 0) return undefined
  for (const m of pool) {
    for (const side of [1, 2] as const) {
      const c1 = side === 1 ? m.pair1_player1 : m.pair2_player1
      const c2 = side === 1 ? m.pair1_player2 : m.pair2_player2
      const ct1 = nameTokens(c1?.name)
      const ct2 = nameTokens(c2?.name)
      if (ct1.size === 0 || ct2.size === 0) continue
      // Try both orderings — pair members aren't intrinsically ordered.
      const a = hasOverlap(t1, ct1) && hasOverlap(t2, ct2)
      const b = hasOverlap(t1, ct2) && hasOverlap(t2, ct1)
      if (a || b) return m
    }
  }
  return undefined
}

/** Parse the binary-heap node number out of a FIP/Crionet widget code,
 *  e.g. "FIP-2026-2801:MD034" → 34, "…:WD007" → 7. Returns null when the
 *  match has no widget code or it doesn't end in an MD/WD-prefixed number. */
function widgetHeapNumber(m: Match): number | null {
  const w = (m as { widget_id_composite?: string | null }).widget_id_composite
  if (!w) return null
  const hit = /[MW]D(\d+)$/.exec(w)
  if (!hit) return null
  const n = parseInt(hit[1], 10)
  return Number.isFinite(n) ? n : null
}

function nameTokens(name: string | null | undefined): Set<string> {
  if (!name) return new Set()
  return new Set(
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[\s\-']+/)
      .filter(t => t.length >= 4),
  )
}

function hasOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const t of a) if (b.has(t)) return true
  return false
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
    if (m) {
      const p1Key = m.pair1_player1?.id && m.pair1_player2?.id
        ? pairKeyFor(m.pair1_player1.id, m.pair1_player2.id)
        : null
      const p2Key = m.pair2_player1?.id && m.pair2_player2?.id
        ? pairKeyFor(m.pair2_player1.id, m.pair2_player2.id)
        : null
      if (p1Key === pairKey || p2Key === pairKey) {
        nodes.push(node)
      }
    } else if (node.isBye && node.byePair) {
      // The bye slot is a "match" the seeded pair won unopposed — count
      // it on the tracked path so the UI highlights it like any other
      // round the pair walked through.
      const byeKey = pairKeyFor(node.byePair.player1.id, node.byePair.player2.id)
      if (byeKey === pairKey) {
        nodes.push(node)
      }
    }
  }

  if (nodes.length === 0) return { nodes: [], eliminatedAt: null }

  const last = nodes[nodes.length - 1]
  // Bye nodes don't have a real match — but they always represent the
  // seed advancing unopposed, so treat the last node like a "win" and
  // wait to see if a later round shows the pair.
  if (last.isBye) return { nodes, eliminatedAt: null }
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
