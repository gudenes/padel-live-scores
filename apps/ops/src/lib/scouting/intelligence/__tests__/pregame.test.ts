import {describe,it,expect} from 'vitest'
import {buildPregame,durationScale,durationPercent,opposing} from '../pregame'
import type {HistoryMatch} from '../data'
import type {Person} from '../model'
const people=['a','b','c','d','e'].map(id=>({id,name:id,country:null,category:'men',ranking:10,avatar_url:null} satisfies Person))
const row=(changes:Partial<HistoryMatch>={}):HistoryMatch=>({id:'past',manual:false,date:'2026-10-01T10:00:00Z',tournament:'Test',tournamentId:'t1',level:'p1',round:'Final',status:'finished',winner:1,playerIds:['a','b','c','d'],names:['a','b','c','d'],score:'6–4 6–3',scouted:false,duration:'01:30',...changes})
const target=row({id:'target',date:'2026-10-27T12:00:00Z',status:'scheduled'})
describe('pre-game comparisons',()=>{
 it('excludes current, future, undated and private history from all summaries',()=>{
  const data=buildPregame({people,matches:[],history:[row(),target,row({id:'future',date:'2026-11-01'}),row({id:'private',manual:true}),row({id:'undated',date:null})]},target,'2026',Date.parse('2026-10-27T15:00Z'))
  expect(data.players[0].season.wins).toBe(1);expect(data.players[0].duration).toEqual({count:1,ms:5400000});expect(data.meetings).toHaveLength(1)
 })
 it('separates season, pair history and encounters with other partners',()=>{
  const data=buildPregame({people,matches:[],history:[row(),row({id:'old',date:'2025-01-01',winner:2}),row({id:'other',playerIds:['a','e','c','d']})]},target,'2026',Date.parse('2026-10-27'))
  expect(data.players[0].season.total).toBe(2);expect(data.pairs[0].completed).toBe(2);expect(data.meetings).toHaveLength(2);expect(data.encounters[0].matches).toHaveLength(3)
  expect(opposing(row(),'a','b')).toBe(false);expect(opposing(row(),'a','missing')).toBe(false)
 })
 it('does not treat unfinished results or missing durations as performance',()=>{
  const data=buildPregame({people,matches:[],history:[row({status:'scheduled',winner:null,duration:null})]},target,undefined,Date.parse('2026-10-27'))
  expect(data.players[0].season.total).toBe(0);expect(data.players[0].duration.ms).toBeNull();expect(data.players[0].summary.matches).toBe(0);expect(data.meetings).toEqual([])
 })
 it('requires distinct identified players and a usable cutoff',()=>{
  expect(()=>buildPregame({people,matches:[],history:[]},row({playerIds:['a','a','c','d']}))).toThrow()
  expect(()=>buildPregame({people,matches:[],history:[]},row({date:null}))).toThrow()
 })
})
describe('shared duration axis',()=>{
 it('plots minutes against the same domain as tick labels',()=>{
  const scale=durationScale([86,89,86,91]);expect(scale).toEqual({max:120,ticks:[0,30,60,90,120]})
  expect(durationPercent(90,scale.max)).toBe(75);expect(durationPercent(86,scale.max)).toBeCloseTo(71.6667);expect(durationPercent(120,scale.max)).toBe(100)
 })
 it('expands for long matches and handles missing values',()=>{
  expect(durationScale([null,151]).max).toBe(180);expect(durationPercent(null,120)).toBe(0);expect(durationPercent(NaN,120)).toBe(0);expect(durationScale([]).max).toBe(120)
 })
})
