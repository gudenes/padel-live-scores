import {type Sample,validateSplit} from './training'
export const localModel='pose-mlp-v1'
export function online(plan:Sample){return Number.isFinite(Date.parse(plan.lastSeenAt))&&Date.now()-Date.parse(plan.lastSeenAt)<90000}
export function preflight(snapshot:Sample,report:Sample){
 if(!snapshot.canTrain||!validateSplit(snapshot.samples,snapshot.split).canTrain||snapshot.classMapping!=='starter-eight-v3')throw Error('A three-split starter-eight snapshot is required.')
 if(report?.snapshotSha256!==snapshot.sha256||report?.snapshotId!==snapshot.id||report?.model!==localModel)throw Error('Preflight does not match the frozen snapshot.')
 const counts:Sample={}
 for(const role of ['train','validation','test']){
  const eligible=snapshot.samples.filter((s:Sample)=>snapshot.split[s.matchId]===role).length,c=report.counts?.[role]
  if(c?.eligible!==eligible||!Number.isInteger(c.usable)||c.usable<1||c.usable>eligible)throw Error(`No valid ${role} pose coverage.`)
  counts[role]={eligible,usable:c.usable}
 }
 return counts
}
export function approveLocal(plan:Sample,userId:string){
 if(plan.execution!=='local'||plan.createdBy!==userId||plan.status!=='awaiting_approval')throw Error('This local plan cannot be started.')
 if(!online(plan))throw Error('Local runner is offline. Reconnect it before starting.')
 return {...plan,status:'queued',approvedAt:new Date().toISOString(),approvedBy:userId}
}
export function snapshotArtifacts(artifacts:Sample[],snapshotId:string|undefined){return artifacts.filter(a=>a.snapshotId===snapshotId)}
export function missingSplits(snapshot:Sample){return ['train','validation','test'].filter(role=>!snapshot.samples.some((s:Sample)=>snapshot.split[s.matchId]===role))}
