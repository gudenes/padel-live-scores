import {describe,it,expect} from 'vitest'
import {predictionBadgeCounts,type BadgePredictionResult} from '../prediction-badges'
import {BADGE_CATALOG,LEGACY_BADGES,BADGE_MAP} from '../badges'
const result = (id:string,overrides:Partial<BadgePredictionResult>={}):BadgePredictionResult => ({marketId:id,tournamentId:'rotterdam',settledAt:`2026-09-${id.padStart(2,'0')}T12:00:00Z`,status:'settled',cost:100,paid:150,revision:1,payoutRevision:1,...overrides})
describe('prediction badge progress',()=>{
  it('counts each settled market once and ignores void, open, unpaid revisions and empty positions',()=>{
    expect(predictionBadgeCounts([result('1'),result('1'),result('2',{status:'void'}),result('3',{status:'open'}),result('4',{revision:2}),result('5',{cost:0})])).toEqual({prediction_count:1,prediction_wins:1,prediction_streak:1,prediction_tournament:1})
  })
  it('uses net Guacas profit, resets streaks on a loss or break-even, and groups tournaments',()=>{
    const rows=[result('6'),result('2'),result('1'),result('3',{paid:0}),result('4',{paid:100}),result('5',{tournamentId:'paris'})]
    expect(predictionBadgeCounts(rows)).toEqual({prediction_count:6,prediction_wins:4,prediction_streak:2,prediction_tournament:3})
  })
  it('uses corrected results instead of counting both settlement revisions',()=>{
    expect(predictionBadgeCounts([result('1'),result('1',{revision:2,payoutRevision:2,paid:0}),result('2')])).toEqual({prediction_count:2,prediction_wins:1,prediction_streak:1,prediction_tournament:1})
  })
  it('can reach the full win and streak milestones without a database row-limit cap',()=>{
    const rows=Array.from({length:1100},(_,i)=>result(String(i+1)))
    expect(predictionBadgeCounts(rows).prediction_wins).toBe(1100)
  })
})
describe('badge collection migration',()=>{
  it('preserves old progress IDs and thresholds while archiving retired badges',()=>{
    expect(BADGE_CATALOG).toHaveLength(9)
    expect(BADGE_MAP.follow_players.tiers.map(t=>t.threshold)).toEqual([1,5,15])
    expect(BADGE_MAP.follow_matches.tiers.map(t=>t.threshold)).toEqual([1,10,50])
    expect(BADGE_MAP.rate_matches.tiers.map(t=>t.threshold)).toEqual([1,10,50])
    expect(LEGACY_BADGES.some(b=>b.id==='profile_complete')).toBe(true)
    expect(BADGE_CATALOG.some(b=>b.id==='profile_complete')).toBe(false)
    expect(BADGE_MAP.profile_complete).toBeDefined()
  })
})
