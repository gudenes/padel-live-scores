import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendPush, type PushPayload } from './push'
import { sendPushToFcmTokens } from './push-fcm'
import { resolvePrefs } from './notification-categories'
import { resolveNotificationIcon } from './notification-icon'
import { buildFinishedContent, FINISHED_STATUSES, type MatchRow, type RecipientReason } from './match-push-content'
import { currentPushResults, playPushSummary, type PushPosition, type PushResult } from './play-result-push-copy'

interface Dispatch { createdAt: string; payload: PushPayload; ids: number[]; generation: number; hadMatch: boolean }
interface Job {
 dispatch: Dispatch | null;
 user_id: string; match_id: string; created_at: string; lease_token: string; generation: number
 sent_notice_ids: number[]; match_sent: boolean
}
const matchSelect = `id,status,round,winner_pair,pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id,
 tournament:tournaments(name,level),
 pair1_player1:players!matches_pair1_player1_id_fkey(id,name,display_name,avatar_url),
 pair1_player2:players!matches_pair1_player2_id_fkey(id,name,display_name,avatar_url),
 pair2_player1:players!matches_pair2_player1_id_fkey(id,name,display_name,avatar_url),
 pair2_player2:players!matches_pair2_player2_id_fkey(id,name,display_name,avatar_url),
 sets(set_number,set_score,pair1_games,pair2_games)`
function checked<T>(res: { data: T; error: { message: string } | null }): T {
 if (res.error) throw new Error(res.error.message)
 return res.data
}

export async function queueMatchPlayPush(db: SupabaseClient, userId: string, matchId: string): Promise<boolean> {
 if (process.env.PLAY_RESULT_PUSH_ENABLED !== 'true') return false
 const { data, error } = await db.rpc('play_queue_match_push', { p_user: userId, p_match: matchId })
 if (error) { console.error('[play-result-push] queue unavailable:', error.message); return false }
 return data === true
}

async function finish(db: SupabaseClient, job: Job, ids: number[], sent: boolean, retry: boolean) {
 checked(await db.rpc('play_finish_result_push', {
  p_user: job.user_id, p_match: job.match_id, p_token: job.lease_token,
  p_generation: job.generation, p_ids: ids, p_sent: sent, p_retry: retry,
 }))
}

async function deliver(db: SupabaseClient, job: Job, payload: PushPayload, resultIds: number[]): Promise<boolean> {
 const web = checked(await db.from('push_subscriptions').select('id,endpoint,keys').eq('user_id',job.user_id)) ?? []
 const native = checked(await db.from('native_push_subscriptions').select('device_token').eq('user_id',job.user_id)) ?? []
 // Stable content identity across retries, without storing endpoints/tokens in receipts.
 const batch = `${job.user_id}:${job.match_id}:${resultIds.length ? [...resultIds].sort((a,b)=>a-b).join(',') : 'match'}`
 let allSent = true
 for (const device of [ ...web.map(s => ({ type: 'web' as const, key: s.id, sub: s })),
  ...native.map(s => ({ type: 'native' as const, key: s.device_token, sub: s })) ]) {
  const key = createHash('sha256').update(`${batch}:${device.type}:${device.key}`).digest('hex')
  const receipt = checked(await db.from('play_result_push_receipts').select('delivery_key').eq('delivery_key',key).maybeSingle())
  if (receipt) continue
  let ok = false
  try {
   if (device.type === 'web') ok = await sendPush(device.sub, payload)
   else {
    const sent = await sendPushToFcmTokens([device.key], payload)
    ok = sent.success === 1 || sent.invalidTokens.length === 1
    if (sent.invalidTokens.length) checked(await db.from('native_push_subscriptions').delete().eq('device_token',device.key))
   }
   if (ok) checked(await db.from('play_result_push_receipts').upsert({ delivery_key: key }))
  } catch (error) { console.error('[play-result-push] delivery:', error instanceof Error ? error.message : 'failed'); ok = false }
  // Do not delete Web Push subscriptions on a transient network/server failure.
  if (!ok) allSent = false
 }
 return allSent
}

async function dispatchJob(db: SupabaseClient, job: Job) {
 const access = checked(await db.from('play_access').select('user_id').eq('user_id',job.user_id).maybeSingle())
 if (!access) return finish(db,job,[],false,false)
 const profile = checked(await db.from('profiles').select('notification_prefs,notification_mute_until').eq('id',job.user_id).single())
 if (!profile) throw new Error('Missing notification profile')
 const muted = profile.notification_mute_until === 'forever' || Date.parse(profile.notification_mute_until ?? '') > Date.now()
 if (job.dispatch && !muted && resolvePrefs(profile.notification_prefs,'match_finished').push) {
  return sendSnapshot(db,job,job.dispatch)
 }
 const positions = (checked(await db.from('market_positions').select('market_id,yes_shares,no_shares,markets!inner(match_id,status,settlement_revision)')
  .eq('user_id',job.user_id).eq('markets.match_id',job.match_id)) ?? []) as unknown as PushPosition[]
 const active = positions.filter(p => Number(p.yes_shares)+Number(p.no_shares)>0)
 if (!active.length) return finish(db,job,[],false,false)
 const notices = (checked(await db.from('play_result_notices').select('id,market_id,revision,outcome,delta,corrected,created_at')
  .eq('user_id',job.user_id).in('market_id',active.map(p=>p.market_id))) ?? []) as PushResult[]
 const results = currentPushResults(notices,active,job.sent_notice_ids)
 // Old notices are consumed silently: enabling the worker must not replay history.
 const fresh = results.filter(n => Date.now()-Date.parse(n.created_at)<86400000)
 const consumed = results.map(n=>n.id)
 if (muted || !resolvePrefs(profile.notification_prefs,'match_finished').push) return finish(db,job,consumed,true,false)
 const match = checked(await db.from('matches').select(matchSelect).eq('id',job.match_id).single()) as unknown as MatchRow
 if (!FINISHED_STATUSES.has((match.status ?? '').toLowerCase())) {
  // A set market can settle before the match ends. Wait to combine with the final.
  return finish(db,job,[],false,Date.now()-Date.parse(job.created_at)<86400000)
 }
 const pending = active.some(p => !['settled','void'].includes(p.markets.status))
 if (pending && Date.now()-Date.parse(job.created_at)<120000) return finish(db,job,[],false,true)
 const existingMatch = checked(await db.from('user_notifications').select('id').eq('user_id',job.user_id)
  .eq('category','match_finished').eq('metadata->>match_id',job.match_id).limit(1))
 const hadMatch = job.match_sent || Boolean(existingMatch?.length)
 if (!fresh.length && (hadMatch || Date.now()-Date.parse(job.created_at)>86400000)) return finish(db,job,consumed,false,false)
 const players = [match.pair1_player1,match.pair1_player2,match.pair2_player1,match.pair2_player2].filter(p=>p!==null)
 const follows = checked(await db.from('user_bookmarks').select('target_id').eq('user_id',job.user_id)
  .eq('bookmark_type','player').in('target_id',players.map(p=>p.id))) ?? []
 const followed = players.find(p=>follows.some(f=>f.target_id===p.id))
 const reason: RecipientReason = followed ? {kind:'follow',followedPlayerId:followed.id,followedPlayerName:followed.display_name || followed.name || undefined} : {kind:'bookmark'}
 const content = buildFinishedContent(match,reason,followed?.id ?? null)
 const summary = playPushSummary(fresh,active)
 const payload: PushPayload = {
  title: hadMatch ? 'Your prediction results are ready 🎾' : content.title,
  body: [content.body,summary].filter(Boolean).join('\n'),
  url: `/match/${job.match_id}`,
  tag: `match-${job.match_id}`,
  icon: resolveNotificationIcon({reason:reason.kind,tournamentLevel:match.tournament?.level ?? null,followedPlayerAvatarUrl:followed?.avatar_url}),
 }
 const snapshot: Dispatch = { createdAt: new Date().toISOString(), payload, ids: consumed, generation: job.generation, hadMatch }
 checked(await db.from('play_result_push_queue').update({dispatch:snapshot}).eq('user_id',job.user_id)
  .eq('match_id',job.match_id).eq('lease_token',job.lease_token).select('user_id').single())
 await sendSnapshot(db,job,snapshot)
}

async function sendSnapshot(db: SupabaseClient, job: Job, snapshot: Dispatch) {
 // Freeze content/IDs before the first send so a partial device failure cannot
 // replay an old payout inside a newly enlarged batch on retry.
 if (Date.now()-Date.parse(snapshot.createdAt)>86400000) return finish(db,job,snapshot.ids,true,false)
 const delivered = await deliver(db,job,snapshot.payload,snapshot.ids)
 if (!delivered) return finish(db,job,[],false,true)
 const recorded = checked(await db.from('user_notifications').select('id').eq('user_id',job.user_id)
  .eq('category','match_finished').eq('metadata->>match_id',job.match_id).limit(1))
 if (!snapshot.hadMatch && !recorded?.length) checked(await db.from('user_notifications').insert({user_id:job.user_id,category:'match_finished',
  title:snapshot.payload.title,body:snapshot.payload.body,url:snapshot.payload.url,
  metadata:{match_id:job.match_id,event:'finished',play_results:true}}))
 await finish(db,{...job,generation:snapshot.generation},snapshot.ids,true,false)
}

export async function dispatchPlayResultPushes(db: SupabaseClient) {
 const flag = checked(await db.from('feature_flags').select('enabled').eq('key','play_enabled').maybeSingle())
 if (flag?.enabled !== true) return { enabled: false, processed: 0 }
 const jobs = (checked(await db.rpc('play_claim_result_pushes')) ?? []) as Job[]
 let failed = 0
 for (const job of jobs) {
  try { await dispatchJob(db,job) }
  catch (error) {
   failed++
   console.error('[play-result-push] job:', error instanceof Error ? error.message : 'failed')
   // The lease expires even if the database is temporarily unreachable.
   await finish(db,job,[],false,true).catch(()=>{})
  }
 }
 return { processed: jobs.length, failed }
}
