import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {PGlite} from '@electric-sql/pglite'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
const state=vi.hoisted(()=>({db:null as unknown as PGlite}))
vi.mock('@/lib/db',()=>({pgPool:()=>({
 query:(sql:string,args?:unknown[])=>state.db.query(sql,args),
 connect:async()=>({query:(sql:string,args?:unknown[])=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):state.db.query(sql,args),release:()=>{}})
})}))
import {mutatePlayerViews,listPlayerViews} from '../player-view-store'
import {parseViewMutation} from '../account-player-views'
const alice='00000000-0000-4000-8000-000000000001',bob='00000000-0000-4000-8000-000000000002',id='10000000-0000-4000-8000-000000000001'
const view=(overrides={})=>({id,name:'Catalunya players',match:'all' as const,rules:[{field:'birth_region' as const,operator:'is' as const,value:'ES:09'}],search:{q:'',gender:'',year:'2026',sort:'rank:asc',filter:'all'},...overrides})
beforeEach(async()=>{
 state.db=new PGlite()
 await state.db.exec('create role anon;create role authenticated;create role service_role;create table users(id uuid primary key);')
 await state.db.query('insert into users(id) values($1),($2)',[alice,bob])
 await state.db.exec(readFileSync(resolve(process.cwd(),'../../supabase/migrations/20261119160000_account_player_views.sql'),'utf8'))
})
afterEach(async()=>{await state.db.close()})
describe('account saved views',()=>{
 it('persists preferences, isolates owners and refuses cross-account edits/deletes',async()=>{
  await mutatePlayerViews(alice,{action:'save',view:view(),revision:0})
  expect(await listPlayerViews(bob)).toEqual([])
  await expect(mutatePlayerViews(bob,{action:'save',view:view({name:'Stolen'}),revision:1})).rejects.toMatchObject({status:409})
  await expect(mutatePlayerViews(bob,{action:'delete',id,revision:1})).rejects.toMatchObject({status:404})
  expect((await listPlayerViews(alice))[0]).toMatchObject({...view(),revision:1})
 })
 it('rejects stale updates and stale deletion, preserving the newer data',async()=>{
  await mutatePlayerViews(alice,{action:'save',view:view(),revision:0})
  await mutatePlayerViews(alice,{action:'save',view:view({name:'Updated'}),revision:1})
  await expect(mutatePlayerViews(alice,{action:'save',view:view({name:'Stale'}),revision:1})).rejects.toMatchObject({status:409})
  await expect(mutatePlayerViews(alice,{action:'delete',id,revision:1})).rejects.toMatchObject({status:409})
  expect((await listPlayerViews(alice))[0]).toMatchObject({name:'Updated',revision:2})
 })
 it('imports idempotently without overwriting edits or resurrecting deleted views',async()=>{
  const mutation={action:'import' as const,views:[view()]}
  await mutatePlayerViews(alice,mutation);await mutatePlayerViews(alice,mutation)
  expect(await listPlayerViews(alice)).toHaveLength(1)
  await mutatePlayerViews(alice,{action:'save',view:view({name:'Edited elsewhere'}),revision:1})
  await mutatePlayerViews(alice,mutation)
  expect((await listPlayerViews(alice))[0].name).toBe('Edited elsewhere')
  await mutatePlayerViews(alice,{action:'delete',id,revision:2})
  await mutatePlayerViews(alice,mutation)
  expect(await listPlayerViews(alice)).toEqual([])
 })
 it('keeps distinct browser views with conflicting names and deduplicates equivalent searches',async()=>{
  await mutatePlayerViews(alice,{action:'import',views:[view()]})
  await mutatePlayerViews(alice,{action:'import',views:[view({id:bob})]})
  expect(await listPlayerViews(alice)).toHaveLength(1)
  const different=view({id:bob,search:{...view().search,gender:'women'}})
  await mutatePlayerViews(alice,{action:'import',views:[different]})
  expect((await listPlayerViews(alice)).map(v=>v.name)).toContain('Catalunya players (imported 2)')
 })
 it('denies direct public access and enables RLS',async()=>{
  expect((await state.db.query<{relrowsecurity:boolean}>("select relrowsecurity from pg_class where relname='scouting_player_views'")).rows[0].relrowsecurity).toBe(true)
  for(const role of ['anon','authenticated'])expect((await state.db.query<{allowed:boolean}>("select has_table_privilege($1,'scouting_player_views','SELECT') as allowed",[role])).rows[0].allowed).toBe(false)
 })
 it('validates untrusted preferences',()=>{
  expect(()=>parseViewMutation({action:'save',revision:0,view:view({id:'bad'})})).toThrow()
  expect(()=>parseViewMutation({action:'save',revision:0,view:view({name:'x'.repeat(81)})})).toThrow()
  expect(()=>parseViewMutation({action:'save',revision:0,view:view({search:{...view().search,year:'%'}})})).toThrow()
  expect(()=>parseViewMutation({action:'delete',id,revision:-1})).toThrow()
 })
})
