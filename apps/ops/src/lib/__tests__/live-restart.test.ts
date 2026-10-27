import {it,expect} from 'vitest'
import {engine} from '../../../../../extensions/scouting-video-overlay/engine.mjs'
import {fresh} from '../../../../../extensions/scouting-video-overlay/core.mjs'
import {defaults,match} from '../../../../../extensions/scouting-video-overlay/match.mjs'
import {videoPayload} from '../../../../../extensions/scouting-video-overlay/server-model.mjs'
import {canRestartLiveMedia} from '../../../public/scout-web/live-player-commands.mjs'
const snap=(documentId:string,time:number)=>({documentId,time,videoId:'qiwOmZnjyLw',mediaId:'youtube:qiwOmZnjyLw',tabId:0,seekEpoch:0,readyState:4,paused:true,ended:false,seeking:false,rate:1,at:new Date().toISOString()})
it('explicit restart after refresh preserves old attempt and score, then scores only the new interval',async()=>{
 let state={...fresh(),setup:defaults(),selectedMatch:{id:'match'},connection:{selected:snap('new',50)},pending:{id:'old',start:snap('old',2),mode:'expert',touches:[{player:2,order:[0,1,2,3],snapshot:snap('old',3)}]}}
 let sample=snap('new',50)
 const deps={read:async()=>structuredClone(state),write:async(s:any)=>{state=s},capture:async()=>sample,uuid:()=>crypto.randomUUID()}
 const strict=engine(deps);await expect(strict({type:'restart-rally'})).rejects.toThrow('video changed')
 const dispatch=engine({...deps,canRestartMedia:canRestartLiveMedia});const before=match(state).score
 await dispatch({type:'restart-rally'});expect(state.cancelled[0].id).toBe('old');expect(state.pending.start.documentId).toBe('new');expect(state.pending.start.time).toBe(50);expect(match(state).score).toEqual(before)
 expect(videoPayload(state).cancelled[0].touches).toHaveLength(1)
 sample=snap('new',58);await dispatch({type:'prepare',player:1,outcome:'winner'});await dispatch({type:'score',details:{shot:'volley'}});expect(state.rallies[0].videoSeconds).toBe(8);expect(match(state).points).toBe(1)
})
it('does not allow a different video or media source',()=>{expect(canRestartLiveMedia(snap('old',2),snap('new',50))).toBe(true);expect(canRestartLiveMedia(snap('old',2),{...snap('new',50),videoId:'different'})).toBe(false);expect(canRestartLiveMedia(snap('old',2),{...snap('new',50),mediaId:'other'})).toBe(false)})
