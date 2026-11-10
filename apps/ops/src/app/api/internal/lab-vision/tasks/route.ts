import {auth} from '@/lib/auth'
import {pgPool} from '@/lib/db'
import {jobJson as json} from '@/lib/lab-vision-jobs'
import {estimateAnalysis} from '@/lib/scouting/analysis-estimate'
export async function GET(){
 const user=(await auth())?.user
 if(!user?.id||!user.isOperator)return json({error:'Administrator access required.'},403)
 // Jobs themselves are the durable task record: no duplicate notification writes.
 const {rows}=await pgPool().query(`select j.id,j.worker_id,j.status,j.stage,j.progress,j.setup,j.updated_at,v.match_id,v.match_kind,v.file_name
 from public.lab_vision_jobs j join public.match_video_uploads v on v.id=j.video_id
 where j.owner_user_id=$1 and (j.status in ('queued','running') or j.updated_at>now()-interval '7 days')
 order by case when j.status in ('queued','running') then 0 else 1 end,j.updated_at desc limit 30`,[user.id])
 return json({userId:user.id,tasks:rows.map(j=>({id:j.id,status:j.status,stage:j.stage,progress:j.progress,updated_at:j.updated_at,name:j.file_name,href:`/scouting/${encodeURIComponent(j.match_id)}/report?analysis=1`,estimate:estimateAnalysis(j)}))})
}
