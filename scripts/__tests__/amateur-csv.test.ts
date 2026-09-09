import { describe, it, expect } from 'vitest'
import { parseCsv, parseSlotsCsv, parsePlayersCsv } from '../lib/amateur-csv'

describe('parseCsv', () => {
  it('reads a header row and maps each line onto it', () => {
    const rows = parseCsv('a,b\n1,2\n3,4\n')
    expect(rows).toEqual([{ a: '1', b: '2' }, { a: '3', b: '4' }])
  })

  it('ignores blank trailing lines', () => {
    expect(parseCsv('a\n1\n\n')).toEqual([{ a: '1' }])
  })

  it('keeps accented names intact', () => {
    expect(parseCsv('name\nAdrián Rivas Fernández')).toEqual([{ name: 'Adrián Rivas Fernández' }])
  })
})

describe('parsePlayersCsv', () => {
  it('coerces numeric columns and leaves blanks as null', () => {
    const rows = parsePlayersCsv(
      'name,side,home_club,competition_points,competition_rank,roster_rank,games_played,wins,losses\n' +
      'Gustavo Denes,drive,Blue Padel,41250.00,412,9,7,2,5\n' +
      'Wenjie Zhou,,,,,,0,0,0\n',
    )
    expect(rows[0]).toEqual({
      name: 'Gustavo Denes', side: 'drive', homeClub: 'Blue Padel',
      competitionPoints: 41250, competitionRank: 412, rosterRank: 9,
      gamesPlayed: 7, wins: 2, losses: 5,
    })
    expect(rows[1].competitionPoints).toBeNull()
    expect(rows[1].side).toBeNull()
    expect(rows[1].gamesPlayed).toBe(0)
  })
})

describe('parseSlotsCsv', () => {
  it('splits the pipe-separated player list', () => {
    const rows = parseSlotsCsv(
      'fixture_code,sort_order,label,worth,slot_group,result,sets,court_count,exact,partial,players\n' +
      'J1,1,Pista 1,3,3,W,3,1,true,false,Albert Urbano Torrent|William Yang\n',
    )
    expect(rows[0].playerNames).toEqual(['Albert Urbano Torrent', 'William Yang'])
    expect(rows[0].exact).toBe(true)
    expect(rows[0].partial).toBe(false)
    expect(rows[0].worth).toBe(3)
  })

  it('forces exact to false when the slot covers more than one court', () => {
    const rows = parseSlotsCsv(
      'fixture_code,sort_order,label,worth,slot_group,result,sets,court_count,exact,partial,players\n' +
      'J1,3,Pistas 3 y 4,2,2,W,2,2,true,false,A B|C D|E F|G H\n',
    )
    expect(rows[0].exact).toBe(false)
  })

  it('rejects a slot with no players', () => {
    expect(() =>
      parseSlotsCsv(
        'fixture_code,sort_order,label,worth,slot_group,result,sets,court_count,exact,partial,players\n' +
        'J1,1,Pista 1,3,3,W,3,1,true,false,\n',
      ),
    ).toThrow(/J1.*sort_order 1.*no players/)
  })
})
