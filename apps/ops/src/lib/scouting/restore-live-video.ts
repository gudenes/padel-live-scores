import {youtubeId} from './live-video-clock'
const canonical=(value:unknown)=>typeof value==='string'&&youtubeId(value)?'https://www.youtube.com/watch?v='+youtubeId(value):null
export function sessionVideoSource(session:{document?:{setup?:{videoSourceUrl?:unknown;videoPageUrl?:unknown};selectedMatch?:{videoUrl?:unknown}}}|null|undefined){
 const doc=session?.document
 return canonical(doc?.setup?.videoSourceUrl)||canonical(doc?.setup?.videoPageUrl)||canonical(doc?.selectedMatch?.videoUrl)
}
/** Reads links only. A production fallback never imports or writes production scouting state. */
export async function restoreLiveVideo({matchId,localTest,cached,request=fetch,signal}:{matchId:string;localTest:boolean;cached:string;request?:typeof fetch;signal?:AbortSignal}){
 const stored=canonical(cached);if(stored)return stored
 const production=`/api/internal/video-scouting/${matchId}`
 const endpoints=localTest?[`/api/internal/scouting/${matchId}/live-session`,production]:[production]
 for(const endpoint of endpoints){
  const response=await request(endpoint,{cache:'no-store',signal})
  if(!response.ok)throw Error('Could not restore the saved video. Please retry; your saved scouting has not changed.')
  const data=await response.json();const source=sessionVideoSource(data.session)
  if(source)return source
 }
 return null
}
