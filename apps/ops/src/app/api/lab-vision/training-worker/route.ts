import {createHash,randomUUID} from 'node:crypto'
import {pgPool} from '@/lib/db'
import {isUserOperator} from '@/lib/operators'
import {jobBody} from '@/lib/lab-vision-jobs'
import {evaluatePredictions} from '@/lib/lab-vision/training'
import {localModel,preflight} from '@/lib/lab-vision/local-training'
export const runtime='nodejs'
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}})
export async function POST(req:Request){
 const token=req.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]
 if(!token)return json({error:'Worker credential required.'},401)
 const db=pgPool(),worker=(await db.query('select * from public.lab_vision_workers where token_hash=$1 and revoked_at is null',[createHash('sha256').update(token).digest('hex')])).rows[0]
 if(!worker||!await isUserOperator(worker.owner_user_id))return json({error:'Worker disconnected.'},401)
 let b;try{b=await jobBody(req,2000000)}catch{return json({error:'Invalid request.'},400)}
 const c=await db.connect()
 try{
  await c.query('begin')
  // Serialize registration/claims for this worker. A run is claimed once, never retried automatically.
  await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['training:'+worker.id])
  const now=new Date().toISOString()
  let result:any
  if(b.action==='discover'){
   const pending=(await c.query("select id,payload from lab_vision_training_artifacts where kind='plan' and created_by=$1 and payload->>'execution'='local' and payload->>'status' in ('preparing','awaiting_approval','queued','running') and (payload->>'workerId' is null or payload->>'workerId'=$2) order by case when payload->>'status'='preparing' then 1 else 0 end,created_at for update skip locked limit 1",[worker.owner_user_id,worker.id])).rows[0]
   if(pending){await c.query('update lab_vision_training_artifacts set payload=$2 where id=$1',[pending.id,{...pending.payload,workerId:worker.id,lastSeenAt:now}]);result={snapshotId:pending.payload.snapshotId,planId:pending.id}}else result={snapshotId:null}
  }else if(b.action==='preparation-failed'){
   const pending=(await c.query("select payload from lab_vision_training_artifacts where id=$1 and created_by=$2 and kind='plan' for update",[b.id,worker.owner_user_id])).rows[0]?.payload
   if(!pending||pending.workerId!==worker.id||pending.status!=='preparing')throw Error('Preparation request unavailable.')
   result={...pending,status:'failed',error:String(b.error??'Local preparation failed').slice(0,300),finishedAt:now,lastSeenAt:now}
   await c.query('update lab_vision_training_artifacts set payload=$2 where id=$1',[pending.id,result])
  }else if(b.action==='snapshot'||b.action==='prepare'){
   const snapshot=(await c.query("select payload from lab_vision_training_artifacts where id=$1 and kind='snapshot' and created_by=$2",[b.snapshotId,worker.owner_user_id])).rows[0]?.payload
   if(!snapshot)throw Error('Snapshot unavailable for this worker owner.')
   if(b.action==='snapshot')result=snapshot
   else{
    const counts=preflight(snapshot,b.report)
    const existing=(await c.query("select payload from lab_vision_training_artifacts where kind='plan' and created_by=$1 and payload->>'workerId'=$2 and payload->>'snapshotId'=$3 and payload->>'execution'='local' order by created_at desc limit 1",[worker.owner_user_id,worker.id,snapshot.id])).rows[0]?.payload
    if(existing){
     if(existing.status==='preparing'){
      // Cancellation and preparation race safely under the row lock.
      const locked=(await c.query("select payload from lab_vision_training_artifacts where id=$1 for update",[existing.id])).rows[0]?.payload
      if(locked.status!=='preparing')throw Error('Preparation was cancelled.')
      result={...locked,status:'awaiting_approval',counts,lastSeenAt:now,hardware:String(b.hardware??'Local computer').slice(0,160)}
      await c.query('update lab_vision_training_artifacts set payload=$2 where id=$1',[existing.id,result])
     }else result=existing
    }
    else{
     result={id:randomUUID(),kind:'plan',createdBy:worker.owner_user_id,createdAt:now,schemaVersion:1,name:'Local pose baseline',execution:'local',model:localModel,snapshotId:snapshot.id,snapshotSha256:snapshot.sha256,status:'awaiting_approval',workerId:worker.id,epochs:20,maxMinutes:30,budgetEUR:0,inputs:'cached-player-pose',ballModel:'WASB unchanged',counts,lastSeenAt:now,hardware:String(b.hardware??'Local computer').slice(0,160)}
     await c.query('insert into lab_vision_training_artifacts(id,kind,created_by,payload,created_at) values($1,$2,$3,$4,$5)',[result.id,result.kind,result.createdBy,result,result.createdAt])
    }
   }
  }else{
   let plan=(await c.query("select payload from lab_vision_training_artifacts where id=$1 and kind='plan' and created_by=$2 for update",[b.id,worker.owner_user_id])).rows[0]?.payload
   if(!plan||plan.execution!=='local'||plan.workerId!==worker.id)throw Error('Local plan unavailable.')
   if(b.action==='poll'){
    plan={...plan,lastSeenAt:now}
    if(plan.status==='queued'){
     const active=(await c.query("select id from lab_vision_training_artifacts where kind='plan' and payload->>'workerId'=$1 and payload->>'status'='running'",[worker.id])).rows.length
     if(active)throw Error('This computer already has a running plan.')
     plan={...plan,status:'running',startedAt:now,attemptId:randomUUID()}
     result={...plan,claimed:true}
    }else result={...plan,claimed:false}
   }else{
    if(plan.status!=='running'||!b.attemptId||b.attemptId!==plan.attemptId)throw Error('Run stopped or claim invalid.')
    if(b.action==='progress'){
     if(!Number.isInteger(b.epoch)||b.epoch<1||b.epoch>plan.epochs||!Number.isFinite(b.loss)||b.loss<0||!Number.isFinite(b.validationLoss)||b.validationLoss<0)throw Error('Invalid progress.')
     plan={...plan,lastSeenAt:now,epoch:b.epoch,loss:b.loss,validationLoss:b.validationLoss,history:[...(plan.history??[]).filter((p:any)=>p.epoch!==b.epoch),{epoch:b.epoch,loss:b.loss,validationLoss:b.validationLoss}]}
    }else if(b.action==='complete'){
     const snapshot=(await c.query("select payload from lab_vision_training_artifacts where id=$1 and kind='snapshot' and created_by=$2",[plan.snapshotId,worker.owner_user_id])).rows[0]?.payload
     const metrics=evaluatePredictions(snapshot,b.predictions)
     if(metrics.evaluated!==plan.counts.test.usable)throw Error('Prediction coverage differs from preflight.')
     const evaluation={id:randomUUID(),kind:'evaluation',createdBy:worker.owner_user_id,createdAt:now,snapshotId:plan.snapshotId,planId:plan.id,modelVersion:`${localModel}-${plan.id.slice(0,8)}`,...metrics,provenance:'Local pose baseline; metrics calculated against frozen test labels',releaseStatus:'candidate'}
     await c.query('insert into lab_vision_training_artifacts(id,kind,created_by,payload,created_at) values($1,$2,$3,$4,$5)',[evaluation.id,evaluation.kind,evaluation.createdBy,evaluation,evaluation.createdAt])
     plan={...plan,status:'complete',finishedAt:now,lastSeenAt:now,evaluationId:evaluation.id}
    }else if(b.action==='failed')plan={...plan,status:'failed',finishedAt:now,lastSeenAt:now,error:String(b.error??'Local runner stopped').slice(0,300)}
    else throw Error('Unknown runner action.')
    result=plan
   }
   await c.query('update lab_vision_training_artifacts set payload=$2 where id=$1',[plan.id,plan])
  }
  await c.query('commit');return json(result)
 }catch(e){await c.query('rollback');return json({error:e instanceof Error?e.message:'Runner request failed.'},400)}finally{c.release()}
}
