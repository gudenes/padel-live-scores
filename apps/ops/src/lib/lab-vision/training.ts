/** Dataset preparation only. Never turns a quick approval into verified contact timing. */
export type Sample = Record<string, any>
export const broadClasses = ['Serve','Groundstroke','Volley','Lob','Smash','Overhead','Bajada','Contrapared']
export function classesForMapping(mapping:string){return mapping==='starter-five-v1'?broadClasses.filter(c=>!['Smash','Bajada','Contrapared'].includes(c)):mapping==='starter-six-v2'?broadClasses.filter(c=>!['Bajada','Contrapared'].includes(c)):broadClasses}
export function trainingClass(shot:string,mapping='starter-eight-v3'){return (mapping==='starter-five-v1'?['Smash','Bandeja','Vibora','Gancho','Rulo']:['Bandeja','Vibora','Gancho','Rulo']).includes(shot)?'Overhead':shot}
export function latestAnnotations(records:Sample[]){
 const superseded=new Set(records.map(a=>a.supersedes).filter(Boolean))
 return records.filter(a=>!superseded.has(a.id))
}
export function issues(a:Sample):string[]{
 const result:string[]=[]
 if(a.status==='excluded'||a.quickDecision==='not_contact'||a.serveDecision==='not_serve')return ['Rejected']
 if(a.kind!=='Shot contact')return ['Not a shot annotation']
 if(a.status!=='verified'&&!(a.quickDecision==='shot'&&a.classificationReviewed))result.push('Label needs review')
 if(!broadClasses.includes(trainingClass(a.shot)))result.push('Outside starter classes')
 if(!(a.timingVerified??a.confirmed))result.push('Contact timing')
 if(!a.player)result.push('Hitter identity')
 const b=a.box
 if(!b||!['x','y','width','height'].every(k=>Number.isFinite(b[k]))||b.x<0||b.y<0||b.width<.005||b.height<.005||b.x+b.width>1.000001||b.y+b.height>1.000001)result.push('Hitter box')
 if(![a.time,a.start,a.end,a.duration].every(Number.isFinite)||a.start<0||a.start>a.time||a.end<a.time||a.end<=a.start||a.end>a.duration)result.push('Clip bounds')
 return result
}
export function datasetSummary(records:Sample[]){
 const latest=latestAnnotations(records), accepted=latest.filter(a=>a.kind==='Shot contact'&&a.status!=='excluded'&&(a.status==='verified'||(a.quickDecision==='shot'&&a.classificationReviewed)))
 const ready=accepted.filter(a=>issues(a).length===0)
 return {latest,accepted,ready,needsReview:accepted.filter(a=>issues(a).length>0),rejected:latest.filter(a=>a.status==='excluded').length,classes:broadClasses.map(name=>({name,ready:ready.filter(a=>trainingClass(a.shot)===name).length,accepted:accepted.filter(a=>trainingClass(a.shot)===name).length}))}
}
export function validateSplit(samples:Sample[],split:Record<string,string>){
 const matches=[...new Set(samples.map(a=>a.matchId))]
 if(matches.some(id=>!['train','validation','test'].includes(split[id])))throw Error('Assign every match to a split.')
 return {matches,canTrain:['train','validation','test'].every(role=>matches.some(id=>split[id]===role))}
}
export function evaluatePredictions(snapshot:Sample,predictions:Sample[]){
 const mapping=snapshot.classMapping??'starter-five-v1',classNames=classesForMapping(mapping)
 const test=snapshot.samples.filter((a:Sample)=>snapshot.split[a.matchId]==='test')
 if(!test.length)throw Error('This snapshot has no held-out test match.')
 if(!Array.isArray(predictions)||!predictions.length||predictions.length>100000)throw Error('Provide predictions for the held-out test clips.')
 const byId=new Map(test.map((a:Sample)=>[a.id,a])),seen=new Set<string>()
 const results=predictions.map(p=>{
  const a=byId.get(p.annotationId) as Sample|undefined
  if(!a||seen.has(p.annotationId)||!classNames.includes(p.shot)||!Number.isFinite(p.confidence)||p.confidence<0||p.confidence>1)throw Error('Each prediction needs a unique test annotationId, a starter shot class and confidence from 0 to 1.')
  seen.add(p.annotationId);return {annotationId:a.id,actual:trainingClass(a.shot,mapping),predicted:p.shot,confidence:p.confidence,correct:trainingClass(a.shot,mapping)===p.shot}
 })
 const classes=classNames.map(name=>{const tp=results.filter(r=>r.actual===name&&r.predicted===name).length,fp=results.filter(r=>r.actual!==name&&r.predicted===name).length,fn=results.filter(r=>r.actual===name&&r.predicted!==name).length;return {name,support:tp+fn,f1:2*tp+fp+fn?2*tp/(2*tp+fp+fn):null}})
 return {results,classes,total:test.length,evaluated:results.length,accuracy:results.filter(r=>r.correct).length/results.length,complete:results.length===test.length}
}
