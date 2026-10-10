import {beforeEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({operator:true,error:null as unknown,calls:[] as unknown[],rows:[] as unknown[]}))
vi.mock('@/lib/auth',()=>({auth:async()=>({user:{isOperator:mocks.operator}})}))
vi.mock('@/lib/supabase',()=>({serviceClient:()=>({from:(table:string)=>({select:(fields:string)=>({in:async(key:string,ids:string[])=>{mocks.calls.push([table,fields,key,ids]);return {data:mocks.rows,error:mocks.error}}})})})}))
import {GET} from '../route'
const id='00000000-0000-0000-0000-000000000001'
const request=(ids=id)=>new Request('https://admin.padelnachos.com/api/internal/scouting-coaches?players='+ids)
beforeEach(()=>{mocks.operator=true;mocks.error=null;mocks.calls=[];mocks.rows=[]})
it('requires scouting access and valid bounded player IDs',async()=>{mocks.operator=false;expect((await GET(request())).status).toBe(401);mocks.operator=true;expect((await GET(request('invalid'))).status).toBe(400);expect(mocks.calls).toEqual([])})
it('returns only linked canonical coach suggestions',async()=>{mocks.rows=[{player_id:id,coach_id:id,display_name:'Coach'}];expect(await (await GET(request())).json()).toEqual({coaches:[{playerId:id,id,name:'Coach'}]});expect(mocks.calls).toEqual([['player_coaches_public','player_id,coach_id,display_name','player_id',[id]]])})
it('reports lookup failure rather than treating it as no coaches',async()=>{mocks.error={message:'unavailable'};expect((await GET(request())).status).toBe(503)})
