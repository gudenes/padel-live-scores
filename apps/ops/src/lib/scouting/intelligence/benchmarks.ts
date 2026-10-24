import type {Match,Person} from './model'
export function courtPosition(side?:string|null){
 const value=side?.trim().toLowerCase()
 if(['right','forehand','drive','derecha'].includes(value??''))return 'right'
 if(['left','backhand','reves','revés','izquierda'].includes(value??''))return 'left'
 return null
}
export type PeerMetric={value:number|null;numerator:number;denominator:number;cohort?:string}
export function benchmarks(matches:Match[], selected:Person[]){
 const category=selected[0]?.category,position=courtPosition(selected[0]?.side)
 const positionLabel=position==='right'?'Right / drive':position==='left'?'Left / backhand':'Position not recorded'
 const cohort=position?positionLabel+' peers (recorded profile position)':'No position benchmark: playing position not recorded'
 const individual=(value:number|null,numerator:number,denominator:number):PeerMetric=>({value,numerator,denominator,cohort})
 const ids=new Set(selected.map(p=>p.id)),players=new Set<string>(),matchIds=new Set<string>()
 let impact=0,observations=0,allWinners=0,ue=0,points=0,smashes=0,winners=0,breakWon=0,breakTotal=0,breakSaved=0,breakFaced=0,starWon=0,starTotal=0
 for(const m of matches){
  if(m.partial||!m.winner||m.manual||!category)continue
  const eligible=m.players.map(p=>p.category===category&&!ids.has(p.id))
  m.players.forEach((p,i)=>{if(!eligible[i]||!position||courtPosition(p.side)!==position)return;players.add(p.id);matchIds.add(m.id);impact+=m.impact[i];observations++;allWinners+=m.stats[i].winners;ue+=m.stats[i].unforced;points+=m.points.length;smashes+=m.stats[i].smashes;winners+=m.stats[i].smashWinners})
  // Team opportunities are counted once, and only for fully eligible pairs.
  for(const [offset,team] of [[0,'a'],[2,'b']] as const)if(eligible[offset]&&eligible[offset+1]){breakWon+=m.breaks[team].won;breakTotal+=m.breaks[team].total;breakSaved+=m.breaks[team].saved;breakFaced+=m.breaks[team].faced
   for(const d of m.deciders)if(d.rule==='star-point'){starWon+=d[team];starTotal+=d.total}
  }
 }
 return {position,positionLabel,category:category??'Unknown',players:players.size,matches:matchIds.size,
  impact:individual(observations?impact/observations:null,impact,observations),
  winners:individual(points?allWinners/points*100:null,allWinners,points),
  unforced:individual(points?ue/points*100:null,ue,points),
  smash:individual(smashes?winners/smashes*100:null,winners,smashes),
  saved:{value:breakFaced?breakSaved/breakFaced*100:null,numerator:breakSaved,denominator:breakFaced},
  star:{value:starTotal?starWon/starTotal*100:null,numerator:starWon,denominator:starTotal},
  breaks:{value:breakTotal?breakWon/breakTotal*100:null,numerator:breakWon,denominator:breakTotal}}
}
export type Benchmarks=ReturnType<typeof benchmarks>
