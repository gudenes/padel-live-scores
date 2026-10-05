import { describe,it,expect } from 'vitest'
import { currentPushResults,playPushSummary,type PushResult,type PushPosition } from '../play-result-push-copy'
const pos: PushPosition={market_id:'a',yes_shares:380,no_shares:0,markets:{match_id:'m',status:'settled',settlement_revision:1}}
const win: PushResult={id:1,market_id:'a',revision:1,outcome:'yes',delta:380,corrected:false,created_at:new Date().toISOString()}
describe('confirmed match push results',()=>{
 it('counts correct choices and credits across markets, not net profit',()=>{
  const p2={...pos,market_id:'b'},p3={...pos,market_id:'c'}
  expect(playPushSummary([win,{...win,id:2,market_id:'b',delta:200},{...win,id:3,market_id:'c',outcome:'no',delta:0}],[pos,p2,p3]))
   .toBe('2 of your 3 predictions were correct. 580 Guacas added to your balance.')
 })
 it('does not claim losses remove coins or count refunds as correct',()=>{
  expect(playPushSummary([{...win,outcome:'no',delta:0}],[pos])).toBe('Your prediction results are ready.')
  expect(playPushSummary([{...win,outcome:'void',delta:100}],[pos])).toBe('Your prediction was refunded. 100 Guacas added to your balance.')
 })
 it('separates correction debits from newly received payouts',()=>{
  expect(playPushSummary([{...win,corrected:true,delta:-100}],[pos])).toBe('Result corrected · balance adjustment: -100 Guacas.')
 })
 it('does not claim a correct prediction when both sides were held',()=>{
  expect(playPushSummary([win],[{...pos,no_shares:20}])).toContain('Your prediction results are ready.')
 })
 it('excludes held, outdated, already delivered and unrelated results',()=>{
  expect(currentPushResults([win],[pos],[])).toEqual([win])
  expect(currentPushResults([win],[pos],[1])).toEqual([])
  expect(currentPushResults([win],[{...pos,markets:{...pos.markets,status:'held'}}],[])).toEqual([])
  expect(currentPushResults([win],[{...pos,markets:{...pos.markets,settlement_revision:2}}],[])).toEqual([])
  expect(currentPushResults([{...win,market_id:'elsewhere'}],[pos],[])).toEqual([])
 })
})
