import {auth} from '@/lib/auth'
import {canScout} from '@/lib/scouting-permissions'
import {pgPool} from '@/lib/db'
import {listUploadsPlaylistItems,listVideoDetails,type VideoDetails} from '@/lib/youtube-channel-api'
import {rankBroadcasts,type BroadcastMatch,type BroadcastCandidate} from '@/lib/scouting/broadcast-candidates'
export const dynamic='force-dynamic'
const cache=new Map<string,{at:number;videos:Promise<VideoDetails[]>}>()
async function uploads(playlist:string,key:string){
 const existing=cache.get(playlist);if(existing&&Date.now()-existing.at<300000)return existing.videos
 const videos=listUploadsPlaylistItems(playlist,key,50).then(items=>items.length?listVideoDetails(items.map(i=>i.videoId),key):[])
 cache.set(playlist,{at:Date.now(),videos});try{return await videos}catch(e){cache.delete(playlist);throw e}
}
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){
 if(!canScout((await auth())?.user))return Response.json({error:'Scouting access required.'},{status:403})
 const {id}=await params;if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))return Response.json({error:'Invalid match.'},{status:400})
 try{
 const db=pgPool();const result=await db.query(`select m.id,m.tournament_id,t.name as tournament,m.court,m.started_at as "startedAt",m.scheduled_at as "scheduledAt",coalesce(t.timezone,'UTC') as timezone from matches m join tournaments t on t.id=m.tournament_id where m.id=$1`,[id])
 if(!result.rows[0])return Response.json({error:'Match not found.'},{status:404})
 const raw=result.rows[0];const match:BroadcastMatch={...raw,startedAt:raw.startedAt?.toISOString()??null,scheduledAt:raw.scheduledAt?.toISOString()??null}
 const known=await db.query(`select youtube_video_id as "videoId",title,court,actual_start_at as start,actual_end_at as "end",state from fip_court_streams where tournament_id=$1`,[raw.tournament_id])
 const rows:Omit<BroadcastCandidate,'courtMatched'|'suggestedOffset'>[]=known.rows.map(r=>({...r,start:r.start?.toISOString()??null,end:r.end?.toISOString()??null,title:r.title??r.videoId}))
 const warnings:string[]=[]
 // Recent official uploads add archived Premier streams missing from the live-only discovery table.
 const key=process.env.YOUTUBE_API_KEY
 if(key){
  const channels=await db.query(`select uploads_playlist_id from youtube_channels where is_active=true and name ilike $1`,[/\bfip\b/i.test(match.tournament)?'%FIP%':'%Premier%'])
  const tokens=match.tournament.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/[^a-z0-9]+/).filter(x=>x.length>3&&!['premier','padel','major','bronze','silver','gold','platinum','tour','2026'].includes(x))
  for(const ch of channels.rows){try{
   const videos=await uploads(ch.uploads_playlist_id,key)
   for(const v of videos){const title=v.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');if(!v.actualStartTime||!tokens.some(t=>title.includes(t))||rows.some(r=>r.videoId===v.videoId))continue
    rows.push({videoId:v.videoId,title:v.title,court:null,start:v.actualStartTime,end:v.actualEndTime,state:v.actualEndTime?'archived':v.liveBroadcastContent})
   }
  }catch{warnings.push('Official YouTube discovery is unavailable. You can still paste a video link.')}}
 }else warnings.push('YouTube discovery is not configured; showing stored broadcasts only.')
 return Response.json({match,candidates:rankBroadcasts(match,rows),warnings,coverage:'Recent 50 official uploads per channel; historical coverage may be incomplete.'},{headers:{'Cache-Control':'no-store'}})
 }catch{return Response.json({error:'Could not load match broadcasts. Retry or paste a video link.'},{status:503})}
}
