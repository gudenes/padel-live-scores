import type {liveVideoClock} from './live-video-clock'
type Snapshot=ReturnType<ReturnType<typeof liveVideoClock>['sample']>
export function redbullSource(value:string){try{const u=new URL(value);if(u.protocol!=='https:'||u.port||u.username||u.password||!['redbull.tv','www.redbull.tv'].includes(u.hostname)||!/^\/[\w-]+\/page\/rrn:content:(?:live-videos|videos):[0-9a-f-]{36}(?:\/|$)/i.test(u.pathname))return null;return u.origin+u.pathname}catch{return null}}
function request(message:Record<string,unknown>):Promise<{token?:string;sample:Snapshot}>{
 return new Promise((resolve,reject)=>{
  const id=crypto.randomUUID(),channel='pn-admin-video-v1'
  const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive)}
  const receive=(event:MessageEvent)=>{const m=event.data;if(event.source!==window||event.origin!==location.origin||m?.channel!==channel||m.direction!=='response'||m.id!==id)return;cleanup();if(m.ok)resolve(m);else reject(Error(m.error||'Video disconnected. Reconnect it.'))}
  const timer=setTimeout(()=>{cleanup();reject(Error('Scout did not respond. Install Scout 0.2.17 or newer, reload admin, then start Red Bull TV and click the Scout toolbar icon.'))},8000)
  window.addEventListener('message',receive);window.postMessage({channel,direction:'request',id,...message},location.origin)
 })
}
export async function connectRedbull(url:string){
 const sourceUrl=redbullSource(url);if(!sourceUrl)throw Error('Paste a Red Bull TV video page link.')
 const connected=await request({action:'connect',url:sourceUrl});let cached=connected.sample,received=Date.now(),failure='',closed=false
 async function command(action:string,args:Record<string,unknown>={}){
  if(closed)throw Error('Video disconnected. Reconnect it.')
  try{const result=await request({action,token:connected.token,...args});cached=result.sample;received=Date.now();failure='';return cached}catch(e){failure=(e as Error).message;throw e}
 }
 return {sourceUrl,provider:'redbull' as const,videoId:sourceUrl,sessionId:crypto.randomUUID(),
  snapshot:()=>{if(closed||failure||Date.now()-received>3000)throw Error(failure||'Video connection is stale. Reconnect it.');return cached},
  capture:()=>command('sample'),seek:(time:number)=>command('seek',{time}),pause:(paused:boolean)=>command('playback',{paused}),rate:(rate:number)=>command('speed',{rate}),
  close:()=>{closed=true;void request({action:'disconnect',token:connected.token}).catch(()=>{})}
 }
}
