import {redbullSource} from './redbull-video-bridge';
import type { TimelinePoint } from './tracking';
import type { ViewRally } from './report-view';
export function videoSource(value:string){
 const redbull=redbullSource(value);if(redbull)return {kind:'redbull' as const,id:redbull,url:redbull};
 try {const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return null;
 const h=u.hostname.toLowerCase();let id='';
 if(h==='youtu.be')id=u.pathname.slice(1);
 if(['youtube.com','www.youtube.com','m.youtube.com','www.youtube-nocookie.com'].includes(h))id=u.searchParams.get('v')||u.pathname.match(/^\/(?:embed|live|shorts)\/([^/]+)/)?.[1]||'';
 if(/^[\w-]{11}$/.test(id))return {kind:'youtube' as const,id,url:`https://www.youtube.com/watch?v=${id}`};
 if(/\.(mp4|webm|ogg)$/i.test(u.pathname))return {kind:'file' as const,id:u.href,url:u.href};
 }catch{}return null;
}
export function replayPoints(points:TimelinePoint[],rallies:ViewRally[]){
 const map=new Map(rallies.map(r=>[r.id,r]));
 return points.map(p=>{const r=map.get(p.id);const valid=typeof r?.start==='number'&&Number.isFinite(r.start)&&r.start>=0&&typeof r.end==='number'&&Number.isFinite(r.end)&&r.end>r.start;
 return {...p,start:valid?r!.start:null,end:valid?r!.end:null,touchCount:r?.touches.length||null};});
}
export function timeLabel(n:number){const s=Math.max(0,Math.floor(n));return [Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(v=>String(v).padStart(2,'0')).join(':');}
export function parseTime(s:string){if(!/^\d{1,3}:[0-5]\d(?::[0-5]\d)?$/.test(s))return null;return s.split(':').reduce((a,b)=>a*60+Number(b),0);}
export function pointScore(p:TimelinePoint){const set=p.before.sets.at(-1);return `Set ${p.before.sets.length} · ${set?.a??0}–${set?.b??0} · ${p.before.currentGame.a}–${p.before.currentGame.b}`;}

export function matchesRallyLength(count:number|null,range:string){
 if(range==='all')return true;
 if(range==='unknown')return count===null;
 if(count===null)return false;
 if(range==='short')return count<=3;
 if(range==='medium')return count>=4&&count<=6;
 if(range==='long')return count>=7&&count<=9;
 return range==='extended'&&count>=10;
}

/** Playback padding never changes the recorded scouting timestamps. */
export function replayRange(start:number|null|undefined,end:number|null|undefined,duration=0){
 if(start==null||end==null||!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return null;
 const from=Math.max(0,start-3),to=duration>0?Math.min(duration,end+3):end+3;
 return to>from?{start:from,end:to}:null;
}
