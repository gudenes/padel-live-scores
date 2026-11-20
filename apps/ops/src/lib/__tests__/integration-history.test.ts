import { describe, expect, it } from 'vitest'
import { historyPoints, type HistoryRow } from '../integration-history'
const base: HistoryRow={hour:'2026-11-20T13:00:00Z',feed:'fip',job:'discover',status:'success',reason:null,runs:3,duration_total:300,duration_count:3,latest:'2026-11-20T13:30:00Z'}
describe('ingestion timeline',()=>{
  it('combines job types, excludes other feeds, and keeps no-activity hours unknown',()=>{
    const points=historyPoints([base,{...base,job:'profile',status:'failed',runs:1,duration_total:200,duration_count:1},{...base,feed:'crionet',runs:900}], 'fip',3,'2026-11-20T14:35:00Z')
    expect(points).toHaveLength(3)
    expect(points[0]).toMatchObject({success:0,failed:0,failureRate:null,averageMs:null})
    expect(points[1]).toMatchObject({success:3,failed:1,failureRate:25,averageMs:125})
    expect(points[2].failureRate).toBeNull()
  })
  it('does not count running jobs as successes or failures',()=>{
    expect(historyPoints([{...base,status:'running',runs:7,duration_count:0,duration_total:0}],'fip',1,'2026-11-20T13:35:00Z')[0]).toMatchObject({success:0,failed:0,pending:7,failureRate:null})
  })
})
