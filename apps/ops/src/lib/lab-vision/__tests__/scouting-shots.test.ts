import {describe,it,expect} from 'vitest'
import {scoutingShots} from '../scouting-shots'
import {parseAnnotation} from '../annotations'
const id='872e6f34-5304-42a7-a23c-685a25c72340',rally='7d77e5e5-ea55-4e53-9f51-f9103d6ac50b'
const doc={matchId:id,players:[{id:'p0',name:'A'},{id:'p1',name:'B'}],originalDocument:{setup:{firstServer:1},rallies:[{id:rally,start:{time:100},touches:[{player:0,snapshot:{time:102}},{player:1,snapshot:{time:104}}],point:{player:1,shot:'return'}}]}}
describe('scouting shot proposals',()=>{
 it('keeps source taps, separate starts and unknown strokes',()=>{const d=scoutingShots(doc);expect(d.shots).toHaveLength(3);expect(d.shots[0]).toMatchObject({sourceTime:100,playerName:'B',shot:'Serve'});expect(d.shots[1].shot).toBe('Unknown');expect(d.shots[2]).toMatchObject({role:'Return of serve',shot:'Unknown'});expect(scoutingShots(doc)).toEqual(d)})
 it('maps explicit smash attempts without creating duplicate contacts',()=>{const d=structuredClone(doc) as any;d.originalDocument.rallies[0].attempts=[{touchIndex:0,player:0}];expect(scoutingShots(d).shots[1].shot).toBe('Smash');expect(scoutingShots(d).shots).toHaveLength(3)})
 it('does not infer later servers from first-server metadata',()=>{const d=structuredClone(doc) as any;d.originalDocument.rallies.push({...d.originalDocument.rallies[0],id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'});expect(scoutingShots(d).shots[3].playerId).toBeNull()})
 it('retains corrected video time independently of original tap time',()=>{const a=parseAnnotation({kind:'Shot contact',shot:'Volley',side:'Backhand',direction:'Unknown',status:'verified',confirmed:true,time:9,start:8,end:10,player:'A',notes:'',candidateId:`scout:${id}:${rally}:touch-0`,shotRole:'Return of serve',scoutSource:{time:102,offset:94,point:1}},100,['A','B']);expect(a.time).toBe(9);expect(a.scoutSource?.time).toBe(102);expect(a.shotRole).toBe('Return of serve')})
})

describe('quick review labels',()=>{
 const base={kind:'Shot contact',shot:'Unknown',side:'Unknown',direction:'Unknown',status:'needs_review',confirmed:false,time:9,start:8,end:10,player:'A',notes:'',candidateId:`scout:${id}:${rally}:touch-0`,quickDecision:'shot'}
 it('approves an event without claiming exact timing or shot classification',()=>{const a=parseAnnotation(base,100,['A','B']);expect(a.quickDecision).toBe('shot');expect(a.timingVerified).toBe(false);expect(a.status).toBe('needs_review')})
 it('confirms contact timing only on explicit approval',()=>{const a=parseAnnotation({...base,confirmed:true,status:'verified'},100,['A','B']);expect(a.timingVerified).toBe(true);expect(a.classificationReviewed).toBe(false);expect(a.playerIdentityVerified).toBe(false)})
 it('permits shot approval and negatives without identity',()=>{expect(parseAnnotation({...base,player:''},100,['A']).quickDecision).toBe('shot');expect(parseAnnotation({...base,player:'',status:'excluded',quickDecision:'not_contact'},100,['A']).quickDecision).toBe('not_contact')})
})

it('keeps reviewed shot classification separate from timing and identity',()=>{const a=parseAnnotation({kind:'Shot contact',shot:'Volley',side:'Backhand',direction:'Unknown',status:'needs_review',confirmed:false,time:9,start:8,end:10,player:'',notes:'',candidateId:`scout:${id}:${rally}:touch-0`,quickDecision:'shot',classificationReviewed:true},100,[]);expect(a.classificationReviewed).toBe(true);expect(a.timingVerified).toBe(false);expect(a.playerIdentityVerified).toBe(false);expect(a.side).toBe('Backhand')})
