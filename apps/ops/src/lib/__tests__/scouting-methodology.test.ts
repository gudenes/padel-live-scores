import {describe,it,expect} from 'vitest'
import {freshDoc,replay,type Event} from '../scouting/model'
import {sessionExport} from '../scouting/export'
import {methodologyAnalysis,pointWeight,playerScore} from '../scouting/methodology'
import type {TimelinePoint} from '../scouting/tracking'
import reference from './fixtures/scouting-score-reference.json'

function point(overrides:Partial<TimelinePoint>={}):TimelinePoint{
 const state=replay(freshDoc()).score
 return {id:'p',at:'2026-10-07T10:00:00Z',number:1,winner:'a',server:0,player:0,outcome:'winner',smash:false,lead:1,before:state,after:state,star:false,breakPoint:null,breakConverted:false,setPoint:{a:false,b:false},matchPoint:{a:false,b:false},rallyStartedAt:null,durationMs:null,firstFaultAt:null,...overrides}
}

describe('versioned scouting methodology',()=>{
 it('splits explicit assisted winners equally in v1.3 while retaining earlier versions',()=>{
  for(const [pressure,expected] of [[{},0.55],[{breakPoint:'a'},0.8],[{setPoint:{a:true,b:false}},1.05],[{matchPoint:{a:true,b:false}},1.3]] as const){
   const p=point({...pressure,assistBy:1})
   const result=methodologyAnalysis([p],'v1.3')
   expect(result.series[0].values).toEqual([expected,expected,0,0])
   expect(result.players.map(p=>p.generatedPoints)).toEqual([1,0,0,0])
   const old=methodologyAnalysis([p],'v0.3')
   expect(result.players.reduce((sum,p)=>sum+p.impact,0)).toBeCloseTo(old.players.reduce((sum,p)=>sum+p.impact,0))
   expect(old.players[1].impact).toBe(0.05)
  }
  expect(methodologyAnalysis([point({player:3,assistBy:2,winner:'b'})]).series[0].values).toEqual([0,0,0.55,0.55])
 })
 it('keeps full winner credit with absent, self, opposing or invalid assist attribution',()=>{
  for(const assistBy of [undefined,0,2,3,-1,4,1.5] as const){
   expect(methodologyAnalysis([point({assistBy:assistBy as TimelinePoint['assistBy']})]).series[0].values).toEqual([1.05,0.05,0,0])
  }
  for(const outcome of ['unforced','forced','double_fault']){
   const p=point({outcome,assistBy:1,winner:'b'})
   expect(methodologyAnalysis([p]).series).toEqual(methodologyAnalysis([p],'v0.3').series)
  }
 })
 it('exports v1.4 rules and removes undone assisted winners from recalculation',()=>{
  const events:Event[]=[{id:'one',at:'2026-10-07T10:00:00Z',kind:'point',player:0,outcome:'winner',assistBy:1,smash:false}]
  const doc={...freshDoc(),events},out=sessionExport('match',[],1,doc)
  expect(out.playerImpact.methodology.id).toBe('v1.4')
  expect(out.playerImpact.rules).toMatchObject({winner:1,assistedWinner:0.5,assist:0.5,pairPointBonus:0.05})
  expect(out.playerImpact.players.map(p=>p.impact)).toEqual([0.55,0.55,0,0])
  expect(out.playerEvolution).toEqual([{number:1,values:[1,0,0,0]}])
  const undone={...doc,events:[...events,{id:'undo',at:'2026-10-07T10:00:01Z',kind:'undo'} as Event]}
  expect(sessionExport('match',[],2,undone).playerImpact.players.map(p=>p.impact)).toEqual([0,0,0,0])
 })
 it('uses scenario B for v1.4 and preserves v1.3 scores with identical impact',()=>{
  expect([15.45,20.2,24.45,15.95].map(impact=>playerScore(impact,194.5))).toEqual([7.8,8.6,9.4,7.9])
  expect([15.45,20.2,24.45,15.95].map(impact=>playerScore(impact,194.5,'v1.3'))).toEqual([8,8.6,9.1,8.1])
  const points=[point({assistBy:1}),point({player:2,outcome:'forced',forcedBy:0,winner:'a'})]
  const current=methodologyAnalysis(points),previous=methodologyAnalysis(points,'v1.3')
  expect(current.series).toEqual(previous.series)
  expect(current.rules.score).toMatchObject({neutral:5,sensitivity:0.35})
  expect(previous.rules.score).toMatchObject({neutral:6,sensitivity:0.25})
  expect(current.players.map(p=>p.impact)).toEqual(previous.players.map(p=>p.impact))
  expect(playerScore(1,7)).toBe(10)
  expect(playerScore(-100,100)).toBe(1)
  expect(playerScore(0,0)).toBeNull()
 })
 it('uses the highest overlapping pressure, not stacked multipliers',()=>{
  const p=point({before:{...replay(freshDoc()).score,phase:'tiebreak'},breakPoint:'a',star:true,setPoint:{a:true,b:false},matchPoint:{a:true,b:false}})
  expect(pointWeight(p)).toBe(2.5)
  expect(methodologyAnalysis([p],'v0.1').players[0].impact).toBe(2.5)
 })
 it('credits an attributed opponent only in v0.2 and v0.3',()=>{
  const p=point({player:0,outcome:'forced',forcedBy:2,winner:'b',setPoint:{a:false,b:true}})
  expect(methodologyAnalysis([p],'v0.1').series[0].values).toEqual([-1,0,0,0])
  expect(methodologyAnalysis([p],'v0.2').series[0].values).toEqual([-1,0,1,0])
  expect(methodologyAnalysis([p],'v0.3').series[0].values).toEqual([-1,0,1.05,0.05])
 })
 it('keeps the team bonus flat on match points and credits both teammates',()=>{
  const p=point({matchPoint:{a:true,b:false}})
  const result=methodologyAnalysis([p],'v0.3')
  expect(result.series[0].values).toEqual([2.55,0.05,0,0])
  expect(result.weightedPoints).toBe(2.5)
 })
 it('does not infer missing or invalid forced-error creators',()=>{
  for(const forcedBy of [undefined,1] as const){
   const result=methodologyAnalysis([point({outcome:'forced',winner:'b',forcedBy})],'v0.2')
   expect(result.series[0].values).toEqual([-0.5,0,0,0])
   expect(result.coverage).toMatchObject({forcedErrors:1,attributedForcedErrors:0})
  }
 })
 it('counts unknown points only for coverage, denominator and the shared bonus',()=>{
  const result=methodologyAnalysis([point({player:null,outcome:'unclassified',winner:'b'})])
  expect(result.series[0].values).toEqual([0,0,0.05,0.05])
  expect(result.coverage.unclassifiedPoints).toBe(1)
  expect(result.players.map(p=>p.generatedPoints)).toEqual([0,0,0,0])
 })
 it('handles double faults as a single unforced penalty',()=>{
  expect(methodologyAnalysis([point({outcome:'double_fault',winner:'b',breakPoint:'b'})],'v0.3').series[0].values).toEqual([-1.5,0,0.05,0.05])
 })
 it('shows no score without observations, bounds scores, and normalizes observation length',()=>{
  expect(methodologyAnalysis([]).players.every(p=>p.score===null)).toBe(true)
  expect(playerScore(0,100)).toBe(5)
  expect(playerScore(100,100)).toBe(10)
  expect(playerScore(-100,100)).toBe(1)
  expect(playerScore(7,118.5)).toBe(playerScore(14,237))
 })
 it('reproduces the checked 109-point match in every weighted version',()=>{
  const points=reference.map((r,i)=>point({...r,player:r.player as TimelinePoint['player'],forcedBy:r.forcedBy as TimelinePoint['forcedBy'],winner:r.winner as TimelinePoint['winner'],breakPoint:r.breakPoint as TimelinePoint['breakPoint'],number:i+1,before:{...replay(freshDoc()).score,phase:r.phase as TimelinePoint['before']['phase']}}))
  for(const [id,expected] of [['v0.1',[-9.5,-7.5,-6,2.75]],['v0.2',[-4.75,-6,-2.25,7]],['v0.3',[-2.35,-3.6,0.8,10.05]]] as const){
   const result=methodologyAnalysis(points,id)
   expect(result.weightedPoints).toBe(118.5)
   result.players.forEach((p,i)=>expect(p.impact).toBeCloseTo(expected[i],8))
  }
  const result=methodologyAnalysis(points,'v1.3')
  expect(result.players.map(p=>p.score)).toEqual([5.5,5.2,6.2,8.1])
  expect(result.players.map(p=>p.generatedPoints)).toEqual([22,8,17,20])
  expect(result.coverage).toEqual({forcedErrors:27,attributedForcedErrors:27,unclassifiedPoints:0})
 })
 it('exports the selected method, preserving legacy evolution and undo semantics',()=>{
  const events:Event[]=[{id:'one',at:'2026-10-07T10:00:00Z',kind:'point',player:0,outcome:'winner',smash:false},{id:'two',at:'2026-10-07T10:00:01Z',kind:'point',player:2,outcome:'unforced',smash:false},{id:'undo',at:'2026-10-07T10:00:02Z',kind:'undo'}]
  const doc={...freshDoc(),events},out=sessionExport('match',[],1,doc,'v0.2')
  expect(out.playerImpact.methodology.id).toBe('v0.2')
  expect(out.playerImpact.observedPoints).toBe(1)
  expect(out.playerEvolution).toEqual([{number:1,values:[1,0,0,0]}])
  expect(replay(doc).tracking.timeline).toHaveLength(1)
  expect(methodologyAnalysis(replay(doc).tracking.timeline,'net-actions').players[0].score).toBeNull()
 })
})
