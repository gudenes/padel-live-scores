import {expect,it,vi} from 'vitest'
import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import PbpInsightsView from '@/app/(scouting)/scouting/[id]/report/view/PbpInsightsView'
import type {ReportContext} from '@/lib/scouting/report-view'
vi.mock('next/link',()=>({default:({href,children,...props}:any)=>createElement('a',{href,...props},children)}))
const context:ReportContext={meta:{duration:null,round:'R32',category:'men',tournament:'Test',scheduled_at:'2026-10-27'},avatars:{},pbp:[],status:'scheduled',players:['a','b','c','d'].map((id,i)=>({id,name:id,ranking:i+1}))}
it('opens scheduled official matches on preparation and avoids empty live charts',()=>{
 const html=renderToStaticMarkup(createElement(PbpInsightsView,{context,matchId:'match',onScopeChange:()=>{}}))
 expect(html).toContain('Loading pre-game comparison');expect(html).toContain('World #');expect(html).not.toContain('No PBP sequence');expect(html).not.toContain('Full match</button>')
})
it('keeps completed reports on overview and manual reports without preparation',()=>{
 const html=renderToStaticMarkup(createElement(PbpInsightsView,{context:{...context,status:'finished'},matchId:'match',onScopeChange:()=>{}}))
 expect(html).toContain('Match momentum');expect(html).not.toContain('Loading pre-game comparison')
 const manual=renderToStaticMarkup(createElement(PbpInsightsView,{context,onScopeChange:()=>{}}))
 expect(manual).not.toContain('Pre-game</button>')
})

it('preserves recorded set scores and distinguishes known winners from missing sets',async()=>{
 const {Meetings}=await import('@/app/(scouting)/scouting/[id]/report/view/PreGameComparison')
 const base={id:'past',manual:false,date:'2025-10-01',tournament:'Rotterdam',tournamentId:null,level:null,round:'R32',status:'finished',winner:2,playerIds:['a','b','c','d'],names:['A','B','C','D'],scouted:false}
 const scored=renderToStaticMarkup(createElement(Meetings,{matches:[{...base,score:'6–1  3–6  4–6'}]}))
 expect(scored).toContain('6–1  3–6  4–6');expect(scored).toContain('C / D');expect(scored).toContain('Winner');expect(scored).not.toContain('Set scores unavailable')
 const missing=renderToStaticMarkup(createElement(Meetings,{matches:[{...base,score:''}]}))
 expect(missing).toContain('Result recorded');expect(missing).toContain('Set scores unavailable');expect(missing).toContain('Winner');expect(missing).not.toContain('Score not recorded')
})
