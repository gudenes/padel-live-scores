import {describe,it,expect,vi} from 'vitest'
import {catalogFilters,catalogUrl,loadMatchCatalog,MATCH_PAGE_SIZE} from '../match-catalog'
const row=(n:number,scouted=false)=>({match_id:String(n),kind:'match',has_scouting:scouted,players:[{id:'a',name:'Catalog A',avatar_url:'photo-a',country:'AR',ranking:3}]})
describe('paginated match catalog',()=>{
 it('defaults to all matches and bounds malformed filter/page input',()=>{
  expect(catalogFilters({})).toEqual({tournament:'',tournamentLabel:'',watchlist:'',watched:'',mine:'',player:'',league:'',q:'',status:'',kind:'',scouting:'',scouter:'',date:'',page:1})
  expect(catalogFilters({page:'-7',status:'injected',kind:['private'],scouting:'bogus',date:'anything'})).toMatchObject({page:1,status:'',kind:'',scouting:'',date:''})
  expect(catalogFilters({page:'99999999'}).page).toBe(100000)
 })
 it('preserves filters across pages and resets page when switching scouting filter',()=>{
  const filters=catalogFilters({q:'Tapia & Coello',scouting:'scouted',status:'finished',page:'3'})
  const url=new URL(catalogUrl(filters,{page:4}),'https://admin.example')
  expect(url.searchParams.get('q')).toBe('Tapia & Coello');expect(url.searchParams.get('scouting')).toBe('scouted');expect(url.searchParams.get('page')).toBe('4')
  expect(catalogUrl(filters,{scouting:'unscouted',page:1})).not.toContain('page=')
 })
 it('fetches one page plus a sentinel, orders by match date, and never loads unscouted documents',async()=>{
  const query=vi.fn().mockResolvedValueOnce({rows:Array.from({length:25},(_,i)=>row(i))})
  const result=await loadMatchCatalog({query} as any,catalogFilters({page:'2'}))
  expect(result.rows).toHaveLength(MATCH_PAGE_SIZE);expect(result.hasNext).toBe(true);expect(query).toHaveBeenCalledTimes(1)
  expect(query.mock.calls[0][0]).toContain('sort_date desc nulls last,match_id desc,kind')
  expect(query.mock.calls[0][1].slice(6,8)).toEqual([25,24])
  expect(query.mock.calls[0][0]).not.toContain('document')
 })
 it('hydrates only visible saved sessions, keeping saved roster order and DB avatars',async()=>{
  const rows=Array.from({length:25},(_,i)=>row(i,i===0||i===24))
  const query=vi.fn().mockResolvedValueOnce({rows}).mockResolvedValueOnce({rows:[{match_id:'0',kind:'match',source:'video',players:[{id:'b',name:'Saved B'},{id:'a',name:'Saved A'}],document:{rallies:[]}}]})
  const result=await loadMatchCatalog({query} as any,catalogFilters({scouting:'scouted'}))
  expect(query.mock.calls[1][1]).toEqual([['0']]);expect(result.rows[0].players[0].name).toBe('Saved B');expect(result.rows[0].avatars).toEqual({a:'photo-a'})
  expect(result.rows[0].players[1]).toMatchObject({name:'Saved A',country:'AR',ranking:3});expect(result.rows[0].document).toEqual({rallies:[]})
  expect(query.mock.calls[0][1][3]).toBe('scouted')
 })
 it('handles the last or empty page without a next-page link',async()=>{
  for(const rows of [[],[row(1)]]){const result=await loadMatchCatalog({query:vi.fn().mockResolvedValue({rows})} as any,catalogFilters({}));expect(result.hasNext).toBe(false)}
 })
})

it('keeps circuit and tier filters in URLs and parameterizes the catalogue query',async()=>{
 const query=vi.fn().mockResolvedValue({rows:[]})
 for(const league of ['premier','fip','p2','fip_gold']){
  const filters=catalogFilters({league})
  expect(catalogUrl(filters)).toContain(`league=${league}`)
  await loadMatchCatalog({query} as any,filters)
  expect(query.mock.calls.at(-1)?.[1][8]).toBe(league)
 }
 expect(catalogFilters({league:'bogus'}).league).toBe('')
})


it('combines pending and my scouts using the authenticated identity',async()=>{
 const query=vi.fn().mockResolvedValue({rows:[]}),id='11111111-1111-4111-8111-111111111111'
 const filters=catalogFilters({mine:'1',scouting:'pending',page:'2'})
 await loadMatchCatalog({query} as any,filters,{id,email:'me@example.com'})
 expect(query.mock.calls[0][1].slice(9,12)).toEqual(['1',id,'me@example.com'])
 expect(query.mock.calls[0][0]).toContain("coalesce(s.scout_phase,'')<>'finished'")
 expect(catalogUrl(filters,{page:3})).toContain('mine=1')
 expect(catalogFilters({mine:'other-user'}).mine).toBe('')
})
it('limits a specific player to ten matches before loading scouting documents',async()=>{
 const query=vi.fn().mockResolvedValue({rows:Array.from({length:11},(_,i)=>row(i))}),player='11111111-1111-4111-8111-111111111111'
 const result=await loadMatchCatalog({query} as any,catalogFilters({player,page:'5'}))
 expect(result.rows).toHaveLength(10);expect(result.hasNext).toBe(false)
 expect(query.mock.calls[0][1].slice(6,8)).toEqual([11,0])
 expect(query.mock.calls[0][1][12]).toBe(player)
 expect(query.mock.calls[0][0]).toContain("when match_status='live' then 0 when match_status='scheduled' then 1 else 2")
 expect(catalogFilters({player:'invalid'}).player).toBe('')
})

it('filters all watched players server-side, including an empty watchlist',async()=>{
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222'
 const query=vi.fn().mockResolvedValue({rows:[]})
 const filters=catalogFilters({watchlist:'1',watched:[a,b,a,'invalid'].join(','),scouting:'pending',mine:'1'})
 expect(filters.watched).toBe([a,b].join(','))
 await loadMatchCatalog({query} as any,filters)
 expect(query.mock.calls[0][1].slice(13,15)).toEqual(['1',[a,b]])
 expect(query.mock.calls[0][0]).toContain('c.player_ids && $15::uuid[]')
 const url=new URL(catalogUrl(filters,{page:2}),'https://admin.example')
 expect(url.searchParams.get('watched')).toBe([a,b].join(','))
 expect(url.searchParams.get('mine')).toBe('1')
 await loadMatchCatalog({query} as any,catalogFilters({watchlist:'1'}))
 expect(query.mock.calls[1][1].slice(13,15)).toEqual(['1',[]])
 expect(catalogFilters({watched:a}).watched).toBe('')
})

it('caps the combined watchlist at ten matches and ignores stale page numbers',async()=>{
 const query=vi.fn().mockResolvedValue({rows:Array.from({length:25},(_,i)=>row(i))})
 const result=await loadMatchCatalog({query} as any,catalogFilters({watchlist:'1',watched:'11111111-1111-4111-8111-111111111111',page:'4'}))
 expect(result.rows).toHaveLength(10)
 expect(result.hasNext).toBe(false)
 expect(query.mock.calls[0][1].slice(6,8)).toEqual([11,0])
 expect(query.mock.calls[0][0]).toContain("case when ($13::uuid is not null or $14='1') then case when match_status='live'")
})

it('filters an exact tournament across pages rather than name or player search',async()=>{
 const id='11111111-1111-4111-8111-111111111111',query=vi.fn().mockResolvedValue({rows:[]})
 const filters=catalogFilters({tournament:id,page:'2'})
 await loadMatchCatalog({query} as any,filters)
 expect(query.mock.calls[0][1].slice(15)).toEqual([id,''])
 expect(query.mock.calls[0][0]).toContain('c.tournament_id=$16::uuid')
 expect(new URL(catalogUrl(filters,{page:3}),'https://local.test').searchParams.get('tournament')).toBe(id)
 expect(catalogFilters({tournament:'invalid'}).tournament).toBe('')
})
it('uses exact parameterized labels for manual tournaments',async()=>{
 const query=vi.fn().mockResolvedValue({rows:[]}),label="FCP · Club Júnior 1917"
 await loadMatchCatalog({query} as any,catalogFilters({tournamentLabel:label}))
 expect(query.mock.calls[0][1].slice(15)).toEqual([null,label])
 expect(query.mock.calls[0][0]).toContain("c.kind='private' and c.tournament_name=$17")
})

it('preserves an explicit all-circuits choice when clearing the Premier default',()=>{
 const url=new URL(catalogUrl(catalogFilters({league:'premier'}),{league:''}),'https://admin.example')
 expect(url.searchParams.has('league')).toBe(true)
 expect(url.searchParams.get('league')).toBe('')
})

it('preserves All dates when clearing the default day',()=>{
 const url=new URL(catalogUrl(catalogFilters({date:'2026-10-28',league:'premier'}),{date:''}),'https://admin.example')
 expect(url.searchParams.has('date')).toBe(true)
 expect(url.searchParams.get('date')).toBe('')
 expect(url.searchParams.get('league')).toBe('premier')
})
