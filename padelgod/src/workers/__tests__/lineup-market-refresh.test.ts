import {beforeEach,describe,expect,it,vi} from 'vitest'
const {snapshot,generator}=vi.hoisted(()=>({snapshot:vi.fn(),generator:vi.fn()}))
vi.mock('../model-prediction-snapshot.js',()=>({runModelPredictionSnapshot:snapshot}))
vi.mock('../market-generator.js',()=>({runMarketGenerator:generator}))
import {runLineupMarketRefresh} from '../lineup-market-refresh.js'
function client(rows:unknown[],error:unknown=null){
 const q:any={select:()=>q,update:()=>q,in:()=>q,eq:()=>q,not:()=>q,gt:()=>q,lte:()=>q,or:()=>q,order:()=>q,then:(r:any)=>Promise.resolve({error:null}).then(r),limit:async()=>({data:rows,error})}
 return {from:()=>q,rpc:vi.fn().mockResolvedValue({data:{processed:1,errors:0},error:null})} as any
}
const opts={dryRun:false,generateMarkets:true,generatorDryRun:false}
beforeEach(()=>{vi.clearAllMocks();snapshot.mockResolvedValue({failed:0,matchPredictionsWritten:1});generator.mockResolvedValue({created:1,errors:0,capDrops:[],gateDrops:[]})})
describe('lineup recovery',()=>{
 it('does not train or publish with no pending complete upcoming lineups',async()=>{
  await runLineupMarketRefresh({supabase:client([]),...opts})
  expect(snapshot).not.toHaveBeenCalled();expect(generator).not.toHaveBeenCalled()
 })
 it('refreshes only pending matches, reconciles before generating replacements',async()=>{
  const supabase=client([{id:'changed-match',lineup_prediction_pending:true,lineup_fingerprint:'key'}])
  await runLineupMarketRefresh({supabase,...opts})
  expect(snapshot).toHaveBeenCalledWith(expect.objectContaining({onlyMatchIds:['changed-match']}))
  expect(supabase.rpc).toHaveBeenCalledWith('play_reconcile_lineup_markets')
  expect(generator).toHaveBeenCalledWith(expect.objectContaining({onlyMatchIds:['changed-match'],dryRun:false}))
  expect(supabase.rpc.mock.invocationCallOrder[0]).toBeLessThan(generator.mock.invocationCallOrder[0])
 })
 it('retries publication without retraining when the hourly worker already refreshed the model',async()=>{
  await runLineupMarketRefresh({supabase:client([{id:'m',lineup_prediction_pending:false,lineup_fingerprint:'key'}]),...opts})
  expect(snapshot).not.toHaveBeenCalled();expect(generator).toHaveBeenCalled()
 })
 it('dry run never reconciles or publishes',async()=>{
  const supabase=client([{id:'m',lineup_prediction_pending:true,lineup_fingerprint:'key'}])
  await runLineupMarketRefresh({supabase,...opts,dryRun:true})
  expect(supabase.rpc).not.toHaveBeenCalled();expect(generator).not.toHaveBeenCalled()
 })
 it('never publishes after a snapshot failure or when publication is disabled',async()=>{
  snapshot.mockResolvedValue({failed:1})
  await runLineupMarketRefresh({supabase:client([{id:'m',lineup_prediction_pending:true,lineup_fingerprint:'key'}]),...opts})
  expect(generator).not.toHaveBeenCalled()
  snapshot.mockResolvedValue({failed:0})
  await runLineupMarketRefresh({supabase:client([{id:'m',lineup_prediction_pending:true,lineup_fingerprint:'key'}]),...opts,generateMarkets:false})
  expect(generator).not.toHaveBeenCalled()
 })
 it('surfaces read and refund errors, leaving publication to retry',async()=>{
  await expect(runLineupMarketRefresh({supabase:client([],{message:'offline'}),...opts})).rejects.toThrow('offline')
  const supabase=client([{id:'m',lineup_prediction_pending:true,lineup_fingerprint:'key'}]);supabase.rpc.mockResolvedValue({data:{errors:1}})
  await expect(runLineupMarketRefresh({supabase,...opts})).rejects.toThrow('retry')
  expect(generator).not.toHaveBeenCalled()
 })
})
