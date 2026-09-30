import { describe, it, expect } from 'vitest'
import { editorialKind, fetchEditorialViews } from './_editorial'
import { describeMarket, type MarketRow } from './_shared'
import type { SupabaseClient } from '@supabase/supabase-js'
const row={id:'m',resolver_key:'season.pair_title_count_v1',resolver_params:{player1Id:'a',player2Id:'b',titles:2,tournamentIds:['event']},category:'men',seed_prob:.6,seed_source:'fixed',tokens:{price_source:'Editorial estimate'},lmsr_b:1000,q_yes:0,q_no:0,volume_guacas:0,locks_at:'2026-10-01',match:null,template:{horizon:'season'},tournament:null} as unknown as MarketRow
function db(finals:unknown[],error:unknown=null) {
 const chain:any={select(){return this},in(){return this},eq(){return this},limit(){return this},then(resolve:any){return Promise.resolve({data:finals,error}).then(resolve)}}
 return {from(table:string){return table==='players'?{select:()=>({in:async()=>({data:[{id:'a',name:'A',ranking:null},{id:'b',name:'B',ranking:2}],error:null})})}:chain}} as unknown as SupabaseClient
}
describe('editorial enrichment',()=>{
 it('does not describe editorial seeds as historical statistics or live model forecasts',()=>{const view=describeMarket(row,'en');expect(view.baselineProb).toBeNull();expect(view.modelProb).toBeNull();expect(view.priceYes).toBe(.5)})
 it('counts only exact-pair finals in the market category',async()=>{const finals=[{tournament_id:'event',category:'men',status:'finished',winner_pair:2,pair2_player1_id:'b',pair2_player2_id:'a'}];expect((await fetchEditorialViews(db(finals),[row])).get('m')?.completed).toBe(1);expect((await fetchEditorialViews(db([{...finals[0],category:'women'}]),[row])).get('m')?.completed).toBe(0)})
 it('preserves unknown progress on query failure and ambiguous finals',async()=>{expect((await fetchEditorialViews(db([],{message:'offline'}),[row])).get('m')?.completed).toBeNull();const f={tournament_id:'event',category:'men'};expect((await fetchEditorialViews(db([f,f]),[row])).get('m')?.completed).toBeNull()})
 it('leaves existing match cards out of editorial enrichment',async()=>{expect(editorialKind('match.winner')).toBeNull();expect((await fetchEditorialViews(db([]),[{...row,resolver_key:'match.winner'}])).size).toBe(0)})
})
