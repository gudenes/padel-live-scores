'use client';
import {useEffect,useRef,useState} from 'react';
import {videoSource} from '@/lib/scouting/video-review';
type Player={seekTo:(n:number,b:boolean)=>void;playVideo:()=>void;getCurrentTime:()=>number;getDuration:()=>number;destroy:()=>void};
type API={Player:new(el:HTMLElement,options:object)=>Player};
declare global{interface Window{YT?:API;onYouTubeIframeAPIReady?:()=>void}}
let apiPromise:Promise<API>|null=null;
function youtube(){
 if(window.YT?.Player)return Promise.resolve(window.YT);
 if(!apiPromise)apiPromise=new Promise<API>((resolve,reject)=>{const previous=window.onYouTubeIframeAPIReady;window.onYouTubeIframeAPIReady=()=>{previous?.();resolve(window.YT!)};const s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';s.onerror=()=>{apiPromise=null;reject(Error('Could not load YouTube.'))};document.head.appendChild(s)});
 return apiPromise;
}
export default function ReplayPlayer({source,command,loop,onTime}:{source:NonNullable<ReturnType<typeof videoSource>>;command:{time:number;serial:number};loop:{start:number;end:number}|null;onTime:(time:number,duration:number)=>void}){
 const host=useRef<HTMLDivElement>(null),video=useRef<HTMLVideoElement>(null),yt=useRef<Player|null>(null),latest=useRef({command,loop,onTime});latest.current={command,loop,onTime};
 const [error,setError]=useState('');
 useEffect(()=>{setError('');if(source.kind!=='youtube')return;let active=true,player:Player|null=null;let ready=false;
 youtube().then(api=>{if(!active||!host.current)return;const node=document.createElement('div');host.current.appendChild(node);player=new api.Player(node,{videoId:source.id,width:'100%',height:'100%',playerVars:{playsinline:1,origin:window.location.origin,start:Math.floor(latest.current.command.time)},events:{onReady:()=>{if(!active)return;ready=true;yt.current=player;player?.seekTo(latest.current.command.time,true);if(latest.current.command.serial)player?.playVideo()},onError:()=>setError('This video cannot play here. Open the original video, or connect another supported source.')}})}).catch(()=>{if(active)setError('Could not load the video player. Check your connection and try again.')});
 const timer=setInterval(()=>{if(!ready||!player)return;const t=player.getCurrentTime(),d=player.getDuration();latest.current.onTime(t,d);const l=latest.current.loop;if(l&&t>=l.end){player.seekTo(l.start,true);player.playVideo()}},300);
 return()=>{active=false;clearInterval(timer);yt.current=null;player?.destroy();host.current?.replaceChildren()};
 },[source.kind,source.id]);
 useEffect(()=>{if(yt.current){yt.current.seekTo(command.time,true);if(command.serial)yt.current.playVideo()}if(video.current){video.current.currentTime=command.time;if(command.serial)void video.current.play().catch(()=>{})}},[command]);
 return <div className="vr-player">{source.kind==='youtube'?<div ref={host} className="vr-embed"/>:<video ref={video} src={source.url} controls playsInline onLoadedMetadata={e=>{e.currentTarget.currentTime=latest.current.command.time;onTime(e.currentTarget.currentTime,e.currentTarget.duration);if(latest.current.command.serial)void e.currentTarget.play().catch(()=>{})}} onTimeUpdate={e=>{const v=e.currentTarget;onTime(v.currentTime,v.duration);if(loop&&v.currentTime>=loop.end)v.currentTime=loop.start}} onError={()=>setError('This video could not load. Check the source link or use another video.')} />}{error&&<p role="alert" className="vr-error">{error} <a href={source.url} target="_blank" rel="noreferrer">Open original video</a></p>}</div>;
}
