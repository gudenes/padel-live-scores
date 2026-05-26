// src/lib/__tests__/factsheet-mappers.test.ts
import { describe, it, expect } from 'vitest'
import { mapFactsheetPrize, type FactsheetPrizeRow } from '../factsheet-mappers'

describe('mapFactsheetPrize', () => {
  it('returns null on null / undefined / empty input', () => {
    expect(mapFactsheetPrize(null)).toBeNull()
    expect(mapFactsheetPrize(undefined)).toBeNull()
    expect(mapFactsheetPrize([])).toBeNull()
  })

  it('maps the real FIP Platinum Albania 2026 payload to canonical shape', () => {
    // Verbatim shape Claude produced for FIP Platinum Albania (queried
    // from prod factsheet_data.prize_money on 2026-05-24).
    const rows: FactsheetPrizeRow[] = [
      { round_label: 'winner',           per_player_eur: 9375,   total_pair_eur: 18750 },
      { round_label: 'finalist',         per_player_eur: 4688,   total_pair_eur: 9376 },
      { round_label: 'semifinalist',     per_player_eur: 2531,   total_pair_eur: 10124 },
      { round_label: 'quarterfinalist',  per_player_eur: 1406,   total_pair_eur: 11248 },
      { round_label: 'round_16',         per_player_eur: 750,    total_pair_eur: 12000 },
      { round_label: 'round_32',         per_player_eur: 421.88, total_pair_eur: 13500 },
      { round_label: 'last_of_qualy',    per_player_eur: null,   total_pair_eur: null },
      { round_label: 'q2',               per_player_eur: null,   total_pair_eur: null },
      { round_label: 'q1',               per_player_eur: null,   total_pair_eur: null },
    ]
    expect(mapFactsheetPrize(rows)).toEqual({
      winner: 9375,
      finalist: 4688,
      sf: 2531,
      qf: 1406,
      r16: 750,
      r32: 421.88,
      currency: 'EUR',
      per: 'player',
      source: 'factsheet_pdf',
    })
  })

  it('drops qualifying rounds even when they have a payout', () => {
    // Qualifying-tier prize_breakdown isn't modeled; these stay in
    // factsheet_data.prize_money as audit only.
    const out = mapFactsheetPrize([
      { round_label: 'q1',            per_player_eur: 100 },
      { round_label: 'q2',            per_player_eur: 150 },
      { round_label: 'last_of_qualy', per_player_eur: 200 },
      { round_label: 'winner',        per_player_eur: 9000 },
    ])
    expect(out).toMatchObject({ winner: 9000 })
    expect(out).not.toHaveProperty('q1')
    expect(out).not.toHaveProperty('q2')
    expect(out).not.toHaveProperty('last_of_qualy')
  })

  it('drops rows whose per_player_eur is null or non-numeric', () => {
    const out = mapFactsheetPrize([
      { round_label: 'winner',   per_player_eur: 9000 },
      { round_label: 'finalist', per_player_eur: null },
      { round_label: 'sf',       per_player_eur: 'oops' as unknown as number },
      { round_label: 'qf',       per_player_eur: Number.NaN },
    ])
    expect(out).toEqual({
      winner: 9000,
      currency: 'EUR',
      per: 'player',
      source: 'factsheet_pdf',
    })
  })

  it('returns null when nothing main-draw-shaped survives', () => {
    expect(
      mapFactsheetPrize([
        { round_label: 'q1', per_player_eur: 100 },
        { round_label: 'unknown_round', per_player_eur: 100 },
        { round_label: 'finalist', per_player_eur: null },
      ]),
    ).toBeNull()
  })

  it('is case-insensitive on round_label (Claude sometimes capitalizes)', () => {
    const out = mapFactsheetPrize([
      { round_label: 'WINNER',   per_player_eur: 1000 },
      { round_label: 'Round_16', per_player_eur: 500 },
    ])
    expect(out).toMatchObject({ winner: 1000, r16: 500 })
  })

  it('always tags source=factsheet_pdf for source-priority gating', () => {
    const out = mapFactsheetPrize([{ round_label: 'winner', per_player_eur: 100 }])
    expect(out?.source).toBe('factsheet_pdf')
  })

  it('supports larger draws (r64, r128) when the PDF publishes them', () => {
    const out = mapFactsheetPrize([
      { round_label: 'round_128', per_player_eur: 200 },
      { round_label: 'round_64',  per_player_eur: 300 },
      { round_label: 'winner',    per_player_eur: 50000 },
    ])
    expect(out).toMatchObject({ r128: 200, r64: 300, winner: 50000 })
  })

  it('handles malformed rows without throwing', () => {
    const out = mapFactsheetPrize([
      null as unknown as FactsheetPrizeRow,
      undefined as unknown as FactsheetPrizeRow,
      {} as FactsheetPrizeRow,
      { round_label: 'winner', per_player_eur: 100 },
    ])
    expect(out).toMatchObject({ winner: 100 })
  })
})
