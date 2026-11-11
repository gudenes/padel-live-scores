import {describe,it,expect} from 'vitest'
import {freshDoc,validateDoc,replay,type Event} from '../scouting/model'
import {pointsCsv,sessionExport} from '../scouting/export'
import {methodologyAnalysis} from '../scouting/methodology'
const players=[0,1,2,3].map(i=>({id:String(i),name:'Player '+i}))
const error:Event={kind:'point',id:'error',at:'2026-10-10T00:00:00Z',player:0,outcome:'unforced',smash:false,shot:'volley',previousPlayer:2,previousShot:'bajada'}
describe('previous opponent attribution',()=>{
 it('retains both strokes in timeline and exports without giving UE creation credit',()=>{
 const doc=validateDoc({...freshDoc(),events:[error]}),timeline=replay(doc).tracking.timeline
 expect(timeline[0]).toMatchObject({shot:'volley',previousPlayer:2,previousShot:'bajada'})
 expect(methodologyAnalysis(timeline).players[2].impact).toBe(0)
 expect(sessionExport('match',players,1,doc).summary.tracking.timeline[0].previousPlayer).toBe(2)
 expect(pointsCsv(players,doc)).toContain('"previous_player_id","previous_player_name","previous_shot"')
 expect(pointsCsv(players,doc)).toContain('"2","Player 2","bajada"')
 })
 it('requires an opponent for optional stroke and rejects invalid/conflicting attributions',()=>{
 for(const patch of [{previousPlayer:1},{previousPlayer:undefined},{previousShot:'invalid'},{outcome:'forced',forcedBy:3}])expect(()=>validateDoc({...freshDoc(),events:[{...error,...patch}]})).toThrow()
 expect(()=>validateDoc({...freshDoc(),events:[{...error,previousPlayer:undefined,previousShot:undefined}]})).not.toThrow()
 })
})

describe('winner preceding opponent stroke',()=>{
 it('survives validation, timeline and exports without forced-error credit',()=>{
 const doc=validateDoc({...freshDoc(),events:[{...error,outcome:'winner',previousShot:'lob'}]})
 const result=replay(doc)
 expect(result.tracking.timeline[0]).toMatchObject({outcome:'winner',shot:'volley',previousPlayer:2,previousShot:'lob'})
 expect(result.stats[0].winners).toBe(1)
 expect(result.stats[2].forcedErrorsCreated).toBe(0)
 expect(pointsCsv(players,doc)).toContain('"2","Player 2","lob"')
 expect(sessionExport('match',players,1,doc).summary.tracking.timeline[0].previousShot).toBe('lob')
 })
 it('counts a preceding smash attempt, but never a point won or error created for the losing opponent',()=>{
 const result=replay(validateDoc({...freshDoc(),events:[{...error,outcome:'winner',previousShot:'smash'}]}))
 expect(result.stats[2].smashes).toBe(1)
 expect(result.stats[2].smashPointsWon).toBe(0)
 expect(result.stats[2].smashErrorsGenerated).toBe(0)
 })
 it('keeps legacy winners valid and rejects teammate attribution and winner return failure',()=>{
 expect(()=>validateDoc({...freshDoc(),events:[{...error,outcome:'winner',previousPlayer:undefined,previousShot:undefined}]})).not.toThrow()
 expect(()=>validateDoc({...freshDoc(),events:[{...error,outcome:'winner',previousPlayer:1}]})).toThrow()
 expect(()=>validateDoc({...freshDoc(),events:[{...error,outcome:'winner',shot:'return',returnFailure:'net'}]})).toThrow()
 })
})
