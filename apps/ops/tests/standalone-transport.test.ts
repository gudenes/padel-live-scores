import {afterEach,beforeEach,expect,it,vi} from 'vitest'
const id='11111111-1111-4111-8111-111111111111'
let disk:any,remote:any,posts:any[],failPost:boolean
const clone=(x:any)=>structuredClone(x)
beforeEach(()=>{
 vi.resetModules();vi.useFakeTimers();disk=null;remote=null;posts=[];failPost=false
 vi.stubGlobal('location',{href:'https://admin.test/scout-web/panel.html?matchId='+id,origin:'https://admin.test'})
 vi.stubGlobal('addEventListener',vi.fn())
 vi.stubGlobal('navigator',{locks:{request:async(_key:any,_options:any,callback:any)=>callback({})}})
 vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn()})
 // Model asynchronous IndexedDB completion; writes become durable only on completion.
 vi.stubGlobal('indexedDB',{open:()=>{
  const request:any={result:{transaction:()=>{
   const tx:any={objectStore:()=>({get:()=>{const read:any={};Promise.resolve().then(()=>{read.result=clone(disk);read.onsuccess()});return read},put:(value:any)=>{Promise.resolve().then(()=>{disk=clone(value);tx.oncomplete()})}})};return tx
  }}};Promise.resolve().then(()=>request.onsuccess());return request
 }})
 vi.stubGlobal('fetch',vi.fn(async(_url:string,options:any={})=>{
  if(options.method==='POST'){
   const body=JSON.parse(options.body);posts.push(body)
   if(failPost)throw Error('Network unavailable')
   remote={revision:body.revision+1,write_id:body.writeId,document:body.document}
   return Response.json({revision:remote.revision,savedAt:'now'})
  }
  return Response.json({user:{id:'user',email:'scouter@test'},match:{id,names:['A','B','C','D'],playerIds:['a','b','c','d']},session:remote})
 }))
})
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()})
async function transport(){
 // @ts-expect-error Browser module is tested through its transport interface.
 return import('../public/scout-web/standalone-transport.mjs')
}
it('persists local changes before contacting the server, then sends the standalone marker',async()=>{
 const {send}=await transport();expect((await send({type:'label',label:'Local change'})).ok).toBe(true)
 expect(disk.state.label).toBe('Local change');expect(posts).toHaveLength(0)
 await send({type:'sync-server'});expect(posts).toHaveLength(1)
 expect(posts[0].document.captureMode).toBe('standalone');expect(disk.dirty).toBe(false)
})
it('reuses the durable write ID after a failed request and preserves later edits',async()=>{
 const {send}=await transport();await send({type:'label',label:'First'});failPost=true;await send({type:'sync-server'})
 const first=clone(disk.outbox);expect(first.document.label).toBe('First')
 await send({type:'label',label:'Second'});failPost=false;await send({type:'sync-server'})
 expect(posts[1]).toEqual(first);expect(disk.dirty).toBe(true);expect(disk.state.label).toBe('Second')
 await send({type:'sync-server'});expect(posts[2].revision).toBe(1);expect(posts[2].document.label).toBe('Second');expect(disk.dirty).toBe(false)
})
it('keeps unsent changes after reload and retries the same outbox',async()=>{
 const initial=await transport();await initial.send({type:'label',label:'Offline'});failPost=true;await initial.send({type:'sync-server'});const pending=clone(disk.outbox)
 vi.resetModules();failPost=false;const resumed=await transport()
 expect((await resumed.send({type:'state'})).state.label).toBe('Offline')
 await resumed.send({type:'sync-server'});expect(posts.at(-1)).toEqual(pending)
})
it('blocks mutations on a remote revision conflict without discarding the local backup',async()=>{
 const initial=await transport();await initial.send({type:'label',label:'Mine'})
 remote={revision:4,write_id:'someone-else',document:{captureMode:'standalone'}}
 vi.resetModules();const resumed=await transport();const result=await resumed.send({type:'label',label:'Overwrite'})
 expect(result.ok).toBe(false);expect(disk.state.label).toBe('Mine');expect(posts).toHaveLength(0)
})
it('returns a fresh clock with start so the first tap is immediately usable',async()=>{
 const {send}=await transport()
 await send({type:'complete-onboarding',setup:{names:['A','B','C','D'],firstServer:0,otherServer:2,rule:'star-point',firstServerUnknown:false,otherServerUnknown:false}})
 const started=await send({type:'start'})
 expect(started.ok).toBe(true)
 expect(started.sample.time).toBeGreaterThanOrEqual(started.state.pending.start.time)
 const touched=await send({type:'touch',player:2,order:[0,1,2,3]})
 expect(touched.ok).toBe(true);expect(touched.state.pending.touches).toHaveLength(1)
})
