import { describe, it, expect } from 'vitest'
import { parseEntryListText, type ParsedTeam } from '../entry-list-parser'

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
  it('parses teams from entry list text', () => {
    const teams = parseEntryListText(SAMPLE_TEXT)
    expect(teams).toHaveLength(3)

    expect(teams[0]).toEqual({
      position: 1,
      teamPoints: 9370,
      player1: { name: 'Jeronimo Gonzalez', country: 'ESP', ranking: 15, points: 4350 },
      player2: { name: 'Martin Di Nenno', country: 'ARG', ranking: 12, points: 5020 },
    })

    expect(teams[1]).toEqual({
      position: 2,
      teamPoints: 5270,
      player1: { name: 'Javier Leal', country: 'ESP', ranking: 16, points: 3875 },
      player2: { name: 'Pablo Lijó', country: 'ESP', ranking: 45, points: 1395 },
    })

    expect(teams[2]).toEqual({
      position: 3,
      teamPoints: 4030,
      player1: { name: 'Alejandro Arroyo', country: 'ESP', ranking: 24, points: 2400 },
      player2: { name: 'Pablo Garcia Rodrigo', country: 'ESP', ranking: 38, points: 1630 },
    })
  })

  it('handles high-ranking numbers (4+ digits)', () => {
    const text = `Pos Ranking \tPlayer \tRanking \tPlayer \tTeam Points
1 \t2926 Rasul Gojayev KAZ
5 points 5000 Some Player USA
3 points 8`
    const teams = parseEntryListText(text)
    expect(teams).toHaveLength(1)
    expect(teams[0].player1.ranking).toBe(2926)
    expect(teams[0].player1.name).toBe('Rasul Gojayev')
    expect(teams[0].player2.ranking).toBe(5000)
  })

  it('returns empty array for empty/header-only input', () => {
    expect(parseEntryListText('')).toEqual([])
    expect(parseEntryListText('Pos Ranking Player')).toEqual([])
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
    const teams = parseEntryListText(text)
    expect(teams).toHaveLength(2)
    expect(teams[0].position).toBe(1)
    expect(teams[1].position).toBe(2)
  })
})
