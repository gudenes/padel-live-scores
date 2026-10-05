import {it,expect} from 'vitest'
import {resultPanelData} from '../play-result-panel'
import {categoryFilter} from '../notification-categories'
import type {PlayPosition} from '@/app/[locale]/(app)/play/_components/types'
const p:PlayPosition={marketId:'market',publicId:'m1',question:'Win?',context:'Final',matchLabel:'A vs B',live:false,status:'settled',side:'yes',shares:380,costBasis:200,avgPrice:.5,currentPrice:1,valueNow:380,deltaPct:90,result:'won'}
const n={id:'notice',created_at:'2026-10-04',metadata:{market_id:'market',revision:1,delta:380}}
it('keeps returned stake separate from net winnings',()=>{const r=resultPanelData(n,[p])!;expect(r.paid).toBe(380);expect(r.paid-r.cost).toBe(180);expect(r.kind).toBe('won')})
it('zero credit is an incorrect prediction, not a second deduction',()=>{const r=resultPanelData({...n,metadata:{...n.metadata,delta:0}},[{...p,result:'lost',valueNow:0}])!;expect(r.kind).toBe('lost');expect(r.delta).toBe(0);expect(r.cost).toBe(200)})
it('distinguishes refunds and corrections from wins',()=>{expect(resultPanelData(n,[{...p,status:'void',result:'refunded',valueNow:200}])?.kind).toBe('refunded');expect(resultPanelData({...n,metadata:{...n.metadata,revision:2,delta:-380}},[{...p,result:'lost',corrected:true,valueNow:0}])).toMatchObject({kind:'corrected',delta:-380})})
it('does not show pending or stale pre-correction results',()=>{expect(resultPanelData(n,[{...p,status:'held',result:'pending'}])).toBeNull();expect(resultPanelData(n,[{...p,corrected:true}])).toBeNull();expect(resultPanelData(n,[])).toBeNull()})
it('combines two sides without pretending both were correct',()=>{expect(resultPanelData(n,[{...p,costBasis:150},{...p,side:'no',costBasis:50,valueNow:0,result:'lost'}])).toMatchObject({paid:380,cost:200,kind:'mixed',side:'both'})})
it('includes settlements in Updates, not match notifications',()=>{expect(categoryFilter('updates')).toContain('play_result');expect(categoryFilter('matches')).not.toContain('play_result')})
