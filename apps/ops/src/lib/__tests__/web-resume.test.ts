import {it,expect} from 'vitest'
import {webResumeState} from '../../../public/scout-web/web-resume.mjs'
import {validateVideoState,videoSummary} from '../../../../../extensions/scouting-video-overlay/server-model.mjs'
it('preserves scores and completed video history while rebinding a pending rally',()=>{
 const snap=(time:number)=>({tabId:7,documentId:'old',videoId:'video',mediaId:'old',time,at:'2026-10-06T12:00:00Z',readyState:4,seekEpoch:0,paused:false})
 const document={version:1,setup:{names:['A','B','C','D'],firstServer:0,otherServer:2,rule:'star-point'},label:'Match',cancelled:[],rallies:[{id:'r1',start:snap(10),end:snap(20),point:{player:0,outcome:'winner',shot:'volley'}}],pending:{id:'r2',start:snap(30),touches:[{player:2,order:[0,1,2,3],snapshot:snap(31)}]}}
 const converted=validateVideoState(webResumeState(document,'match'))
 expect(videoSummary(converted).score).toEqual(videoSummary(validateVideoState(document)).score)
 expect(converted.rallies).toEqual(validateVideoState(document).rallies)
 expect(converted.pending).toMatchObject({start:{documentId:'standalone:match'},touches:[{snapshot:{documentId:'standalone:match'}}]})
 expect(document.pending.start.documentId).toBe('old')
})
