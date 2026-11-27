import { canonicalPointsRound } from './round-progression.ts'
import type { Award, Breakdown, MatchResult, RacePlayer, Tournament, TournamentResult } from './types.ts'

// 2026 only. Never silently reuse this points schedule for a future season.
// https://www.padelfip.com/wp-content/uploads/2024/01/FIP-Points-Table-2026.jpg.pdf
const TABLE: Record<string, number[]> = {
  major: [2000,1200,720,360,180,90,35], p1: [1000,600,360,180,90,45,22], p2: [600,360,180,90,45,22],
  fip_platinum: [300,180,90,50,25,14], fip_gold: [150,90,50,25,14,8],
  fip_silver: [80,45,25,14,8,5], fip_bronze: [40,22,14,8,5,3],
}
export const qualifyingSchedule: Record<string, number[]> = { major:[15,30,15],p1:[10,18,0],p2:[5,15,7],fip_platinum:[3,9,5],fip_gold:[2,5,3],fip_silver:[1,3,2],fip_bronze:[0,2,0] }
const ROUND: Record<string, number> = { F:1,Final:1,SF:2,'Semi-final':2,QF:3,'Quarter-final':3,R16:4,R32:5,R64:6 }
/** Base tournament total secured by a main-draw win, excluding player bonuses. */
export function matchRoundPoints(level: string | null | undefined, roundLabel: string | null, season: string): { winner: number; loser: number } | null {
  if (season !== '2026' || !level || !TABLE[level] || !roundLabel) return null
  const label = canonicalPointsRound(roundLabel)
  const index = label ? ({ F: 1, SF: 2, QF: 3, R16: 4, R32: 5, R64: 6 } as Record<string, number>)[label] : undefined
  // Only offer points for rounds actually covered by this tier's table.
  if (!index || TABLE[level][index] == null) return null
  return { winner: TABLE[level][index - 1], loser: TABLE[level][index] }
}
export function matchWinPoints(level: string | null | undefined, roundLabel: string | null, season: string): number | null {
  return matchRoundPoints(level, roundLabel, season)?.winner ?? null
}
export const supportedLevels = Object.keys(TABLE)
export function identity(name: string) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(premier|padel|cupra|tour|open|gnp|bnl|2026)\b/g,'').replace(/[^a-z0-9]/g,'')
}
export function bestResults(results: TournamentResult[], count = 22) {
  return results.map(r=>r.points).sort((a,b)=>b-a).slice(0,count).reduce((a,b)=>a+b,0)
}
function slots(m: MatchResult) { return [[m.pair1_player1_id,1],[m.pair1_player2_id,1],[m.pair2_player1_id,2],[m.pair2_player2_id,2]] as const }
function round(m: MatchResult) { return m.round_canonical ?? m.round ?? '' }
function isComplete(m: MatchResult) { return ['finished','retired','walkover'].includes(m.status) && (m.winner_pair===1 || m.winner_pair===2) }

/** Recompute tournament totals from current results. Never add round awards together. */
export function tournamentAwards(tournament: Tournament, matches: MatchResult[]): Award[] {
  if (!tournament.starts_at.startsWith('2026') || !TABLE[tournament.level]) return []
  const table=TABLE[tournament.level], qual=qualifyingSchedule[tournament.level]
  const main=matches.filter(m=>ROUND[round(m)] != null)
  const qualRounds=matches.map(m=>/^Q([1-4])$/.exec(round(m))).filter(Boolean).map(m=>Number(m![1]))
  const lastQ=Math.max(0,...qualRounds)
  const completed=matches.filter(isComplete)
  const players=new Set(completed.flatMap(m=>slots(m).map(([id])=>id)).filter((id):id is string=>!!id))
  return [...players].map(playerId=>{
    const all=completed.filter(m=>slots(m).some(([id])=>id===playerId))
    const pair=(m:MatchResult)=>slots(m).find(([id])=>id===playerId)![1]
    const wins=(m:MatchResult)=>pair(m)===m.winner_pair
    const mainResults=all.filter(m=>ROUND[round(m)] != null)
    let points=0, uncertain=false
    // Conflicting source rows must not turn a loss into a win.
    for(const r of new Set(all.map(round))) {
      if(new Set(all.filter(m=>round(m)===r).map(wins)).size>1) uncertain=true
    }
    const qualifying=all.filter(m=>/^Q\d$/.test(round(m)))
    const qualified=qualifying.some(m=>round(m)===`Q${lastQ}` && wins(m))
    if(mainResults.length) {
      for(const m of mainResults) {
        const i=ROUND[round(m)]
        if(table[i]==null) { uncertain=true;continue }
        const playedBefore=all.some(other=>other.id!==m.id && (ROUND[round(other)] ?? 99)>i && wins(other))
        // A withdrawal before first play earns no points for the withdrawing pair.
        const award=m.status==='walkover' && !wins(m) && !playedBefore ? 0 : table[wins(m)?i-1:i]
        points=Math.max(points,award)
      }
      if(qualified) points+=qual[0]
      // Unseeded Premier pairs get a bonus for beating a top seed. Count each round once.
      const seededLimit=tournament.level==='p2'?4:8
      const bonus=({major:30,p1:20,p2:15} as Record<string,number>)[tournament.level] ?? 0
      const ownSeed=main.filter(m=>slots(m).some(([id])=>id===playerId)).some(m=>(pair(m)===1?m.pair1_seed:m.pair2_seed)!=null)
      const bonusRounds=new Set<string>()
      for(const m of mainResults) {
        const opponent=pair(m)===1?m.pair2_seed:m.pair1_seed
        if(!ownSeed && wins(m) && opponent!=null && opponent<=seededLimit) bonusRounds.add(round(m))
      }
      points+=bonusRounds.size*bonus
    } else if(qualifying.length) {
      // Qualification draw size is not always complete in the feed. Defer these
      // players until a main-draw result or FIP publication establishes the award.
      uncertain=true
    }
    return {playerId,tournament,points,uncertain}
  })
}

export function applyAwards(player: RacePlayer, breakdown: Breakdown | null, awards: Award[], baselineDate: string): RacePlayer {
  if(!awards.length) return {...player,liveGain:0,pending:false}
  const season=baselineDate.slice(0,4)
  // Both counting and non-counting results must reproduce FIP's actual Race total.
  const baseline=breakdown?.results.filter(r=>r.date.startsWith(season)) ?? []
  const pending=(pendingReason: NonNullable<RacePlayer['pendingReason']>):RacePlayer=>({...player,pending:true,liveGain:0,pendingReason})
  if(!breakdown)return pending('profile_not_loaded')
  if(breakdown.date!==baselineDate || bestResults(baseline)!==player.officialPoints)return pending('baseline_mismatch')
  if(baseline.some(r=>r.points===0))return pending('incomplete_history')
  if(awards.some(a=>a.uncertain))return pending('ambiguous_results')
  const results=[...baseline]
  const seen=new Set<string>()
  for(const award of awards) {
    const key=identity(award.tournament.name)
    if(seen.has(key)) return pending('ambiguous_results')
    seen.add(key)
    const existing=results.filter(r=>identity(r.name)===key && Math.abs(Date.parse(r.date)-Date.parse(award.tournament.starts_at))<14*86400000)
    if(existing.length>1) return pending('ambiguous_results')
    // A result already in the publication is authoritative. Match feeds may lag
    // corrections; never apply its points twice or downgrade FIP's award.
    if(existing.length) continue
    // A completed event from before this publication is not a new live result.
    if(award.tournament.ends_at.slice(0,10)<baselineDate) continue
    results.push({key:award.tournament.id,name:award.tournament.name,date:award.tournament.starts_at.slice(0,10),points:award.points})
  }
  // Same-week simultaneous tournaments need an official eligibility decision.
  // Refuse overlapping live events rather than summing incompatible awards.
  for(let i=0;i<awards.length;i++) for(let j=i+1;j<awards.length;j++) {
    if(awards[i].tournament.starts_at<=awards[j].tournament.ends_at && awards[j].tournament.starts_at<=awards[i].tournament.ends_at)
      return pending('overlapping_events')
  }
  const points=bestResults(results)
  return {...player,race_points:points,liveGain:points-player.officialPoints,pending:false}
}
export function rankPlayers(players: RacePlayer[]): RacePlayer[] {
  const sorted=[...players].sort((a,b)=>b.race_points-a.race_points || a.officialRank-b.officialRank || a.id.localeCompare(b.id))
  let rank=0, previous:number|null=null
  return sorted.map((p,i)=>{if(p.race_points!==previous)rank=i+1;previous=p.race_points;return {...p,race_ranking:rank}})
}
