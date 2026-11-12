import {anchorAlignment,savedScout} from '@/lib/lab-vision/prepare-review'
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
 const db=pgPool(),v=(await db.query("select id,calibration_setup from match_video_uploads where match_id=$1 and match_kind=$2 and status='ready' and ($3::uuid is null or id=$3::uuid) order by completed_at desc limit 1",[id,kind,video])).rows[0];
 if(!v)return json({result:null,videoId:null})
 // A later short sample must not replace a completed full analysis of this video.
 const j=(await db.query("select id,setup,result,updated_at from lab_vision_jobs where video_id=$1 and status='complete' and result->'viewer' is not null order by (setup->>'analysisSeconds')::numeric desc,updated_at desc limit 1",[v.id])).rows[0];
 if(!j)return json({result:null,videoId:v.id})
 const manifest={...j.result.viewer.manifest};const setup=v.calibration_setup??j.setup;
 if(setup?.scoutingAnchor){try{const alignment=anchorAlignment(setup,await savedScout(id,kind,db));if(alignment)manifest.scoutingAlignment=alignment}catch{/* Changed scouting requires a new anchor; do not guess. */}}
 const reviewed=(await db.query('select payload from lab_vision_annotation_alignments where job_id=$1',[j.id])).rows[0]?.payload;
 if(!manifest.scoutingAlignment?.segments?.length&&reviewed&&reviewed.method!=='user-first-scouted-point'&&Number.isFinite(reviewed.offset))manifest.scoutingAlignment={version:1,offsetSeconds:reviewed.offset,method:'reviewed-shot-alignment'};
 return json({videoId:v.id,result:{id:j.id,videoId:v.id,updatedAt:j.updated_at,manifest,assetBase:`/api/internal/lab-vision/assets/${j.id}/`}})
}
