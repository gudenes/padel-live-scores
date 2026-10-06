import type {SupabaseClient} from '@supabase/supabase-js'
import type {Logger} from 'pino'
import {runModelPredictionSnapshot} from './model-prediction-snapshot.js'
import {runMarketGenerator} from './market-generator.js'

/** Separate prediction/publication flags keep retries alive after model success. */
export async function runLineupMarketRefresh(deps:{supabase:SupabaseClient;logger?:Logger;dryRun:boolean;generateMarkets:boolean;generatorDryRun:boolean}) {
 const now=Date.now()
 const {data,error}=await deps.supabase.from('matches')
  .select('id,lineup_fingerprint,lineup_prediction_pending,tournament:tournaments!inner(level)')
  .in('tournament.level',['major','p1','p2','fip_platinum','fip_gold'])
  .in('round_canonical',['R32','R16','QF','SF','F'])
  .or('lineup_prediction_pending.eq.true,lineup_market_refresh_pending.eq.true').eq('status','scheduled')
  .not('lineup_fingerprint','is',null).gt('scheduled_at',new Date(now).toISOString())
  .lte('scheduled_at',new Date(now+14*86400000).toISOString()).order('scheduled_at').limit(100)
 if(error)throw new Error(error.message)
 if(!data?.length)return {pending:0}
 const onlyMatchIds=data.map(m=>m.id as string)
 const toPredict=data.filter(m=>m.lineup_prediction_pending).map(m=>m.id as string)
 const snapshot=toPredict.length ? await runModelPredictionSnapshot({...deps,onlyMatchIds:toPredict}) : {failed:0}
 if(!deps.dryRun){
  const r=await deps.supabase.rpc('play_reconcile_lineup_markets')
  if(r.error)throw new Error(r.error.message)
  if(r.data?.errors)throw new Error('lineup reconciliation needs retry')
 }
 if(deps.generateMarkets && !deps.dryRun && !snapshot.failed){
  const result=await runMarketGenerator({...deps,dryRun:deps.generatorDryRun,onlyMatchIds})
  if(!deps.generatorDryRun && !result.errors && !result.capDrops.length && !result.gateDrops.length){
   for(const m of data){
    const r=await deps.supabase.from('matches').update({lineup_market_refresh_pending:false})
     .eq('id',m.id).eq('lineup_fingerprint',m.lineup_fingerprint).eq('lineup_prediction_pending',false)
    if(r.error)throw new Error(r.error.message)
   }
  }
 }
 return {pending:data.length,...snapshot}
}
