// Worker percentages are per stage, never an invented overall completion percentage.
export type AnalysisProgressJob = {status:string;stage:string;progress?:{processed?:number;total?:number}|null};
export const analysisStages = ['Preparing video','Player tracking','Movement metrics','Ball tracking','Publishing results'];
export function analysisProgress(job?:AnalysisProgressJob|null){
 const stage=job?.stage??'';
 const index=stage==='players'?1:stage==='movement'?2:['ball','refinement'].includes(stage)?3:stage==='uploading'?4:0;
 const label=({queued:'Waiting to start',preparing:'Preparing video',downloading:'Downloading video',normalizing:'Preparing video',players:'Tracking players',movement:'Calculating movement',ball:'Tracking the ball',refinement:'Refining ball tracking',uploading:'Publishing results'} as Record<string,string>)[stage]??'Processing video';
 const processed=job?.progress?.processed,total=job?.progress?.total;
 // Normalization and publishing currently emit only a start signal, not incremental progress.
 const measured=['players','ball'].includes(stage)&&Number.isFinite(processed)&&Number.isFinite(total)&&total!>0;
 const percent=measured?Math.max(0,Math.min(100,Math.floor(processed!/total!*100))):null;
 const active=!!job&&['queued','running'].includes(job.status);
 const title=!job?'Ready to analyze':job.status==='complete'?'Analysis ready':job.status==='failed'?'Analysis needs attention':job.status==='cancelled'?'Analysis stopped':job.status==='queued'?'Waiting to start':label;
 return {index,label,percent,active,title,pill:active&&percent!==null?`${label} · ${percent}%`:title};
}
