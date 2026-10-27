/** YouTube exposes a playback clock, but not the true live edge or DVR seekable range. */
export type LivePlayer={getCurrentTime:()=>number;getDuration:()=>number;getPlayerState:()=>number;getPlaybackRate:()=>number}
export function liveVideoClock(videoId:string,sessionId:string,now=()=>performance.now()) {
 let epoch=0,previous:{time:number;at:number;rate:number;playing:boolean}|null=null,settlingUntil=0
 return {
  markSeek(){epoch++;previous=null;settlingUntil=now()+800},
  sample(player:LivePlayer){
   const at=now(),time=player.getCurrentTime(),duration=player.getDuration(),status=player.getPlayerState(),rate=player.getPlaybackRate()
   if(!Number.isFinite(time)||time<0)throw Error('Video clock is not ready.')
   if(previous){const expected=previous.time+(previous.playing?(at-previous.at)/1000*previous.rate:0)
    if(Math.abs(time-expected)>1.5){epoch++;settlingUntil=at+800}
   }
   previous={time,at,rate,playing:status===1}
   return {tabId:0,documentId:sessionId,videoId,mediaId:'youtube:'+videoId,seekEpoch:epoch,time,at:new Date().toISOString(),paused:status!==1,ended:status===0,seeking:at<settlingUntil,readyState:[1,2,0].includes(status)?4:0,rate,duration:Number.isFinite(duration)?duration:null,
    // Do not invent a seekable range from getDuration(): live DVR may be disabled or expired.
    seekable:[] as number[][],page:'https://www.youtube.com/watch?v='+videoId,visible:true,area:1}
  }
 }
}
export function youtubeId(value:string){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return null;const id=u.hostname==='youtu.be'?u.pathname.slice(1):['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname)?u.searchParams.get('v')||u.pathname.match(/^\/(?:live|embed)\/([^/]+)/)?.[1]:null;return id&&/^[\w-]{11}$/.test(id)?id:null}catch{return null}}
