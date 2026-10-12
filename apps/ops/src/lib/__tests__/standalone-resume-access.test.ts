import {it,expect,vi,beforeEach} from 'vitest'
const state=vi.hoisted(()=>({user:{id:'owner',email:'owner@example.com',isOperator:false,isScouter:true},session:null as any}))
vi.mock('@/lib/auth',()=>({auth:async()=>({user:state.user})}))
vi.mock('@/lib/supabase',()=>({serviceClient:()=>({from:(table:string)=>{
 const value=table==='matches'?{id:'match',tournament_id:'tournament',pair1_player1_id:'a',pair1_player2_id:'b',pair2_player1_id:'c',pair2_player2_id:'d'}:table==='players'?['a','b','c','d'].map(id=>({id,name:id})):table==='tournaments'?{name:'Tournament'}:table==='users'?{email:'creator@example.com'}:state.session
 const query:any={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:value,error:null}),in:async()=>({data:value,error:null})};return query
}})}))
import {GET} from '../../app/api/internal/standalone-scouting/[id]/route'
const read=()=>GET(new Request('https://admin.test'),{params:Promise.resolve({id:'11111111-1111-4111-8111-111111111111'})})
beforeEach(()=>{state.user={id:'owner',email:'owner@example.com',isOperator:false,isScouter:true};state.session={document:{captureMode:'standalone'},creator_user_id:'owner',assigned_scouter_user_id:'owner'}})
it('resumes the original owner without warning',async()=>{expect((await (await read()).json()).resumeWarning).toBeNull()})
it('warns an authorized reassigned scouter about the original creator',async()=>{state.session.creator_user_id='creator';expect((await (await read()).json()).resumeWarning).toEqual({creator:'creator@example.com',unknown:false})})
it('keeps unauthorized scouters blocked',async()=>{state.session.assigned_scouter_user_id='other';expect((await read()).status).toBe(403)})
it('allows authorized extension sessions to reach transfer confirmation',async()=>{state.session.document.captureMode='video';expect((await read()).status).toBe(200)})
