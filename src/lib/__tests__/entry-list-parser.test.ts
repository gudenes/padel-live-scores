import { describe, it, expect } from 'vitest'
import { parseEntryListText } from '../entry-list-parser'

const SAMPLE_TEXT = `Pos Ranking \tPlayer \tRanking \tPlayer \tTeam Points
1 \t15 Jeronimo Gonzalez ESP
4350 points 12 Martin Di Nenno ARG
5020 points 9370
2 \t16 Javier Leal ESP
3875 points 45 Pablo Lijó ESP
1395 points 5270
3 \t24 Alejandro Arroyo ESP
2400 points 38 Pablo Garcia Rodrigo ESP
1630 points 4030`

describe('parseEntryListText', () => {
  it('handles player 1 with no ranking (FIP below-ranking-depth entries)', () => {
    // Shape observed on Ijuí men's entry list for teams 23 & 26: player 1's
    // ranking is blank (unranked or below the published list depth), player 2
    // has a ranking. Parser must not drop these teams.
    const text = `Pos Ranking \tPlayer \tRanking \tPlayer \tTeam Points
23 Andrei Huber BRA
0 points 1739 David Pedroso Hennemann BRA
5 points 5
26 Giuliano Santino Propato San Martin ARG
0 points 2635 Leonardo Sato BRA
2 points 2`
    const { teams } = parseEntryListText(text)
    expect(teams).toHaveLength(2)
    expect(teams[0]).toEqual({
      position: 23,
      teamPoints: 5,
      drawType: 'main',
      isWildCard: false,
      player1: { name: 'Andrei Huber', country: 'BRA', ranking: 0, points: 0 },
      player2: { name: 'David Pedroso Hennemann', country: 'BRA', ranking: 1739, points: 5 },
    })
    expect(teams[1]).toEqual({
      position: 26,
      teamPoints: 2,
      drawType: 'main',
      isWildCard: false,
      player1: { name: 'Giuliano Santino Propato San Martin', country: 'ARG', ranking: 0, points: 0 },
      player2: { name: 'Leonardo Sato', country: 'BRA', ranking: 2635, points: 2 },
    })
  })

  it('does not cascade-misparse when a team boundary is malformed', () => {
    // If one team's first line is malformed, the parser must skip that line
    // only — not consume the NEXT team's "N points..." line as a bogus new team.
    const text = `Pos Ranking \tPlayer \tRanking \tPlayer \tTeam Points
1 \t100 Foo Bar ESP
5 points 200 Qux Baz ESP
3 points 8
malformed line that cannot parse
2 \t150 Alpha Beta ARG
4 points 250 Gamma Delta ARG
2 points 6`
    const { teams } = parseEntryListText(text)
    expect(teams).toHaveLength(2)
    expect(teams[0].position).toBe(1)
    expect(teams[1].position).toBe(2)
  })

  it('parses teams from entry list text', () => {
    const { teams } = parseEntryListText(SAMPLE_TEXT)
    expect(teams).toHaveLength(3)

    expect(teams[0]).toEqual({
      position: 1,
      teamPoints: 9370,
      drawType: 'main',
      isWildCard: false,
      player1: { name: 'Jeronimo Gonzalez', country: 'ESP', ranking: 15, points: 4350 },
      player2: { name: 'Martin Di Nenno', country: 'ARG', ranking: 12, points: 5020 },
    })

    expect(teams[1]).toEqual({
      position: 2,
      teamPoints: 5270,
      drawType: 'main',
      isWildCard: false,
      player1: { name: 'Javier Leal', country: 'ESP', ranking: 16, points: 3875 },
      player2: { name: 'Pablo Lijó', country: 'ESP', ranking: 45, points: 1395 },
    })
  })

  it('handles high-ranking numbers (4+ digits)', () => {
    const text = `Pos Ranking \tPlayer \tRanking \tPlayer \tTeam Points
1 \t2926 Rasul Gojayev KAZ
5 points 5000 Some Player USA
3 points 8`
    const { teams } = parseEntryListText(text)
    expect(teams).toHaveLength(1)
    expect(teams[0].player1.ranking).toBe(2926)
    expect(teams[0].player1.name).toBe('Rasul Gojayev')
    expect(teams[0].player2.ranking).toBe(5000)
    expect(teams[0].isWildCard).toBe(false)
  })

  it('returns empty array for empty/header-only input', () => {
    expect(parseEntryListText('').teams).toEqual([])
    expect(parseEntryListText('Pos Ranking Player').teams).toEqual([])
  })

  it('skips malformed lines and continues parsing', () => {
    const text = `Pos Ranking \tPlayer \tRanking \tPlayer \tTeam Points
1 \t15 Jeronimo Gonzalez ESP
4350 points 12 Martin Di Nenno ARG
5020 points 9370
this line is garbage
2 \t24 Alejandro Arroyo ESP
2400 points 38 Pablo Garcia Rodrigo ESP
1630 points 4030`
    const { teams } = parseEntryListText(text)
    expect(teams).toHaveLength(2)
    expect(teams[0].position).toBe(1)
    expect(teams[1].position).toBe(2)
  })

  it('detects Main Draw vs Qualifications via QUALIFICATIONS text marker', () => {
    const text = `Pos Ranking \tPlayer \tRanking \tPlayer \tTeam Points
1 \t15 Jeronimo Gonzalez ESP
4350 points 12 Martin Di Nenno ARG
5020 points 9370
FIP GOLD ALMATY
Last Update: 29/3/2026 h 03:09 p. m.
ENTRY LIST Hombres's
MAIN DRAW
QUALIFICATIONS
-- 1 of 2 --
Pos Ranking \tPlayer \tRanking \tPlayer \tTeam Points
1 \t351 Pol Alsina ESP
93 points 1017 Enzo Chua SIN
14 points 107`
    const { teams, metadata } = parseEntryListText(text)
    expect(teams).toHaveLength(2)

    expect(teams[0].drawType).toBe('main')
    expect(teams[0].player1.name).toBe('Jeronimo Gonzalez')

    expect(teams[1].drawType).toBe('qualifying')
    expect(teams[1].position).toBe(1)
    expect(teams[1].player1.name).toBe('Pol Alsina')
  })

  it('detects Qualifications via second Pos header (women PDF pattern)', () => {
    // In women's PDFs, qualifying teams appear after a second "Pos Ranking..." header
    // with metadata/QUALIFICATIONS text at the very end (after all teams)
    const text = `Pos Ranking \tPlayer \tRanking \tPlayer \tTeam Points
1 \t17 Aranzazu Osoro Ulrich ARG
3605 points \t20 Victoria Iglesias Segador ESP
3505 points \t7110
2 \t21 Lucia Sainz Pelegri ESP
3090 points \t44 Ana Catarina Nogueira POR
1479 points \t4569
Pos Ranking \tPlayer \tRanking \tPlayer \tTeam Points
1 \t787 Anastasia Ivanova KAZ
10 points
Evgeniia Kozlova RUS
0 points \t10
FIP GOLD ALMATY
Last Update: 30/3/2026 h 08:20 am
ENTRY LIST Women's
MAIN DRAW
QUALIFICATIONS`
    const { teams } = parseEntryListText(text)
    expect(teams).toHaveLength(3)

    // First two are main draw
    expect(teams[0].drawType).toBe('main')
    expect(teams[0].player1.name).toBe('Aranzazu Osoro Ulrich')
    expect(teams[1].drawType).toBe('main')
    expect(teams[1].player1.name).toBe('Lucia Sainz Pelegri')

    // Third is qualifying (after second header)
    expect(teams[2].drawType).toBe('qualifying')
    expect(teams[2].position).toBe(1)
    expect(teams[2].player1.name).toBe('Anastasia Ivanova')
    expect(teams[2].player2.name).toBe('Evgeniia Kozlova')
  })

  it('extracts metadata from PDF text', () => {
    const text = `Pos Ranking \tPlayer \tRanking \tPlayer \tTeam Points
1 \t15 Jeronimo Gonzalez ESP
4350 points 12 Martin Di Nenno ARG
5020 points 9370
FIP GOLD ALMATY
Last Update: 29/3/2026 h 03:09 p. m.
ENTRY LIST Hombres's
MAIN DRAW
QUALIFICATIONS`
    const { metadata } = parseEntryListText(text)
    expect(metadata.lastUpdate).toBe('29/3/2026 h 03:09 p. m.')
    expect(metadata.title).toBe('FIP GOLD ALMATY')
    expect(metadata.category).toBe("Hombres's")
  })

  it('handles qualifying entries with player 2 on separate line', () => {
    const text = `QUALIFICATIONS
Pos Ranking \tPlayer \tRanking \tPlayer \tTeam Points
5 \t862 Daniel Pashayan RUS
19 points
Maksim Kolobov RUS
0 points 19`
    const { teams } = parseEntryListText(text)
    expect(teams).toHaveLength(1)
    expect(teams[0].drawType).toBe('qualifying')
    expect(teams[0].player1.name).toBe('Daniel Pashayan')
    expect(teams[0].player2.name).toBe('Maksim Kolobov')
    expect(teams[0].player2.country).toBe('RUS')
    expect(teams[0].player2.points).toBe(0)
  })

  it('detects WC (wild card) teams', () => {
    const text = `Pos Ranking \tPlayer \tRanking \tPlayer \tTeam Points
1 \t15 Jeronimo Gonzalez ESP
4350 points 12 Martin Di Nenno ARG
5020 points 9370
25 WC 708 Mariya Sinitsyna KAZ
13 points \t708 Maria Sysoeva RUS
13 points \t26`
    const { teams } = parseEntryListText(text)
    expect(teams).toHaveLength(2)

    expect(teams[0].isWildCard).toBe(false)
    expect(teams[0].position).toBe(1)

    expect(teams[1].isWildCard).toBe(true)
    expect(teams[1].position).toBe(25)
    expect(teams[1].player1.name).toBe('Mariya Sinitsyna')
    expect(teams[1].player1.country).toBe('KAZ')
    expect(teams[1].player2.name).toBe('Maria Sysoeva')
  })

  it('detects WC teams in qualifying alternate format', () => {
    const text = `QUALIFICATIONS
Pos Ranking \tPlayer \tRanking \tPlayer \tTeam Points
28 WC 1080 Alexandra Rodicheva KAZ
5 points
Marziya Abdulmazhit KAZ
0 points \t5`
    const { teams } = parseEntryListText(text)
    expect(teams).toHaveLength(1)
    expect(teams[0].isWildCard).toBe(true)
    expect(teams[0].drawType).toBe('qualifying')
    expect(teams[0].player1.name).toBe('Alexandra Rodicheva')
    expect(teams[0].player2.name).toBe('Marziya Abdulmazhit')
  })
})
