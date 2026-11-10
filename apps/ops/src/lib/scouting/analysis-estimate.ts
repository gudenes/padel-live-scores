import benchmark from './data/analysis-benchmark.json'
export type AnalysisEstimate={lowSeconds:number;highSeconds:number;basis:string;live:boolean;stageSeconds:number|null;matches:number;blocks:number}
type Job={id:string;worker_id?:string;status:string;stage:string;updated_at?:string;setup?:{analysisSeconds?:number};progress?:{processed?:number;total?:number}}
type Observation={key:string;at:number;done:number;seen:number;rate?:number}
const observations=new Map<string,Observation>()
// Only actual worker updates contribute to throughput, never browser clock ticks.
export function estimateAnalysis(job:Job,now=Date.now()):AnalysisEstimate|null{
 if(job.status!=='running'||!job.worker_id||!benchmark.workerIds.includes(job.worker_id))return null
 const duration=job.setup?.analysisSeconds;if(!duration||!Number.isFinite(duration)||duration<=0)return null
 const updated=Date.parse(job.updated_at??'');if(!Number.isFinite(updated)||now-updated>45000)return null
 const stage=job.stage,done=Math.max(0,job.progress?.processed??0),total=job.progress?.total??0
 const key=`${job.worker_id}:${stage}`,previous=observations.get(job.id)
 for(const [id,o] of observations)if(now-o.seen>3600000)observations.delete(id)
 let rate:number|undefined
 if(!previous||previous.key!==key||done<previous.done){observations.set(job.id,{key,at:updated,done,seen:now})}
 else{previous.seen=now;const elapsed=(updated-previous.at)/1000;if(elapsed>=30&&done>previous.done){rate=elapsed/(done-previous.done);previous.rate=rate}else rate=previous.rate}
 const fraction=total>0?Math.max(0,Math.min(1,done/total)):0
 const playerRemaining=['preparing','downloading','normalizing'].includes(stage)?duration:stage==='players'?duration*(1-fraction):0
 const ballRemaining=['preparing','downloading','normalizing','players','movement'].includes(stage)?duration:stage==='ball'?duration*(1-fraction):stage==='refinement'?Math.max(0,duration-done-Math.min(600,duration-done)):0
 let pl=benchmark.players.low,ph=benchmark.players.high,bl=benchmark.ball.low,bh=benchmark.ball.high
 if(rate&&stage==='players'){pl=rate*.85;ph=rate*1.2}
 if(rate&&stage==='ball'){bl=rate*.85;bh=rate*1.2}
 // Older runs only timed inference. Explicit allowances cover untimed setup,
 // normalization, movement, refinement and transfer; never call these measured.
 let lower=120,upper=600
 if(['preparing','normalizing','downloading'].includes(stage)){lower+=Math.max(60,duration*.04);upper+=Math.max(300,duration*.3)}
 if(stage==='downloading'){lower+=60;upper+=900}
 if(stage==='uploading'){lower=30;upper=600}
 let stageSeconds:number|null=null
 if(rate&&total>0&&['downloading','players','ball'].includes(stage)){
  stageSeconds=Math.max(0,(total-done)*rate)
  if(stage==='downloading'){lower+=stageSeconds*.8-60;upper+=stageSeconds*1.3-900}
 }
 if(!['preparing','downloading','normalizing','players','movement','ball','refinement','uploading'].includes(stage))return null
 return {lowSeconds:Math.ceil(Math.max(30,playerRemaining*pl+ballRemaining*bl+lower)),highSeconds:Math.ceil(Math.max(60,playerRemaining*ph+ballRemaining*bh+upper)),basis:'Previous matches on this computer + preparation and publishing allowance',live:!!rate,stageSeconds,matches:benchmark.matchCount,blocks:benchmark.blockCount}
}
