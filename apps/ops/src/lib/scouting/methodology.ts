import type {TimelinePoint} from './tracking'

export type MethodologyId = 'net-actions' | 'v0.1' | 'v0.2' | 'v0.3' | 'v1.3' | 'v1.4'
export const DEFAULT_METHODOLOGY: MethodologyId = 'v1.4'
export const methodologies = [
 {id:'net-actions',label:'Original · Net actions',weighted:false,creationCredit:0,pairBonus:0,assistCredit:0,description:'Winners − unforced errors − forced errors − double faults. Equal weights; no Player Score.'},
 {id:'v0.1',label:'v0.1 · Pressure-weighted impact',weighted:true,creationCredit:0,pairBonus:0,assistCredit:0,description:'Winner +1, unforced error −1, forced error suffered −0.5. No credit for forced errors created.'},
 {id:'v0.2',label:'v0.2 · Forced-error creation',weighted:true,creationCredit:0.5,pairBonus:0,assistCredit:0,description:'v0.1 plus +0.5 to the identified opponent who created a forced error.'},
 {id:'v0.3',label:'v0.3 · Shared point bonus',weighted:true,creationCredit:0.5,pairBonus:0.05,assistCredit:0,description:'v0.2 plus a flat +0.05 to both players whenever their pair wins an observed point.'},
 {id:'v1.3',label:'v1.3 · Assisted winners · 50/50',weighted:true,creationCredit:0.5,pairBonus:0.05,assistCredit:0.5,description:'v0.3 with assisted winner credit split equally: +0.5 to the finisher and +0.5 to the recorded teammate, both pressure-weighted. Unassisted winners keep +1.'},
 {id:'v1.4',label:'v1.4 · Player Score · Greater separation',weighted:true,creationCredit:0.5,pairBonus:0.05,assistCredit:0.5,description:'Same impact and 50/50 assist split as v1.3. Player Score starts at 5 and adds 35 × impact / weighted observed points, bounded to 1–10.'},
] as const

export function pointWeight(p:TimelinePoint){
 return Math.max(1,
  p.breakPoint||p.star||p.before.phase==='tiebreak'?1.5:1,
  p.setPoint.a||p.setPoint.b?2:1,
  p.matchPoint.a||p.matchPoint.b?2.5:1)
}

export function playerScoreScale(id:MethodologyId=DEFAULT_METHODOLOGY){
 return {neutral:id==='v1.4'?5:6,sensitivity:id==='v1.4'?0.35:0.25,perWeightedMatchPoints:100,min:1,max:10,decimals:1}
}

export function playerScore(impact:number,weightedPoints:number,id:MethodologyId=DEFAULT_METHODOLOGY){
 if(weightedPoints<=0)return null
 const scale=playerScoreScale(id)
 return Math.round(Math.max(scale.min,Math.min(scale.max,scale.neutral+scale.sensitivity*scale.perWeightedMatchPoints*impact/weightedPoints))*10)/10
}

// Input is the replayed active timeline: imports and undone events never add points.
export function methodologyAnalysis(points:TimelinePoint[],id:MethodologyId=DEFAULT_METHODOLOGY){
 const method=methodologies.find(m=>m.id===id)!
 const values=[0,0,0,0],generatedPoints=[0,0,0,0],bonuses=[0,0,0,0]
 let weightedPoints=0,forcedErrors=0,attributedForcedErrors=0,unclassifiedPoints=0
 const series=points.map(p=>{
  const weight=method.weighted?pointWeight(p):1
  weightedPoints+=weight
  if(p.player===null)unclassifiedPoints++
  else{
   if(p.outcome==='winner'){
    // Only explicit, valid teammate attribution can split a winner's credit.
    const assisted=method.assistCredit>0&&p.assistBy===(p.player^1)&&Math.floor(p.player/2)===(p.winner==='a'?0:1)
    values[p.player]+=weight*(assisted?1-method.assistCredit:1)
    if(assisted)values[p.assistBy!]+=weight*method.assistCredit
    generatedPoints[p.player]++
   }
   else if(p.outcome==='unforced'||p.outcome==='double_fault')values[p.player]-=weight
   else if(p.outcome==='forced'){
    values[p.player]-=weight*(method.weighted?0.5:1)
    forcedErrors++
    // Never infer pressure credit or credit the same pair, even for old exports.
    if(p.forcedBy!==undefined&&Number.isInteger(p.forcedBy)&&p.forcedBy>=0&&p.forcedBy<4&&Math.floor(p.forcedBy/2)!==Math.floor(p.player/2)){
     attributedForcedErrors++;generatedPoints[p.forcedBy]++
     values[p.forcedBy]+=method.creationCredit*weight
    }
   }
  }
  const start=p.winner==='a'?0:2
  for(let i=start;i<start+2;i++){values[i]+=method.pairBonus;bonuses[i]+=method.pairBonus}
  return {number:p.number,values:values.map(v=>Number(v.toFixed(2)))}
 })
 return {
  methodology:method,observedPoints:points.length,weightedPoints,
  rules:{winner:1,assistedWinner:1-method.assistCredit,assist:method.assistCredit,assistAttribution:'Explicit teammate on a winner only; missing or invalid attribution keeps full winner credit',unforcedError:-1,forcedErrorSuffered:method.weighted?-0.5:-1,doubleFault:-1,forcedErrorCreated:method.creationCredit,pairPointBonus:method.pairBonus,pressure:method.weighted?{regular:1,breakStarTiebreak:1.5,set:2,match:2.5}:null,overlap:'Highest multiplier only; shared bonus is flat',score:method.weighted?playerScoreScale(id):null},
  coverage:{forcedErrors,attributedForcedErrors,unclassifiedPoints},series,
  players:values.map((impact,i)=>({impact:Number(impact.toFixed(2)),normalizedImpact:weightedPoints?100*impact/weightedPoints:null,score:method.weighted?playerScore(impact,weightedPoints,id):null,generatedPoints:generatedPoints[i],pairBonus:Number(bonuses[i].toFixed(2))})),
 }
}
