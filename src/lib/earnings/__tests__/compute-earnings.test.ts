import { describe, it, expect } from 'vitest'
import { computeEarningsForTournament, findPlayerTermini } from '../compute-earnings'
import type { MatchInput, TournamentInput } from '../types'

// Synthetic 4-pair tournament:
//   Pair A (players a1, a2)
//   Pair B (players b1, b2)
//   Pair C (players c1, c2)
//   Pair D (players d1, d2)
//
//   SF1: A vs B → A wins
//   SF2: C vs D → C wins
//   F:   A vs C → A wins (tournament champion)
//
// Expected earnings (P2 men):
//   a1, a2 → F winner (€13,960)
//   c1, c2 → F finalist (€8,205)
//   b1, b2 → SF loser (€4,515)
//   d1, d2 → SF loser (€4,515)

const T_PROTO = '2026-04-01T'
const SF1: MatchInput = {
  id: 'm-sf1', category: 'men', round_canonical: 'SF',
  pair1_player1_id: 'a1', pair1_player2_id: 'a2',
  pair2_player1_id: 'b1', pair2_player2_id: 'b2',
  winner_pair: 1, finished_at: T_PROTO + '12:00:00Z',
}
const SF2: MatchInput = {
  id: 'm-sf2', category: 'men', round_canonical: 'SF',
  pair1_player1_id: 'c1', pair1_player2_id: 'c2',
  pair2_player1_id: 'd1', pair2_player2_id: 'd2',
  winner_pair: 1, finished_at: T_PROTO + '14:00:00Z',
}
const FINAL: MatchInput = {
  id: 'm-f', category: 'men', round_canonical: 'F',
  pair1_player1_id: 'a1', pair1_player2_id: 'a2',
  pair2_player1_id: 'c1', pair2_player2_id: 'c2',
  winner_pair: 1, finished_at: T_PROTO + '17:00:00Z',
}

describe('findPlayerTermini', () => {
  it('finds the deepest round per player', () => {
    const t = findPlayerTermini([SF1, SF2, FINAL])
    const byId = new Map(t.map(x => [x.player_id, x]))

    // a1 played SF and F — terminal = F, won
    expect(byId.get('a1')?.terminal_round).toBe('F')
    expect(byId.get('a1')?.is_winner).toBe(true)

    // c1 played SF and F — terminal = F, lost
    expect(byId.get('c1')?.terminal_round).toBe('F')
    expect(byId.get('c1')?.is_winner).toBe(false)

    // b1 only played SF1, lost
    expect(byId.get('b1')?.terminal_round).toBe('SF')
    expect(byId.get('b1')?.is_winner).toBe(false)

    // 8 players total
    expect(t).toHaveLength(8)
  })

  it('skips matches with null round_canonical', () => {
    const odd: MatchInput = { ...SF1, round_canonical: null, id: 'm-odd' }
    const t = findPlayerTermini([odd])
    expect(t).toHaveLength(0)
  })

  it('skips matches with null winner_pair', () => {
    const odd: MatchInput = { ...SF1, winner_pair: null, id: 'm-odd' }
    const t = findPlayerTermini([odd])
    expect(t).toHaveLength(0)
  })

  it('skips slots with null player_id', () => {
    const partial: MatchInput = {
      ...SF1,
      pair2_player1_id: null,  // b1 missing
      pair2_player2_id: null,  // b2 missing
    }
    const t = findPlayerTermini([partial])
    const ids = t.map(x => x.player_id).sort()
    expect(ids).toEqual(['a1', 'a2'])
  })
})

describe('computeEarningsForTournament — Premier P2 path', () => {
  const tournament: TournamentInput = {
    id: 'tn-1', level: 'p2',
    prize_money_eur: 264_534,            // not used for Premier
    prize_breakdown: null,
    ends_at: '2026-04-30T00:00:00Z',
  }

  it('produces 8 rows with correct amounts and source = premier_rulebook', () => {
    const rows = computeEarningsForTournament(tournament, [SF1, SF2, FINAL])
    expect(rows).toHaveLength(8)

    const byPlayer = new Map(rows.map(r => [r.player_id, r]))
    expect(byPlayer.get('a1')?.per_player_eur).toBe(13_960)  // P2 M winner
    expect(byPlayer.get('c1')?.per_player_eur).toBe(8_205)   // P2 M finalist
    expect(byPlayer.get('b1')?.per_player_eur).toBe(4_515)   // P2 M SF loser
    expect(byPlayer.get('d1')?.per_player_eur).toBe(4_515)   // P2 M SF loser

    for (const r of rows) {
      expect(r.source).toBe('premier_rulebook')
      expect(r.tournament_id).toBe('tn-1')
      expect(r.category).toBe('men')
      // All rows share the tournament's ends_at, not per-match finished_at.
      // Previously this was t.earned_at (from match.finished_at) — now canonical.
      expect(r.earned_at).toBe('2026-04-30T00:00:00Z')
    }
  })

  it('skips when tournament.ends_at is null', () => {
    const tn: TournamentInput = { id: 'tn-x', level: 'p2', prize_money_eur: null, prize_breakdown: null, ends_at: null }
    expect(computeEarningsForTournament(tn, [SF1, SF2, FINAL])).toHaveLength(0)
  })
})

describe('computeEarningsForTournament — FIP Tour path with scraped breakdown', () => {
  const tournament: TournamentInput = {
    id: 'tn-2', level: 'fip_silver',
    prize_money_eur: 16_024,
    prize_breakdown: {
      winner: 1_600, finalist: 800, sf: 425, qf: 211, r16: 113,
      per: 'player', currency: 'EUR', source: 'scraped',
    },
    ends_at: '2026-04-30T00:00:00Z',
  }

  it('uses scraped values, source = fip_breakdown_scraped', () => {
    const rows = computeEarningsForTournament(tournament, [SF1, SF2, FINAL])
    const byPlayer = new Map(rows.map(r => [r.player_id, r]))
    expect(byPlayer.get('a1')?.per_player_eur).toBe(1_600)
    expect(byPlayer.get('c1')?.per_player_eur).toBe(800)
    expect(byPlayer.get('b1')?.per_player_eur).toBe(425)

    for (const r of rows) expect(r.source).toBe('fip_breakdown_scraped')
  })
})

describe('computeEarningsForTournament — FIP Tour fallback to rulebook %', () => {
  const tournament: TournamentInput = {
    id: 'tn-3', level: 'fip_silver',
    prize_money_eur: 16_024,
    prize_breakdown: null,  // no scrape
    ends_at: '2026-04-30T00:00:00Z',
  }

  it('falls back to rulebook %, source = fip_tour_rulebook_pct', () => {
    const rows = computeEarningsForTournament(tournament, [SF1, SF2, FINAL])
    const byPlayer = new Map(rows.map(r => [r.player_id, r]))
    // SF loser: 0.1296 × 16024 / 4 ≈ €519
    expect(byPlayer.get('b1')?.per_player_eur).toBe(519)
    for (const r of rows) expect(r.source).toBe('fip_tour_rulebook_pct')
  })
})

describe('computeEarningsForTournament — out-of-scope tiers produce no rows', () => {
  it('fip_beyond → 0 rows', () => {
    const tn: TournamentInput = { id: 'tn-4', level: 'fip_beyond', prize_money_eur: null, prize_breakdown: null, ends_at: '2026-04-30T00:00:00Z' }
    expect(computeEarningsForTournament(tn, [SF1, SF2, FINAL])).toHaveLength(0)
  })

  it('fip_promises → 0 rows', () => {
    const tn: TournamentInput = { id: 'tn-5', level: 'fip_promises', prize_money_eur: 5_000, prize_breakdown: null, ends_at: '2026-04-30T00:00:00Z' }
    expect(computeEarningsForTournament(tn, [SF1, SF2, FINAL])).toHaveLength(0)
  })

  it('unknown level → 0 rows', () => {
    const tn: TournamentInput = { id: 'tn-6', level: 'something_weird', prize_money_eur: 100_000, prize_breakdown: null, ends_at: '2026-04-30T00:00:00Z' }
    expect(computeEarningsForTournament(tn, [SF1, SF2, FINAL])).toHaveLength(0)
  })
})

describe('computeEarningsForTournament — separates men and women categories', () => {
  const wFinal: MatchInput = {
    ...FINAL,
    id: 'm-f-w', category: 'women',
    pair1_player1_id: 'wa1', pair1_player2_id: 'wa2',
    pair2_player1_id: 'wc1', pair2_player2_id: 'wc2',
  }
  const wSf: MatchInput = {
    ...SF1,
    id: 'm-sf-w', category: 'women',
    pair1_player1_id: 'wa1', pair1_player2_id: 'wa2',
    pair2_player1_id: 'wb1', pair2_player2_id: 'wb2',
  }

  const tournament: TournamentInput = {
    id: 'tn-7', level: 'p2', prize_money_eur: null, prize_breakdown: null, ends_at: '2026-04-30T00:00:00Z',
  }

  it('produces separate rows per category with correct gender amounts', () => {
    const rows = computeEarningsForTournament(tournament, [SF1, SF2, FINAL, wSf, wFinal])
    const m = rows.find(r => r.player_id === 'a1')
    const w = rows.find(r => r.player_id === 'wa1')
    expect(m?.per_player_eur).toBe(13_960)  // P2 men's winner
    expect(w?.per_player_eur).toBe(11_000)  // P2 women's winner
  })
})
