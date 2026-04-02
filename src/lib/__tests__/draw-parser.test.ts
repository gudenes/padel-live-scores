import { describe, it, expect } from 'vitest'
import { parseDrawText } from '../draw-parser'

const SAMPLE_DRAW = `WOMEN
1 OSORO ULRICH, Aranzazu \tARG
IGLESIAS SEGADOR, Victoria \tESP
NEIZVESTNAYA, Angelina
TERRANOVA, Elsa \tITA
Q \tIVANOVA, Anastasia \tKAZ
KOZLOVA, Evgeniia
WC \tSINITSYNA, Mariya \tKAZ
SYSOEVA, Maria
8 NAVARRO LOPEZ-BARAJAS, Teresa \tESP
NIKITINA, Ekaterina
Round of 32
\u20AC 0 \t8 pt
Seeded teams
TEAM \tPOINTS
1. OSORO ULRICH, Aranzazu / IGLESIAS SEGADOR, Victoria \t7110
8. NIKITINA, Ekaterina / NAVARRO LOPEZ-BARAJAS, Teresa \t1228
RELEASED
30 Mar 2026
1:48 PM`

describe('parseDrawText', () => {
  it('parses bracket entries from draw text', () => {
    const result = parseDrawText(SAMPLE_DRAW)
    expect(result.entries).toHaveLength(5)

    // Seed 1 team
    expect(result.entries[0]).toMatchObject({
      drawPosition: 1,
      player1Name: 'Aranzazu Osoro Ulrich',
      player1Country: 'ARG',
      player2Name: 'Victoria Iglesias Segador',
      player2Country: 'ESP',
      seed: 1,
      marker: null,
    })
  })

  it('detects Q (qualifier) markers', () => {
    const result = parseDrawText(SAMPLE_DRAW)
    const qEntry = result.entries.find(e => e.marker === 'Q')
    expect(qEntry).toBeDefined()
    expect(qEntry!.player1Name).toBe('Anastasia Ivanova')
    expect(qEntry!.player1Country).toBe('KAZ')
  })

  it('detects WC (wild card) markers', () => {
    const result = parseDrawText(SAMPLE_DRAW)
    const wcEntry = result.entries.find(e => e.marker === 'WC')
    expect(wcEntry).toBeDefined()
    expect(wcEntry!.player1Name).toBe('Mariya Sinitsyna')
    expect(wcEntry!.player1Country).toBe('KAZ')
  })

  it('converts LASTNAME, Firstname to Firstname Lastname', () => {
    const result = parseDrawText(SAMPLE_DRAW)
    expect(result.entries[0].player1Name).toBe('Aranzazu Osoro Ulrich')
    // Compound surname
    const seed8 = result.entries.find(e => e.seed === 8)
    expect(seed8).toBeDefined()
    expect(seed8!.player1Name).toBe('Teresa Navarro Lopez-Barajas')
  })

  it('parses seeded teams with points', () => {
    const result = parseDrawText(SAMPLE_DRAW)
    expect(result.seededTeams).toHaveLength(2)
    expect(result.seededTeams[0]).toMatchObject({
      seed: 1,
      points: 7110,
    })
  })

  it('extracts metadata including drawSize', () => {
    const result = parseDrawText(SAMPLE_DRAW)
    expect(result.metadata.category).toBe('women')
    expect(result.metadata.releaseDate).toBe('30 Mar 2026')
    expect(result.metadata.drawSize).toBe(5)
  })

  it('handles unseeded teams (no prefix)', () => {
    const result = parseDrawText(SAMPLE_DRAW)
    const unseeded = result.entries.find(e =>
      e.seed === null && e.marker === null && e.player1Name === 'Angelina Neizvestnaya'
    )
    expect(unseeded).toBeDefined()
    expect(unseeded!.player2Name).toBe('Elsa Terranova')
    expect(unseeded!.player2Country).toBe('ITA')
  })

  it('returns empty for empty input', () => {
    const result = parseDrawText('')
    expect(result.entries).toEqual([])
    expect(result.seededTeams).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('detects LL (lucky loser) markers', () => {
    const text = `WOMEN
LL \tGOMEZ, Ana \tESP
MARTINEZ, Sofia \tARG
Round of 32`
    const result = parseDrawText(text)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].marker).toBe('LL')
    expect(result.entries[0].player1Name).toBe('Ana Gomez')
  })

  it('detects men category from header', () => {
    const text = `MEN
1 GONZALEZ, Jeronimo \tARG
DI NENNO, Martin \tARG
Round of 32`
    const result = parseDrawText(text)
    expect(result.metadata.category).toBe('men')
    expect(result.entries).toHaveLength(1)
  })

  it('warns on unpaired player (odd number of lines)', () => {
    const text = `WOMEN
1 OSORO ULRICH, Aranzazu \tARG
IGLESIAS SEGADOR, Victoria \tESP
NEIZVESTNAYA, Angelina
Round of 32`
    const result = parseDrawText(text)
    expect(result.entries).toHaveLength(1)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('Unpaired player')
    expect(result.warnings[0]).toContain('Angelina Neizvestnaya')
  })

  it('handles apostrophes in names', () => {
    const text = `WOMEN
O'BRIEN, Siobhan \tIRL
MURPHY, Kate \tIRL
Round of 32`
    const result = parseDrawText(text)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].player1Name).toBe("Siobhan O'Brien")
  })
})
