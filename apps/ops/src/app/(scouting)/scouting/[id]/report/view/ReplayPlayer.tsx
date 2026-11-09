'use client';
import {useEffect,useRef,useState} from 'react';
import {videoSource} from '@/lib/scouting/video-review';
import {nextPointPlayback,type PlayWindow} from '@/lib/scouting/continuous-points';
type Player={getPlayerState:()=>number;seekTo:(n:number,b:boolean)=>void;playVideo:()=>void;pauseVideo:()=>void;getCurrentTime:()=>number;getDuration:()=>number;destroy:()=>void};
type API={Player:new(el:HTMLElement,options:object)=>Player};
declare global{interface Window{YT?:API;onYouTubeIframeAPIReady?:()=>void}}
let apiPromise:Promise<API>|null=null;
function youtube(){
 if(window.YT?.Player)return Promise.resolve(window.YT);
 if(!apiPromise)apiPromise=new Promise<API>((resolve,reject)=>{const previous=window.onYouTubeIframeAPIReady;window.onYouTubeIframeAPIReady=()=>{previous?.();resolve(window.YT!)};const s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';s.onerror=()=>{apiPromise=null;reject(Error('Could not load YouTube.'))};document.head.appendChild(s)});
 return apiPromise;
}
export default function ReplayPlayer({source,command,loop,onTime,stopAt,playWindows}:{playWindows?:PlayWindow[];stopAt?:number|null;source:NonNullable<ReturnType<typeof videoSource>>;command:{time:number;serial:number;play?:boolean};loop:{start:number;end:number}|null;onTime:(time:number,duration:number)=>void}){
 const host=useRef<HTMLDivElement>(null),video=useRef<HTMLVideoElement>(null),yt=useRef<Player|null>(null),latest=useRef({command,loop,onTime,stopAt,playWindows});latest.current={command,loop,onTime,stopAt,playWindows};
 const [error,setError]=useState('');
 const shell=useRef<HTMLDivElement>(null);
 const [playing,setPlaying]=useState(false),[muted,setMuted]=useState(false),[rate,setRate]=useState(1),[time,setTime]=useState(0),[length,setLength]=useState(0);
 const [settings,setSettings]=useState(false),[volume,setVolume]=useState(1),[awake,setAwake]=useState(true);
 const hideTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 function wake(){setAwake(true);if(hideTimer.current)clearTimeout(hideTimer.current);hideTimer.current=setTimeout(()=>setAwake(false),2500)}
 useEffect(()=>()=>{if(hideTimer.current)clearTimeout(hideTimer.current)},[]);
 function toggle(){const v=video.current;if(v){if(v.paused)void v.play().catch(()=>{});else v.pause()}}
 const stamp=(n:number)=>{const v=Math.max(0,Math.floor(n||0));return `${Math.floor(v/60)}:${String(v%60).padStart(2,'0')}`};
 function move(delta:number){const v=video.current;if(!v)return;v.pause();v.currentTime=Math.max(0,Math.min(v.duration||0,v.currentTime+delta));}

 useEffect(()=>{setError('');if(source.kind!=='youtube')return;let active=true,player:Player|null=null;let ready=false;
 youtube().then(api=>{if(!active||!host.current)return;const node=document.createElement('div');host.current.appendChild(node);player=new api.Player(node,{videoId:source.id,width:'100%',height:'100%',playerVars:{playsinline:1,origin:window.location.origin,start:Math.floor(latest.current.command.time)},events:{onReady:()=>{if(!active)return;ready=true;yt.current=player;player?.seekTo(latest.current.command.time,true);if(latest.current.command.serial&&latest.current.command.play!==false)player?.playVideo()},onError:()=>setError('This video cannot play here. Open the original video, or connect another supported source.')}})}).catch(()=>{if(active)setError('Could not load the video player. Check your connection and try again.')});
 const timer=setInterval(()=>{if(!ready||!player)return;const t=player.getCurrentTime(),d=player.getDuration();latest.current.onTime(t,d);if(latest.current.stopAt!=null&&t>=latest.current.stopAt){player.pauseVideo();return}if(player.getPlayerState()===1&&latest.current.playWindows){const next=nextPointPlayback(t,latest.current.playWindows);if(next==='end'){player.pauseVideo();return}if(typeof next==='number'){player.seekTo(next,true);return}}const l=latest.current.loop;if(l&&t>=l.end){player.seekTo(l.start,true);player.playVideo()}},300);
 return()=>{active=false;clearInterval(timer);yt.current=null;player?.destroy();host.current?.replaceChildren()};
 },[source.kind,source.id]);
 useEffect(()=>{if(yt.current){yt.current.seekTo(command.time,true);if(command.play===false)yt.current.pauseVideo();else if(command.serial)yt.current.playVideo()}if(video.current){video.current.currentTime=command.time;if(command.play===false)video.current.pause();else if(command.serial)void video.current.play().catch(()=>{})}},[command]);
 return <div className="vr-media-shell vr-youtube-controls" ref={shell} data-controls-visible={!playing||awake||settings} onMouseMove={wake} onMouseLeave={()=>setAwake(false)} onKeyDown={e=>{if(source.kind==='youtube'||(e.target as HTMLElement).closest('input,select,button'))return;if([' ','k','ArrowLeft','ArrowRight','m','f',',','.'].includes(e.key)){e.preventDefault();wake();if(e.key===' '||e.key==='k')toggle();if(e.key==='ArrowLeft')move(-5);if(e.key==='ArrowRight')move(5);if(e.key===',')move(-1/30);if(e.key==='.')move(1/30);if(e.key==='m'&&video.current)video.current.muted=!video.current.muted;if(e.key==='f'){if(document.fullscreenElement)void document.exitFullscreen();else void shell.current?.requestFullscreen()}}}} tabIndex={source.kind==='youtube'?-1:0} aria-label="Match video player"><div className="vr-player">{source.kind==='youtube'?<div ref={host} className="vr-embed"/>:<video ref={video} src={source.url} playsInline onClick={()=>{toggle();wake()}} onDoubleClick={()=>{if(document.fullscreenElement)void document.exitFullscreen();else void shell.current?.requestFullscreen()}} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onVolumeChange={e=>{setMuted(e.currentTarget.muted);setVolume(e.currentTarget.volume)}} onRateChange={e=>setRate(e.currentTarget.playbackRate)} onLoadedMetadata={e=>{setLength(e.currentTarget.duration);e.currentTarget.currentTime=latest.current.command.time;onTime(e.currentTarget.currentTime,e.currentTarget.duration);if(latest.current.command.serial&&latest.current.command.play!==false)void e.currentTarget.play().catch(()=>{})}} onTimeUpdate={e=>{const v=e.currentTarget;setTime(v.currentTime);onTime(v.currentTime,v.duration);if(stopAt!=null&&v.currentTime>=stopAt){v.pause();return}if(!v.paused&&!v.seeking&&playWindows){const next=nextPointPlayback(v.currentTime,playWindows);if(next==='end'){v.pause();return}if(typeof next==='number'){v.currentTime=next;return}}if(loop&&v.currentTime>=loop.end)v.currentTime=loop.start}} onError={()=>setError('This video could not load. Check the source link or use another video.')} />}{error&&<p role="alert" className="vr-error">{error} <a href={source.url} target="_blank" rel="noreferrer">Open original video</a></p>}</div>{source.kind!=='youtube'&&<div className="vr-transport" aria-label="Video playback controls">
 <input type="range" aria-label="Video seek" min="0" max={length||0} step="0.033333" value={Math.min(time,length)} onChange={e=>{if(video.current)video.current.currentTime=Number(e.target.value)}}/>
 <div className="vr-transport-row">
 <button className="ui-btn" title={playing?'Pause':'Play'} aria-label={playing?'Pause video':'Play video'} onClick={()=>{const v=video.current;if(v){if(v.paused)void v.play().catch(()=>{});else v.pause()}}}>{playing?<Icon name="pause"/>:<Icon name="play"/>}</button>
 <button className="ui-btn" title={muted?'Unmute':'Mute'} aria-label={muted?'Unmute video':'Mute video'} onClick={()=>{if(video.current)video.current.muted=!video.current.muted}}>{muted?<Icon name="mute"/>:<Icon name="volume"/>}</button>
 <input className="vr-volume" type="range" aria-label="Volume" min="0" max="1" step="0.05" value={muted?0:volume} onChange={e=>{if(video.current){video.current.volume=Number(e.target.value);video.current.muted=false}}}/>
 <span className="vr-transport-time">{stamp(time)} / {stamp(length)}</span>
 <div className="vr-frame-controls">
 <button className="ui-btn" title="Back 5 seconds" aria-label="Back 5 seconds" onClick={()=>move(-5)}><span aria-hidden="true">−5s</span></button>
 <button className="ui-btn" title="Previous frame (30 fps)" aria-label="Previous frame" onClick={()=>move(-1/30)}><span aria-hidden="true">‹</span></button>
 <span>Frame</span>
 <button className="ui-btn" title="Next frame (30 fps)" aria-label="Next frame" onClick={()=>move(1/30)}><span aria-hidden="true">›</span></button>
 <button className="ui-btn" title="Forward 5 seconds" aria-label="Forward 5 seconds" onClick={()=>move(5)}><span aria-hidden="true">+5s</span></button>
 </div>
 <div className="vr-player-settings"><button className="ui-btn" title="Settings" aria-label="Player settings" aria-expanded={settings} onClick={()=>setSettings(!settings)}><Icon name="settings"/></button>{settings&&<div className="vr-speed-menu"><label>Playback speed<select aria-label="Playback speed" value={rate} onChange={e=>{if(video.current)video.current.playbackRate=Number(e.target.value);setSettings(false)}}>{[.25,.5,.75,1,1.5,2].map(v=><option key={v} value={v}>{v===1?'Normal':`${v}×`}</option>)}</select></label><small>Space / K · Play or pause<br/>← → · 5 seconds · , . · Frame</small></div>}</div>
 <button className="ui-btn" title="Fullscreen" aria-label="Fullscreen video" onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen();else void shell.current?.requestFullscreen()}}><Icon name="fullscreen"/></button>
 </div></div>}</div>;
}

function Icon({name}:{name:string}){const paths:Record<string,string>={play:'M8 5v14l11-7z',pause:'M6 5h4v14H6z M14 5h4v14h-4z',volume:'M3 9h4l5-4v14l-5-4H3z M16 8q6 4 0 8 M18 4q10 8 0 16',mute:'M3 9h4l5-4v14l-5-4H3z M16 9l6 6 M22 9l-6 6',fullscreen:'M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5',settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'};return <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill={name==='play'||name==='pause'?'currentColor':'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><path d={paths[name]}/></svg>}
