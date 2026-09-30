import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMatchDom } from '../lib/ppl-match-parse'
import type { RawMatchDom } from '../lib/ppl-match-dom'

// Captured from production 2026-09-23:
// Toronto Polar Bears (Aguilar / Montes Cabruja) lost 7-6, 0-6, 7-10 to
// San Diego Stingrays (Manquillo / Sainz). Duration 01:33:47.
const RAW: RawMatchDom = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/ppl-match-la-d3-m2-womens.json'), 'utf8'),
)

describe('parseMatchDom', () => {
  const r = parseMatchDom(RAW)

  it('reads both pairs with their team and a slug for every player', () => {
    expect(r.pairs).toHaveLength(2)
    for (const pair of r.pairs) {
      expect(pair.team).toBeTruthy()
      expect(pair.players).toHaveLength(2)
      for (const p of pair.players) expect(p.slug).toMatch(/^[a-z0-9-]+$/)
    }
  })

  it('assigns players to the pair whose team they belong to', () => {
    const sd = r.pairs.find((p) => /stingrays/i.test(p.team!))!
    expect(sd.players.map((p) => p.slug).sort()).toEqual(['letizia-manquillo', 'lucia-sainz'])
    const tor = r.pairs.find((p) => /toronto/i.test(p.team!))!
    expect(tor.players.map((p) => p.slug).sort()).toEqual(['jana-montes-cabruja', 'noemi-aguilar'])
  })

  it('marks exactly one winning pair', () => {
    expect(r.pairs.filter((p) => p.won)).toHaveLength(1)
    expect(r.pairs.find((p) => p.won)!.team).toMatch(/stingrays/i)
  })

  it('reads the sets, excluding the W/L cell', () => {
    expect(r.sets).toEqual([
      { setNumber: 1, row0: 7, row1: 6 },
      { setNumber: 2, row0: 0, row1: 6 },
      { setNumber: 3, row0: 7, row1: 10 },
    ])
  })

  it('reads the duration in seconds', () => {
    expect(r.durationSeconds).toBe(1 * 3600 + 33 * 60 + 47)
  })

  it('knows the match is final', () => {
    expect(r.isFinal).toBe(true)
  })

  it('reads the five match statistics as home/away percentages', () => {
    expect(r.stats).toMatchObject({
      pointsWonPct: { row0: 43, row1: 57 },
      servesWonPct: { row0: 46, row1: 60 },
      breakPointsConvertedPct: { row0: 40, row1: 54 },
      goldenPointsWonPct: { row0: 67, row1: 33 },
      longRalliesWonPct: { row0: 48, row1: 52 },
    })
  })

  it('reads per-player serve and shot counts', () => {
    const manquillo = r.pairs.flatMap((p) => p.players).find((p) => p.slug === 'letizia-manquillo')!
    expect(manquillo.firstServeInPct).toBe(97)
    expect(manquillo.aces).toBe(0)
    expect(manquillo.doubleFaults).toBe(0)
    expect(manquillo.winners).toMatchObject({
      smash: 11, bandeja: 0, volley: 6, vibora: 1, ground: 0, lob: 0, other: 1,
    })
  })

  it('never invents a slug it did not find', () => {
    const stripped: RawMatchDom = { ...RAW, playerCards: RAW.playerCards.map((c) => ({ ...c, slug: null })) }
    expect(() => parseMatchDom(stripped)).toThrow(/slug/i)
  })

  it('refuses a scoreboard that is not exactly two rows', () => {
    expect(() => parseMatchDom({ ...RAW, scoreRows: [RAW.scoreRows[0]] })).toThrow(/2 score rows/)
  })

  it('refuses when no row is marked the winner', () => {
    const noWinner: RawMatchDom = {
      ...RAW,
      scoreRows: RAW.scoreRows.map((r0) => ({ ...r0, winner: false })),
    }
    expect(() => parseMatchDom(noWinner)).toThrow(/one winning/)
  })

  it('refuses a player card whose team matches neither pair', () => {
    const orphan: RawMatchDom = {
      ...RAW,
      playerCards: RAW.playerCards.map((c, i) =>
        i === 0 ? { ...c, team: 'Mexico Waves', text: (c.text ?? '').replace(/^[^|]*/, 'MEXICO WAVES') } : c,
      ),
    }
    expect(() => parseMatchDom(orphan)).toThrow(/neither pair/)
  })

  it('handles a two-set match without assuming three', () => {
    const twoSets: RawMatchDom = {
      ...RAW,
      scoreRows: RAW.scoreRows.map((r0) => ({
        ...r0,
        cells: [r0.cells[0], r0.cells[1], r0.cells[r0.cells.length - 1]],
      })),
    }
    expect(parseMatchDom(twoSets).sets).toHaveLength(2)
  })

  it('drops a trailing empty third set on a two-set match', () => {
    // Real case: los-angeles-2026-d1-m1-mens renders a third column filled
    // with an em dash on BOTH rows so the table keeps its shape.
    const dash = (row: (typeof RAW)['scoreRows'][number]) => ({
      ...row,
      cells: [row.cells[0], row.cells[1], { v: '\u2014', game: false }, row.cells[row.cells.length - 1]],
    })
    const twoSets: RawMatchDom = { ...RAW, scoreRows: RAW.scoreRows.map(dash) }
    const parsed = parseMatchDom(twoSets)
    expect(parsed.sets).toHaveLength(2)
    expect(parsed.sets.map((s) => s.setNumber)).toEqual([1, 2])
  })

  it('still fails when only ONE row has a dash — that is a real anomaly', () => {
    const lopsided: RawMatchDom = {
      ...RAW,
      scoreRows: RAW.scoreRows.map((row, i) => ({
        ...row,
        cells: i === 0
          ? [row.cells[0], row.cells[1], { v: '\u2014', game: false }, row.cells[row.cells.length - 1]]
          : [row.cells[0], row.cells[1], { v: '10', game: false }, row.cells[row.cells.length - 1]],
      })),
    }
    expect(() => parseMatchDom(lopsided)).toThrow(/non-numeric/)
  })

  it('refuses a scoreboard with no played sets at all', () => {
    const empty: RawMatchDom = {
      ...RAW,
      scoreRows: RAW.scoreRows.map((row) => ({
        ...row,
        cells: [{ v: '\u2014', game: false }, row.cells[row.cells.length - 1]],
      })),
    }
    expect(() => parseMatchDom(empty)).toThrow(/no played sets/)
  })

  it('does NOT treat every non-number as an empty column', () => {
    // Only a dash or an empty string means "this set was not played". Any
    // other non-numeric token — a retirement marker, a walkover — is a real
    // signal we do not understand yet, and must fail loudly rather than be
    // quietly dropped as if the column were blank.
    const ret: RawMatchDom = {
      ...RAW,
      scoreRows: RAW.scoreRows.map((row) => ({
        ...row,
        cells: [row.cells[0], row.cells[1], { v: 'RET', game: false }, row.cells[row.cells.length - 1]],
      })),
    }
    expect(() => parseMatchDom(ret)).toThrow(/non-numeric/)
  })

  it('tags each pair with its scoreboard row so scores can be oriented', () => {
    // This is the guard against the 2026-09-23 reversal. The parser reports
    // in scoreboard order; the tie's home franchise is often the SECOND row.
    // Without rowIndex the caller cannot tell, and silently writes every set
    // backwards.
    expect(r.pairs.map((p) => p.rowIndex)).toEqual([0, 1])
    const winner = r.pairs.find((p) => p.won)!
    const winnerSetsWon = r.sets.filter((s) =>
      winner.rowIndex === 0 ? s.row0 > s.row1 : s.row1 > s.row0,
    ).length
    const loserSetsWon = r.sets.length - winnerSetsWon
    expect(winnerSetsWon).toBeGreaterThan(loserSetsWon)
  })
})
