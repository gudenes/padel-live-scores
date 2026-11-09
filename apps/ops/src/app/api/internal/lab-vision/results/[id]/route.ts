import {auth} from '@/lib/auth'
import {canViewReports} from '@/lib/scouting-permissions'
import {pgPool} from '@/lib/db'
import {videoUuid} from '@/lib/scouting/match-video'
import {jobJson as json} from '@/lib/lab-vision-jobs'
export const runtime='nodejs'
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
 const user=(await auth())?.user;if(!user?.id||!canViewReports(user))return json({error:'Sign in to review this match.'},401)
 const {id}=await params,url=new URL(req.url),kind=url.searchParams.get('kind')??'canonical',video=url.searchParams.get('video');
 if(!videoUuid.test(id)||!['canonical','manual'].includes(kind)||(video&&!videoUuid.test(video)))return json({error:'Invalid match or video.'},400)
 const db=pgPool(),v=(await db.query("select id from match_video_uploads where match_id=$1 and match_kind=$2 and status='ready' and ($3::uuid is null or id=$3::uuid) order by completed_at desc limit 1",[id,kind,video])).rows[0];
 if(!v)return json({result:null,videoId:null})
 // A later short sample must not replace a completed full analysis of this video.
 const j=(await db.query("select id,setup,result,updated_at from lab_vision_jobs where video_id=$1 and status='complete' and result->'viewer' is not null order by (setup->>'analysisSeconds')::numeric desc,updated_at desc limit 1",[v.id])).rows[0];
 if(!j)return json({result:null,videoId:v.id})
 return json({videoId:v.id,result:{id:j.id,videoId:v.id,updatedAt:j.updated_at,manifest:j.result.viewer.manifest,assetBase:`/api/internal/lab-vision/assets/${j.id}/`}})
}
