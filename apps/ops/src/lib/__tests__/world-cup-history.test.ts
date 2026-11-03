import { it,expect,vi } from 'vitest'
vi.mock('../db',()=>({pgPool:vi.fn()}))
import { archiveFilters } from '../world-cup-history'
it('validates archive filters and bounds pages',()=>{
 expect(archiveFilters(new URLSearchParams())).toEqual({year:2024,kind:'',category:'',page:1})
 for(const q of ['year=2026','year=abc','kind=sql','category=other','page=-1','page=1.5'])expect(()=>archiveFilters(new URLSearchParams(q))).toThrow()
})
