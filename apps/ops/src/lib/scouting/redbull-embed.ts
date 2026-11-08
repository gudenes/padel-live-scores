import {redbullSource} from './redbull-video-bridge';

/** Use only the official embed for a validated Red Bull video page. */
export function redbullEmbedUrl(value:string,time?:number){
 const source=redbullSource(value);
 if(!source)return null;
 const url=new URL(source);
 const match=url.pathname.match(/^\/([\w-]+)\/page\/(rrn:content:(?:live-videos|videos):[0-9a-f-]{36})(?:\/|$)/i);
 if(time!==undefined&&(!Number.isFinite(time)||time<0))return null;
 return match?`https://www.redbull.tv/${match[1]}/embed/${match[2]}${time===undefined?'':'?time='+Math.floor(time)}`:null;
}
