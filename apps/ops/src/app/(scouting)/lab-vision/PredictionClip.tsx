'use client'
import {useRef,useState} from 'react'
import PlayerBox from './PlayerBox'
import type {Sample} from '@/lib/lab-vision/training'
const clock=(s:number)=>`${Math.floor(s/60)}:${(s%60).toFixed(2).padStart(5,'0')}`
/** The saved box belongs to the contact frame, not the moving player. */
export default function PredictionClip({sample,mistake,src}:{sample:Sample;mistake:Sample;src:string}){
 const video=useRef<HTMLVideoElement>(null)
 const [time,setTime]=useState(sample.time),[playing,setPlaying]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState('')
 const contact=!playing&&Math.abs(time-sample.time)<.04
 const seek=(t:number)=>{if(video.current){video.current.pause();video.current.currentTime=Math.max(sample.start,Math.min(sample.end,t));setTime(video.current.currentTime)}}
 async function play(restart=false){const v=video.current;if(!v)return;setError('');if(restart||v.currentTime>=sample.end-.04)v.currentTime=sample.start;try{await v.play()}catch{setError('Could not play this clip. Try replaying it.')}}
 return <div className="lvt-prediction-clip">
  <div className="lvt-shot-heading"><strong>{sample.player||'Selected hitter'}{sample.side&&sample.side!=='Unknown'?` · ${sample.side}`:''}</strong><span>Selected shot · {clock(sample.time)}</span></div>
  <div className="lv-video-frame">
   <video ref={video} src={src} preload="metadata" playsInline aria-label={`Selected shot by ${sample.player}, contact at ${clock(sample.time)}`} onLoadedMetadata={e=>{e.currentTarget.currentTime=sample.time;setTime(sample.time);setReady(true)}} onError={()=>{setError('Source video could not be loaded.');setReady(false)}} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onSeeked={e=>setTime(e.currentTarget.currentTime)} onTimeUpdate={e=>{const v=e.currentTarget;if(v.currentTime>=sample.end){v.pause();if(v.currentTime>sample.end+.04)v.currentTime=sample.end}setTime(Math.max(sample.start,Math.min(sample.end,v.currentTime)))}}/>
   <div className="lvt-shot-overlay"><span>Your label: <b>{mistake.actual}</b></span><span>Prediction: <b>{mistake.predicted}</b> · {Math.round(mistake.confidence*100)}%</span></div>
   {ready&&contact&&sample.box&&<PlayerBox box={sample.box} enabled={false} label={sample.player} sourceLabel="selected hitter" onChange={()=>{}}/>}
  </div>
  <div className="lvt-clip-timeline"><label htmlFor={`clip-${sample.id}`}>Selected clip · {clock(sample.start)}–{clock(sample.end)} <span>{contact?'Contact frame':`${Math.max(0,time-sample.start).toFixed(2)}s into clip`}</span></label><div className="lvt-clip-track"><input id={`clip-${sample.id}`} aria-label="Selected shot timeline" type="range" min={sample.start} max={sample.end} step={1/30} value={time} disabled={!ready} onChange={e=>seek(Number(e.target.value))}/><span className="lvt-contact-marker" aria-hidden="true" style={{left:`${100*(sample.time-sample.start)/(sample.end-sample.start)}%`}}/></div></div>
  <div className="lv-controls"><button className="ui-btn" disabled={!ready} onClick={()=>{if(playing)video.current?.pause();else void play()}}>{playing?'Pause':'Play selected shot'}</button><button className="ui-btn" disabled={!ready} onClick={()=>void play(true)}>Replay clip</button><button className="ui-btn" disabled={!ready} onClick={()=>seek(sample.time)}>Contact frame</button></div>
  <small>The marker shows contact. The hitter box appears only while paused at contact.</small>{error&&<p role="alert">{error}</p>}
 </div>
}
