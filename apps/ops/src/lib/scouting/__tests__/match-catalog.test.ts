import {describe,it,expect,vi} from 'vitest'
import {catalogFilters,catalogUrl,loadMatchCatalog,MATCH_PAGE_SIZE} from '../match-catalog'
const row=(n:number,scouted=false)=>({match_id:String(n),kind:'match',has_scouting:scouted,players:[{id:'a',name:'Catalog A',avatar_url:'photo-a',country:'AR',ranking:3}]})
describe('paginated match catalog',()=>{
 it('defaults to all matches and bounds malformed filter/page input',()=>{
  expect(catalogFilters({})).toEqual({league:'',q:'',status:'',kind:'',scouting:'',scouter:'',date:'',page:1})
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
  expect(query.mock.calls[0][0]).toContain('order by sort_date desc nulls last,match_id desc,kind')
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
