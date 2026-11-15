import {localViewerPreview} from '@/lib/lab-vision/local-viewer-preview';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {auth} from '@/lib/auth'
import {canViewReports} from '@/lib/scouting-permissions'
import {pgPool} from '@/lib/db'
import {videoUuid} from '@/lib/scouting/match-video'
import {viewerFile,viewerChunk} from '@/lib/lab-vision-results'
import {videoStorage} from '@/lib/match-video-storage'
import {GetObjectCommand} from '@aws-sdk/client-s3'
import {jobJson as json} from '@/lib/lab-vision-jobs'
export const runtime='nodejs'
export async function GET(_:Request,{params}:{params:Promise<{id:string;file:string}>}){
 const user=(await auth())?.user;if(!user?.id||!canViewReports(user))return json({error:'Sign in to review this match.'},401)
 const {id,file}=await params;if(!videoUuid.test(id)||!viewerFile.test(file))return json({error:'Invalid asset.'},400)
 const j=(await pgPool().query("select j.result from lab_vision_jobs j join match_video_uploads v on j.video_id=v.id where j.id=$1 and j.status='complete' and v.status='ready'",[id])).rows[0];
 const viewer=j?.result?.viewer;const preview=viewer?await localViewerPreview(id,viewer.prefix):null;
 if(preview&&(file==='manifest.json'||file.startsWith('movement-'))){try{return new Response(await readFile(join(preview.directory,file)),{headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}catch{return json({error:'Preview asset unavailable.'},503)}}
 if(!viewer||(file.startsWith('movement-')&&!viewer.manifest.movement)||(file!=='manifest.json'&&viewerChunk(file)>=viewer.manifest.chunks))return json({error:'Analysis not available.'},404)
 try{const {client,Bucket}=videoStorage(),o=await client.send(new GetObjectCommand({Bucket,Key:viewer.prefix+file}));return new Response(o.Body!.transformToWebStream(),{headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})}catch{return json({error:'Analysis asset unavailable.'},503)}
}
