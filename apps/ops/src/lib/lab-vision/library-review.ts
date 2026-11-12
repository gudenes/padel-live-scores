import {issues} from './training'
/** Resolve a library selection to its newest revision without losing its queue position. */
export function resolveAnnotationRevision(records:any[],id?:string){
 let current=records.find(a=>a.id===id)
 const seen=new Set<string>()
 while(current&&!seen.has(current.id)){
  seen.add(current.id)
  const next=records.find(a=>a.supersedes===current.id)
  if(!next)break
  current=next
 }
 return current
}

export function libraryEligibility(annotation:any,duration:number){
 const reasons=issues({...annotation,duration})
 const excluded=reasons.includes('Rejected')||reasons.includes('Not a shot annotation')
 return {eligible:reasons.length===0,needsReview:!excluded&&reasons.length>0,reasons}
}
