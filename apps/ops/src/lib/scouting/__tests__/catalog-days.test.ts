import {describe,it,expect} from 'vitest'
import {catalogDay,catalogDays} from '../catalog-days'
import {catalogFilters,catalogUrl} from '../match-catalog'
describe('catalog quick dates',()=>{
 it('shows five previous dates, today and tomorrow across month boundaries',()=>{
  const days=catalogDays('2026-03-01');expect(days.map(d=>d.date)).toEqual(['2026-02-24','2026-02-25','2026-02-26','2026-02-27','2026-02-28','2026-03-01','2026-03-02']);expect(days[4].label).toBe('Yesterday');expect(days[5].label).toBe('Today');expect(days[6].label).toBe('Tomorrow')
 });
 it('uses Madrid date at midnight and daylight saving changes',()=>{
  expect(catalogDay(new Date('2026-10-18T22:30:00Z'))).toBe('2026-10-19');expect(catalogDays('2026-10-26').map(d=>d.date)).toEqual(['2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25','2026-10-26','2026-10-27'])
 });
 it('keeps other filters and resets pagination',()=>{
  const f=catalogFilters({q:'Tapia',league:'premier',mine:'1',page:'4'});const url=catalogUrl(f,{date:'2026-10-19',page:1});expect(url).toContain('q=Tapia');expect(url).toContain('league=premier');expect(url).toContain('mine=1');expect(url).not.toContain('page=');expect(catalogUrl(catalogFilters({date:'2026-10-19'}),{date:'',page:1})).toBe('/scouting?view=all')
 })
})
