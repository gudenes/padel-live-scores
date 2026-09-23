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
      { setNumber: 1, home: 7, away: 6 },
      { setNumber: 2, home: 0, away: 6 },
      { setNumber: 3, home: 7, away: 10 },
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
      pointsWonPct: { home: 43, away: 57 },
      servesWonPct: { home: 46, away: 60 },
      breakPointsConvertedPct: { home: 40, away: 54 },
      goldenPointsWonPct: { home: 67, away: 33 },
      longRalliesWonPct: { home: 48, away: 52 },
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
})
