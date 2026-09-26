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
      'name,side,home_club,competition_points,roster_rank,games_played,wins,losses\n' +
      'Gustavo Denes,drive,Blue Padel,41250.00,9,7,2,5\n' +
      'Wenjie Zhou,,,,,0,0,0\n',
    )
    expect(rows[0]).toMatchObject({
      name: 'Gustavo Denes', side: 'drive', homeClub: 'Blue Padel',
      competitionPoints: 41250, rosterRank: 9,
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

describe('parsePlayersCsv — rankings, captain and SNP id', () => {
  const HEADER =
    'name,side,home_club,competition_points,roster_rank,games_played,wins,losses,' +
    'snp_id,national_rank,local_rank,is_captain'

  it('reads the new columns', () => {
    const rows = parsePlayersCsv(
      `${HEADER}\nEric Ortega,,,43437.50,2,7,4,3,309288,4028,486,true\n`,
    )
    expect(rows[0].snpId).toBe('309288')
    expect(rows[0].nationalRank).toBe(4028)
    expect(rows[0].localRank).toBe(486)
    expect(rows[0].isCaptain).toBe(true)
  })

  it('turns s/d into null, never zero', () => {
    // A zero in a ranking claims first place — the opposite of "no data".
    // Three players in the real sheet carry s/d, and they are exactly the
    // three who never played.
    const rows = parsePlayersCsv(
      `${HEADER}\nWenjie Zhou,,,s/d,,0,0,0,372485,s/d,s/d,\n`,
    )
    expect(rows[0].competitionPoints).toBeNull()
    expect(rows[0].nationalRank).toBeNull()
    expect(rows[0].localRank).toBeNull()
  })

  it('defaults an empty captain cell to false, not null', () => {
    const rows = parsePlayersCsv(`${HEADER}\nJuan Rivas,,,23906.25,17,4,1,3,309292,7014,860,\n`)
    expect(rows[0].isCaptain).toBe(false)
  })

  it('tolerates a row with no snp_id', () => {
    const rows = parsePlayersCsv(`${HEADER}\nAlguien,,,,,0,0,0,,,,\n`)
    expect(rows[0].snpId).toBeNull()
    expect(rows[0].nationalRank).toBeNull()
  })
})
