// @vitest-environment jsdom
import {createElement} from 'react'
import {render,screen,cleanup} from '@testing-library/react'
import {it,expect,vi,afterEach} from 'vitest'
import MatchCard,{type MatchCardRow} from '../../app/(scouting)/scouting/MatchCard'
vi.mock('next/link',()=>({default:(props:Record<string,unknown>)=>createElement('a',props),useLinkStatus:()=>({pending:false})}))
afterEach(cleanup)
const row:MatchCardRow={kind:'match',match_id:'example',has_scouting:false,has_pbp:true,players:['One','Two','Three','Four'].map((name,i)=>({name,id:String(i)})),source:'video',document:null,revision:0,updated_at:'2026-10-12T00:00:00Z',tournament_name:'Example',official_sets:[{a:6,b:4}],match_status:'finished'}
it('provides a full-card native insights link for unscouted PBP matches',()=>{
 render(createElement(MatchCard,{row,user:{isViewer:true}}))
 const main=screen.getByRole('link',{name:'Open insights: One / Two / Three / Four'})
 expect(main.getAttribute('href')).toBe('/scouting/example/report');expect(main.className).toContain('cardLink')
 expect(screen.getByText('Official PBP insights available')).toBeTruthy();expect(screen.getByRole('link',{name:'Open insights'}).getAttribute('href')).toBe(main.getAttribute('href'))
})
it('lets cards without scouting open official match details and keeps private routes private',()=>{
 render(createElement(MatchCard,{row:{...row,kind:'private',has_pbp:false}}))
 expect(screen.getByRole('link',{name:'Open insights: One / Two / Three / Four'}).getAttribute('href')).toBe('/scouting/manual/example/report')
 expect(screen.getByText('Official match details')).toBeTruthy()
})
