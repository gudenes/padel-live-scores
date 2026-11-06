import {describe,it,expect} from 'vitest'
import {CUP_SEMIFINALS, withCupSchedule} from '../world-cup-schedule'
import {dailyCupTies} from '../world-cup-daily'
import {WORLD_CUP, type CupData, type CupTie} from '../world-cup'
import type {MatchesDayGroup} from '../fetch-matches-day'
const data = (ties = withCupSchedule([])): CupData => ({ties,teams:[],groups:[],fetchedAt:'',partial:true})
describe('official semifinal schedule', () => {
  it('shows all four ties without player profiles, lineups or streams', () => {
    const rows = dailyCupTies(data(), [], '2026-11-06', 'Europe/Madrid')
    expect(rows).toHaveLength(4)
    expect(rows.map(r=>[r.category,r.names,r.court])).toEqual([
      ['women',['Argentina','Italy'],'Grand Stand 1'],
      ['women',['Spain','France'],'Center Court'],
      ['men',['Argentina','Italy'],'Center Court'],
      ['men',['Spain','Portugal'],'Grand Stand 1'],
    ])
    for (const row of rows) {
      expect(row).toMatchObject({status:'upcoming',matches:[],score:null,broadcast:false,round:'semifinals'})
      expect(row.videoId).toBeFalsy()
      expect(row.countries.every(Boolean)).toBe(true)
      expect(row.notBefore).toBe(row.category === 'men')
      expect(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit'}).format(new Date(row.time!))).toBe(row.category === 'men' ? '16:00' : '12:00')
    }
    expect(dailyCupTies(data(), [], '2026-11-07', 'Europe/Madrid')).toEqual([])
  })
  it('merges reversed streams by category and day while retaining official time', () => {
    const stream: CupTie = {...CUP_SEMIFINALS[2],id:'stream',home:'Italy',away:'Argentina',scheduledAt:null,liveObservedAt:'2026-11-06T15:10:00Z',videoId:'abcdefghijk',streams:[{videoId:'abcdefghijk',language:'ENG'}]}
    const rows = withCupSchedule([stream])
    expect(rows).toHaveLength(4)
    expect(rows[2]).toMatchObject({home:'Argentina',scheduledAt:'2026-11-06T15:00:00Z',notBefore:true,videoId:'abcdefghijk',liveObservedAt:stream.liveObservedAt,streams:stream.streams})
    expect(rows[1].videoId).toBe('')
    expect(withCupSchedule([{...stream,liveObservedAt:'2026-11-05T15:10:00Z'}])).toHaveLength(5)
  })
  it('merges actual player matches without duplicating the official tie', () => {
    const match = {id:'rubber',category:'men',status:'scheduled',scheduled_at:'2026-11-06T15:00:00Z',round:'Semifinals',sets:[],pair1_player1_country:'ITA',pair1_player2_country:'ITA',pair2_player1_country:'ARG',pair2_player2_country:'ARG'}
    const groups = [{tournamentId:WORLD_CUP.tournamentId,matches:[match]}] as unknown as MatchesDayGroup[]
    const rows = dailyCupTies(data(),groups,'2026-11-06','Europe/Madrid')
    expect(rows).toHaveLength(4)
    expect(rows.find(r=>r.key === 'men:AR-IT')).toMatchObject({matches:[match],court:'Center Court',notBefore:true,broadcast:false,status:'upcoming'})
  })
})
