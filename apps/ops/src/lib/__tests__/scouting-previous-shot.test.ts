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
 for(const patch of [{previousPlayer:1},{previousPlayer:undefined},{previousShot:'invalid'},{outcome:'winner'},{outcome:'forced',forcedBy:3}])expect(()=>validateDoc({...freshDoc(),events:[{...error,...patch}]})).toThrow()
 expect(()=>validateDoc({...freshDoc(),events:[{...error,previousPlayer:undefined,previousShot:undefined}]})).not.toThrow()
 })
})
