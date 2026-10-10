import {expect,it} from 'vitest'
import {methodologyAnalysis,playerScore,DEFAULT_METHODOLOGY} from '../scouting/methodology'
import {freshDoc,replay,type Event} from '../scouting/model'
import {sessionExport} from '../scouting/export'
const event:Event={id:'a',kind:'point',at:'2026-10-10T10:00:00Z',player:0,outcome:'winner',assistBy:1,smash:false}
const doc={...freshDoc(),events:[event]}
const point=replay(doc).tracking.timeline[0]
it('defaults to v1.5 with no pair bonus, retaining the 50/50 split in exports',()=>{
 expect(DEFAULT_METHODOLOGY).toBe('v1.5')
 const out=sessionExport('match',[],1,doc)
 expect(out.playerImpact.methodology.id).toBe('v1.5')
 expect(out.playerImpact.players.map(p=>p.impact)).toEqual([.5,.5,0,0])
 expect(out.playerImpact.rules).toMatchObject({pairPointBonus:0,score:{curve:'tanh',positiveK:11,negativeK:7,max:9.9}})
 expect(out.playerEvolution[0].values).toEqual([1,0,0,0])
})
it('retains highest-only key-point weighting for winners, assists and error creation',()=>{
 const p={...point,breakPoint:'a' as const,star:true,before:{...point.before,phase:'tiebreak' as const},setPoint:{a:true,b:false},matchPoint:{a:true,b:false}}
 const a=methodologyAnalysis([p])
 expect(a.weightedPoints).toBe(2.5)
 expect(a.players.map(p=>p.impact)).toEqual([1.25,1.25,0,0])
 expect(methodologyAnalysis([{...p,player:2,outcome:'forced',assistBy:undefined,forcedBy:0}]).players.map(p=>p.impact)).toEqual([1.25,0,-1.25,0])
 expect(methodologyAnalysis([{...p,player:2,outcome:'double_fault',assistBy:undefined}]).players[2].impact).toBe(-2.5)
})
it('reproduces the approved stronger Coello rating and preserved historical rating',()=>{
 expect(playerScore(15.75,134)).toBe(9.3)
 expect(playerScore(19.35,134,'v1.4')).toBe(10)
})
it('preserves duration invariance and does not use the number of sets as a penalty',()=>{
 for(const impact of [-25,-1,0,15.75,40]){
  expect(playerScore(impact,134)).toBe(playerScore(impact*1.5,201))
 }
})
it('retains the gentler negative curve and safe rounding ceiling',()=>{
 expect(playerScore(-4.5,134)).toBe(3.8)
 expect(playerScore(0,134)).toBe(5)
 expect(playerScore(100,100)).toBe(9.9)
 expect(playerScore(-100,100)).toBe(1)
 expect(playerScore(0,0)).toBeNull()
})
it('does not credit unknown points or change historical bonuses',()=>{
 const p={...point,player:null,assistBy:undefined,outcome:'unclassified'}
 expect(methodologyAnalysis([p]).players.map(p=>p.impact)).toEqual([0,0,0,0])
 expect(methodologyAnalysis([p],'v1.4').players.map(p=>p.impact)).toEqual([.05,.05,0,0])
})
