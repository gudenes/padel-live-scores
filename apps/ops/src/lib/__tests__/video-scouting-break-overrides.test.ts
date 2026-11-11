import {expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({row:null as any,write:null as any}))
vi.mock('@/lib/auth',()=>({auth:async()=>({user:{id:'operator',isOperator:true}})}))
vi.mock('@/lib/supabase',()=>({serviceClient:()=>({from:()=>{
 let pending:any=null
 const query:any={select:()=>query,eq:()=>query,update:(row:any)=>{pending=row;return query},maybeSingle:async()=>{
  if(pending){mocks.write=pending;mocks.row=pending;return {data:{revision:pending.revision},error:null}}
  return {data:mocks.row,error:null}
 }}
 return query
}})}))
import {videoScoutingApi} from '@/lib/video-scouting-api'
import {validateVideoState} from '../../../../../extensions/scouting-video-overlay/server-model.mjs'
it('preserves corrections from an older client and accepts retries without rewriting',async()=>{
 const document=validateVideoState({version:1,label:'',setup:{names:['A1','A2','B1','B2'],firstServer:0,otherServer:2,rule:'star-point'},rallies:[],cancelled:[],pending:null})
 mocks.row={document:{...document,setup:{...document.setup,suppressedBreaks:[{set:2,game:9},{set:2,game:10}]}},revision:7,write_id:'old',players:[]}
 const api=videoScoutingApi({table:'operator_video_scouting_sessions',roster:async()=>[]})
 const id='11111111-1111-4111-8111-111111111111',writeId='22222222-2222-4222-8222-222222222222'
 const request=()=>new Request(`https://admin.test/api/internal/video-scouting/${id}`,{method:'POST',headers:{origin:'https://admin.test',host:'admin.test'},body:JSON.stringify({document,revision:7,writeId})})
 const ctx={params:Promise.resolve({id})}
 expect((await api.POST(request(),ctx)).status).toBe(200)
 expect(mocks.write.document.setup.suppressedBreaks).toEqual([{set:2,game:9},{set:2,game:10}])
 expect(mocks.write.revision).toBe(8)
 mocks.write=null
 expect((await api.POST(request(),ctx)).status).toBe(200)
 expect(mocks.write).toBe(null)
})
