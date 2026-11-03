import {describe,it,expect} from 'vitest'
import {dailyCupTies} from '../world-cup-daily'
import {WORLD_CUP,type CupData} from '../world-cup'
import type {MatchesDayGroup} from '../fetch-matches-day'
const data: CupData = {teams:[{name:'Spain',country:'ESP',category:'women',players:[]},{name:'Germany',country:'GER',category:'women',players:[]}],ties:[{id:'one',home:'Spain',away:'Germany',category:'women',scheduledAt:'2026-11-03T11:00:00Z',group:'A',videoId:'abcdefghijk'}],groups:[],partial:false,fetchedAt:''}
describe('daily country confrontations',()=>{
 it('shows broadcasts on the selected page date and does not fabricate live status',()=>{
  expect(dailyCupTies(data,[],'2026-11-03','Europe/Madrid')[0]).toMatchObject({countries:['ES','DE'],broadcast:true,videoId:'abcdefghijk',status:'upcoming',score:null})
  expect(dailyCupTies(data,[],'2026-11-04','Europe/Madrid')).toEqual([])
  expect(dailyCupTies(data,[],'2026-11-02','Pacific/Pago_Pago')).toEqual([])
 })
 it('merges published matches into the same confrontation regardless of country order',()=>{
  const match={id:'one',category:'women',scheduled_at:'2026-11-03T11:00:00Z',round:'Group stage',status:'finished',winner_pair:1,sets:[],pair1_player1_country:'ESP',pair1_player2_country:'ESP',pair2_player1_country:'GER',pair2_player2_country:'GER'}
  const groups=[{tournamentId:WORLD_CUP.tournamentId,matches:[match]}] as unknown as MatchesDayGroup[]
  const rows=dailyCupTies(data,groups,'2026-11-03','Europe/Madrid')
  expect(rows).toHaveLength(1)
  expect(rows[0].matches.map(match => match.id)).toEqual(['one'])
  expect(rows[0]).toMatchObject({countries:['DE','ES'],score:[0,1],broadcast:false,videoId:'abcdefghijk',status:'upcoming'})
 })
 it('does not attach a stream from another day or category',()=>{
  const match={id:'other',category:'men',scheduled_at:'2026-11-03T11:00:00Z',round:'Group stage',status:'upcoming',sets:[],pair1_player1_country:'ESP',pair1_player2_country:'ESP',pair2_player1_country:'GER',pair2_player2_country:'GER'}
  const groups=[{tournamentId:WORLD_CUP.tournamentId,matches:[match]}] as unknown as MatchesDayGroup[]
  expect(dailyCupTies(data,groups,'2026-11-03','Europe/Madrid').find(tie=>tie.category === 'men')?.videoId).toBeNull()
  const otherDay={...data,ties:data.ties.map(tie=>({...tie,scheduledAt:'2026-11-04T11:00:00Z'}))}
  const women=[{tournamentId:WORLD_CUP.tournamentId,matches:[{...match,category:'women'}]}] as unknown as MatchesDayGroup[]
  expect(dailyCupTies(otherDay,women,'2026-11-03','Europe/Madrid')[0].videoId).toBeNull()
 })
 it('matches a live stream without a time to its women confrontation',()=>{
  const live={...data,ties:data.ties.map(tie=>({...tie,scheduledAt:null,liveObservedAt:'2026-11-03T11:00:00Z'}))}
  expect(dailyCupTies(live,[],'2026-11-03','Europe/Madrid')[0]).toMatchObject({videoId:'abcdefghijk',time:null,status:'live'})
  expect(dailyCupTies(live,[],'2026-11-02','Europe/Madrid')).toEqual([])
 })
 it('remains usable with match data when the broadcast source fails',()=>{
  expect(dailyCupTies(null,[],'2026-11-03','Europe/Madrid')).toEqual([])
 })
})
