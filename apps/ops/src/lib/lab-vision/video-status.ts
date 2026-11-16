import {datasetSummary, type Sample} from './training'
import {analysisProgress, type AnalysisProgressJob} from '../scouting/analysis-progress'

export type LabelProgress = {total:number; reviewed:number; eligible:number; pending:number}
export type VideoRun = AnalysisProgressJob & {
 id:string; video_id:string; match_id:string; file_name:string; updated_at:string;
 setup?:{playerNames?:string[]}; labels:LabelProgress;
}
export type VideoFilter = 'all'|'review'|'ready'|'processing'|'failed'

/** Counts latest saved shot labels only, never inferred full-video coverage. */
export function labelProgress(records:Sample[]):LabelProgress {
 const summary=datasetSummary(records)
 const shots=summary.latest.filter(a=>a.kind==='Shot contact')
 const excluded=shots.filter(a=>a.status==='excluded'||a.quickDecision==='not_contact'||a.serveDecision==='not_serve')
 const reviewed=shots.filter(a=>a.status==='verified'||a.status==='excluded'||(a.quickDecision==='shot'&&a.classificationReviewed)||a.quickDecision==='not_contact'||a.serveDecision==='not_serve')
 return {total:shots.length,reviewed:reviewed.length,eligible:summary.ready.length,pending:shots.length-excluded.length-summary.ready.length}
}
export function videoStatus(job:VideoRun):{filter:VideoFilter;analysis:string;review:string;action:string;tab:string} {
 const progress=analysisProgress(job)
 if(progress.active)return {filter:'processing',analysis:progress.pill,review:'Waiting for analysis',action:'View progress',tab:'Workflow'}
 if(job.status==='failed'||job.status==='cancelled')return {filter:'failed',analysis:job.status==='failed'?'Analysis failed':'Analysis stopped',review:'Analysis needs attention',action:'Open match review',tab:'Workflow'}
 if(job.status!=='complete')return {filter:'review',analysis:job.status,review:'Waiting for analysis',action:'View progress',tab:'Workflow'}
 const ready=job.labels.eligible>0&&job.labels.pending===0
 const needsReview=job.labels.pending>0
 return {filter:ready?'ready':'review',analysis:'Complete',review:ready?'Ready for training':needsReview?'Needs review':job.labels.total?'No eligible labels':'Not started',action:ready?'View labels':needsReview?'Continue review':'Start review',tab:ready?'Annotation library':needsReview?'Annotation library':'Review all shots'}
}
export function videoTitle(job:VideoRun){
 const players=job.setup?.playerNames?.filter(Boolean)
 return players?.length===4?`${players[0]} / ${players[1]} vs ${players[2]} / ${players[3]}`:job.file_name
}
