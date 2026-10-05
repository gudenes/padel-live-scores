import {beforeEach,describe,it,expect,vi} from 'vitest'
import type {SupabaseClient} from '@supabase/supabase-js'
vi.mock('../push',()=>({sendPush:vi.fn().mockResolvedValue(true)}))
vi.mock('../push-fcm',()=>({sendPushToFcmTokens:vi.fn().mockResolvedValue({success:1,failed:0,invalidTokens:[]})}))
import {sendPush} from '../push'
import {sendPushToFcmTokens} from '../push-fcm'
import {dispatchPlayResultPushes,queueMatchPlayPush} from '../play-result-push'
const player={id:'p',name:'Arturo Coello',display_name:'Coello',avatar_url:'https://padelnachos.com/coello.png'}
function fixture(overrides:Record<string,unknown>={},jobOverrides:Record<string,unknown>={}) {
 const job={user_id:'u',match_id:'m',created_at:new Date(Date.now()-180000).toISOString(),lease_token:'lease',generation:1,sent_notice_ids:[],match_sent:false,dispatch:null,...jobOverrides}
 const tables:Record<string,unknown>={feature_flags:{enabled:true},play_access:{user_id:'u'},profiles:{notification_prefs:{},notification_mute_until:null},
  market_positions:[{market_id:'a',yes_shares:380,no_shares:0,markets:{match_id:'m',status:'settled',settlement_revision:1}}],
  play_result_notices:[{id:1,market_id:'a',revision:1,outcome:'yes',delta:380,corrected:false,created_at:new Date().toISOString()}],
  matches:{id:'m',status:'finished',winner_pair:1,round:'Final',pair1_player1:player,pair1_player2:null,pair2_player1:null,pair2_player2:null,tournament:{name:'Rotterdam',level:'P2'},sets:[{set_number:1,set_score:'6-3'}]},
  user_notifications:[],user_bookmarks:[{target_id:'p'}],push_subscriptions:[{id:'device',endpoint:'https://example.test',keys:{auth:'a',p256dh:'k'}}],native_push_subscriptions:[{device_token:'token'}],play_result_push_receipts:null,play_result_push_queue:{user_id:'u'},...overrides}
 const rpc=vi.fn(async(name:string)=>({data:name==='play_claim_result_pushes'?[job]:true,error:null}))
 const from=vi.fn((table:string)=>{
  const chain:Record<string,unknown>={then:(resolve:(r:unknown)=>void)=>resolve({data:tables[table],error:null})}
  for(const name of ['select','eq','in','limit','single','maybeSingle','update','insert','upsert','delete']) chain[name]=vi.fn(()=>chain)
  return chain
 })
 return {db:{from,rpc} as unknown as SupabaseClient,rpc}
}
beforeEach(()=>{vi.clearAllMocks();vi.mocked(sendPush).mockResolvedValue(true);process.env.PLAY_RESULT_PUSH_ENABLED='true'})
describe('match + Play push dispatch',()=>{
 it('preserves the same athlete photo, match link and tag on Web and native',async()=>{
  const {db,rpc}=fixture();await dispatchPlayResultPushes(db)
  const payload=vi.mocked(sendPush).mock.calls[0][1]
  expect(payload).toMatchObject({title:'Coello won 🏆',icon:player.avatar_url,url:'/match/m',tag:'match-m'})
  expect(payload.body).toContain('380 Guacas added');expect(sendPushToFcmTokens).toHaveBeenCalledWith(['token'],payload)
  expect(rpc).toHaveBeenCalledWith('play_finish_result_push',expect.objectContaining({p_ids:[1],p_sent:true,p_retry:false}))
 })
 it.each([{play_access:null},{feature_flags:{enabled:false}},{profiles:{notification_prefs:{match_finished:{push:false}}}},{profiles:{notification_prefs:{},notification_mute_until:'forever'}}])('does not send when access/preferences deny: %j',async overrides=>{
  await dispatchPlayResultPushes(fixture(overrides).db);expect(sendPush).not.toHaveBeenCalled();expect(sendPushToFcmTokens).not.toHaveBeenCalled()
 })
 it('waits briefly for pending markets',async()=>{
  const {db,rpc}=fixture({market_positions:[{market_id:'a',yes_shares:10,no_shares:0,markets:{match_id:'m',status:'locked',settlement_revision:0}}]}, {created_at:new Date().toISOString()})
  await dispatchPlayResultPushes(db);expect(sendPush).not.toHaveBeenCalled();expect(rpc).toHaveBeenCalledWith('play_finish_result_push',expect.objectContaining({p_retry:true}))
 })
 it('sends match first after timeout without inventing an unconfirmed credit',async()=>{
  const {db}=fixture({market_positions:[{market_id:'a',yes_shares:10,no_shares:0,markets:{match_id:'m',status:'locked',settlement_revision:0}}]})
  await dispatchPlayResultPushes(db);expect(vi.mocked(sendPush).mock.calls[0][1].body).not.toContain('Guacas')
 })
 it('follows up for a late confirmed result and keeps the photo',async()=>{
  await dispatchPlayResultPushes(fixture({}, {match_sent:true}).db)
  expect(vi.mocked(sendPush).mock.calls[0][1]).toMatchObject({title:'Your prediction results are ready 🎾',icon:player.avatar_url})
 })
 it('retries failed delivery without marking results consumed',async()=>{
  vi.mocked(sendPush).mockResolvedValue(false)
  const {db,rpc}=fixture();await dispatchPlayResultPushes(db)
  expect(rpc).toHaveBeenCalledWith('play_finish_result_push',expect.objectContaining({p_ids:[],p_sent:false,p_retry:true}))
 })
 it('does not replay results already delivered',async()=>{
  await dispatchPlayResultPushes(fixture({}, {match_sent:true,sent_notice_ids:[1]}).db);expect(sendPush).not.toHaveBeenCalled()
 })
 it('leaves existing match pipeline in place when rollout switch is off',async()=>{
  process.env.PLAY_RESULT_PUSH_ENABLED='false';const {db,rpc}=fixture()
  expect(await queueMatchPlayPush(db,'u','m')).toBe(false);expect(rpc).not.toHaveBeenCalled()
 })
})
