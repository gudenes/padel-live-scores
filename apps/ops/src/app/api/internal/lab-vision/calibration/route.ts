import {auth} from '@/lib/auth'
import {hasAdminRequestOrigin} from '@/lib/admin-request-origin'
import {pgPool} from '@/lib/db'
import {videoUuid} from '@/lib/scouting/match-video'
import {jobBody,validateJobSetup,jobJson as json} from '@/lib/lab-vision-jobs'
export const runtime='nodejs'
export async function GET(req:Request){
 const user=(await auth())?.user;if(!user?.id||!user.isOperator)return json({error:'Administrator access required.'},403)
 const id=new URL(req.url).searchParams.get('video');if(!videoUuid.test(id??''))return json({error:'Invalid video.'},400)
 const {rows}=await pgPool().query(`select coalesce(v.calibration_setup,(select j.setup from public.lab_vision_jobs j where j.video_id=v.id order by j.created_at desc limit 1)) as setup from public.match_video_uploads v where v.id=$1 and v.owner_user_id=$2`,[id,user.id]);
 if(!rows[0])return json({error:'Video not found.'},404)
 return json({setup:rows[0].setup??null})
}
export async function POST(req:Request){
 const user=(await auth())?.user;if(!user?.id||!user.isOperator)return json({error:'Administrator access required.'},403)
 if(!hasAdminRequestOrigin(req))return json({error:'Invalid origin.'},403)
 let b;try{b=await jobBody(req,160000)}catch(e){return json({error:(e as Error).message},400)}
 if(!videoUuid.test(b.videoId??''))return json({error:'Invalid video.'},400)
 const db=pgPool(),{rows}=await db.query('select * from public.match_video_uploads where id=$1 and owner_user_id=$2',[b.videoId,user.id]);
 if(!rows[0])return json({error:'Video not found.'},404)
 let setup;try{setup=validateJobSetup(b.setup,rows[0])}catch(e){return json({error:(e as Error).message},400)}
 await db.query('update public.match_video_uploads set calibration_setup=$1 where id=$2 and owner_user_id=$3',[JSON.stringify(setup),b.videoId,user.id]);
 return json({ok:true,setup})
}
