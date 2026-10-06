import {it,expect,vi} from 'vitest'
const db=vi.hoisted(()=>({session:null as any}))
vi.mock('@/lib/auth',()=>({auth:async()=>({user:{isOperator:true,email:'operator@test'}})}))
vi.mock('@/lib/supabase',()=>({serviceClient:()=>({from:(table:string)=>{
 let row:any=null,operation='read',revision:number|undefined
 const query:any={select:()=>query,in:()=>query,eq:(key:string,value:unknown)=>{if(key==='revision')revision=Number(value);return query;},insert:(value:unknown)=>{row=value;operation='insert';return query;},update:(value:unknown)=>{row=value;operation='update';return query;}}
 const execute=()=>{
  if(table==='matches')return {data:{pair1_player1_id:'a1',pair1_player2_id:'a2',pair2_player1_id:'b1',pair2_player2_id:'b2'}}
  if(table==='players')return {data:['a1','a2','b1','b2'].map(id=>({id,name:id}))}
  if(operation==='insert'&&db.session)return {error:{code:'23505'}}
  if(operation==='update'&&db.session?.revision!==revision)return {data:null,error:null}
  if(operation!=='read'){db.session=structuredClone(row);return {data:{revision:row.revision}}}
  return {data:structuredClone(db.session)}
 }
 query.maybeSingle=query.single=async()=>execute();query.then=(resolve:any)=>Promise.resolve(execute()).then(resolve);return query
}})}))
import {GET,POST} from '../route'
// The extension module is JavaScript and runs unchanged in Chrome.
// @ts-expect-error No TypeScript declaration is needed by the browser module.
import {cloudSync} from '../../../../../../../../../extensions/scouting-video-overlay/cloud.mjs'
it('uploads a browser point through the real API and reloads the confirmed score on another browser',async()=>{
 db.session=null
 const matchId='11111111-1111-4111-8111-111111111111',ctx={params:Promise.resolve({id:matchId})},url='https://admin.test/api/internal/video-scouting/'+matchId
 let store:any,serial=0
 const request=async (r:any)=>{
  const req=new Request(url,{method:r.method,headers:{origin:'https://admin.test',host:'admin.test','content-type':'application/json'},...(r.method==='POST'?{body:JSON.stringify({document:r.document,revision:r.revision,writeId:r.writeId})}:{})})
  const response=await (r.method==='POST'?POST:GET)(req,ctx);return {...await response.json(),ok:response.ok,status:response.status}
 }
 const sync=cloudSync({read:async()=>structuredClone(store),write:async(s:any)=>{store=structuredClone(s)},uuid:()=>`${String(++serial).padStart(8,'0')}-1111-4111-8111-111111111111`,request})
 const snap=(time:number)=>({tabId:7,documentId:'doc',videoId:'video',mediaId:'media',time,at:'2026-10-06T12:00:00Z',readyState:4,seekEpoch:0,paused:false})
 const state={version:1,selectedMatch:{id:matchId},label:'Replay',setup:{names:['a1','a2','b1','b2'],firstServer:0,otherServer:2,rule:'star-point'},cancelled:[],pending:null,rallies:[{id:'r',label:'Replay',start:snap(100),end:snap(105),point:{player:0,outcome:'winner',shot:'volley'}}]}
 await sync.track(state);await sync.flush()
 expect((await sync.status(matchId)).status).toBe('saved');expect(db.session.score.currentGame.a).toBe(15);expect(db.session.document.rallies[0].point.shot).toBe('volley');expect(db.session.document.rallies[0].videoSeconds).toBe(5)
 let secondStore:any
 const second=cloudSync({read:async()=>structuredClone(secondStore),write:async(s:any)=>{secondStore=structuredClone(s)},uuid:()=>`${String(++serial).padStart(8,'0')}-1111-4111-8111-111111111111`,request})
 const remote=await second.load(matchId);await second.acknowledge(matchId,remote)
 expect(remote.payload.rallies).toHaveLength(1);expect((await second.status(matchId)).revision).toBe(1)
})
