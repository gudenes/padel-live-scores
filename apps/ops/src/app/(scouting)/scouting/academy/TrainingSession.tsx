'use client'
import {useEffect,useRef,useState} from 'react'
import {Button} from '@/components/ui'
import {compareCall,type Call} from './scoring'
import lesson from './lesson.json'
import styles from './academy.module.css'
type Cue='ready'|'watch'|'serve'|'rally'|'fault'|'finish'|'player'|'shot'|'confirm'|'touch'|'done'
export default function TrainingSession({mode,demo,index,videoUrl,onSave,onNext,onPractice}:{mode:'pro'|'expert';demo:boolean;index:number;videoUrl:string;onSave:(call:Call)=>void;onNext:()=>void;onPractice:()=>void}){
 const video=useRef<HTMLVideoElement>(null),frame=useRef<HTMLIFrameElement>(null);
 const [cue,setCue]=useState<Cue>('ready'),[attempt,setAttempt]=useState(0),[result,setResult]=useState<Call|null>(null),[error,setError]=useState(''),[playing,setPlaying]=useState(false);
 const rally=lesson.rallies[index];
 const [touchIndex,setTouchIndex]=useState(0);
 const nextTouch=lesson.expertTouches[touchIndex];
 const messages:Record<Cue,string>={touch:nextTouch?`Press the highlighted keyboard letter for ${lesson.players[nextTouch.player].name}. ${touchIndex===0?'The first tap records the returner.':''}`:'Follow the rally.',ready:'Watch the opening rally. We’ll pause and highlight the actual scouting controls.',watch:'Watch the server. The first serve starts at 00:07.',serve:'Press Start rally in the scouting panel.',rally:'Follow the ball. We’ll pause at the next action.',fault:'First serve missed. Press First fault.',finish:'Watch the rally ending and identify the final shot.',player:'Bautista hits a winner. Click Winner on Jairo Bautista’s card.',shot:'In the shot dialog, choose Volley.',confirm:'Press Space on your keyboard to save the shot and finish this point.',done:'You’ve completed the guided rally. Now make the same calls yourself.'};
 function post(data:Record<string,unknown>){frame.current?.contentWindow?.postMessage({channel:'scout-academy',...data},location.origin)}
 function play(){video.current?.play().catch(()=>setError('Press Play to resume the video.'))}
 useEffect(()=>{
  const send=()=>{post({type:'media',time:video.current?.currentTime??0});post({type:'cue',cue:demo?cue:'none',player:nextTouch?.player})};send();const timer=setInterval(send,100);
  const receive=(event:MessageEvent)=>{
   if(event.origin!==location.origin||event.source!==frame.current?.contentWindow||event.data?.channel!=='scout-academy')return;
   const data=event.data;if(data.type==='ready'){send();return;}
   if(data.type==='shot-chosen'&&demo&&cue==='shot')setCue('confirm');
   if(data.type!=='action')return;
   if(data.action==='touch'&&demo&&cue==='touch'&&data.player===nextTouch?.player){setTouchIndex(i=>i+1);setCue('finish');play();}
   if(data.action==='start'){if(demo)setCue('rally');play();}
   if(data.action==='first-fault'&&demo){setCue('finish');play();}
   if(data.action==='prepare'){video.current?.pause();if(demo)setCue('shot');}
   if(data.action==='score'&&data.point){video.current?.pause();const p=data.point;if(!Number.isInteger(p.player)||p.player<0||p.player>3||!['winner','unforced','forced'].includes(p.outcome))return;const answer={player:p.player,outcome:p.outcome,shot:p.shot||'not-recorded'};if(demo)setCue('done');else{setResult(answer);onSave(answer);}}
  };window.addEventListener('message',receive);return()=>{clearInterval(timer);window.removeEventListener('message',receive)};
 },[cue,demo,onSave,nextTouch]);
 function tick(){const v=video.current;if(!v)return;post({type:'media',time:v.currentTime});if(demo){if(cue==='watch'&&v.currentTime>=7){v.pause();v.currentTime=7;setCue('serve')}else if(cue==='rally'&&rally.fault!==null&&v.currentTime>=rally.fault){v.pause();setCue('fault')}else if(mode==='expert'&&(cue==='finish'||cue==='rally')&&nextTouch&&v.currentTime>=nextTouch.time){v.pause();v.currentTime=nextTouch.time;setCue('touch')}else if((cue==='finish'||cue==='rally')&&v.currentTime>=rally.end){v.pause();setCue('player')}}else if(v.currentTime>=rally.end)v.pause();}
 function replay(){video.current?.pause();if(video.current)video.current.currentTime=demo?0:Math.max(0,rally.start-3);setCue('ready');setTouchIndex(0);setResult(null);setAttempt(a=>a+1)}
 return <div className={`${styles.workspace} ${styles.trainingWorkspace}`}><section><div className={`${styles.video} ${demo&&!playing?styles.focusVideo:''}`}><video ref={video} src={videoUrl} poster="/scout-web/assets/academy-poster.jpg" playsInline onLoadedMetadata={()=>{if(video.current)video.current.currentTime=demo?0:Math.max(0,rally.start-3)}} onTimeUpdate={tick} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onError={()=>setError('The training video could not load.')} aria-label="Training match video"/><div className={styles.lessonOverlay} aria-live="polite"><span>{demo?'WATCH & LEARN':'YOUR TURN'} · RALLY {rally.number}</span><h2>{demo?messages[cue]:result?'Point recorded. Review your call below.':'Scout this rally with the same controls and shortcuts as the web app.'}</h2>{demo&&cue==='confirm'&&<kbd className={styles.saveKey}>Space · Save shot</kbd>}{cue==='ready'&&!result&&<Button variant="primary" onClick={()=>{setCue('watch');play()}}>▶ {demo?'Begin guided rally':'Play rally'}</Button>}{demo&&cue==='done'&&<Button variant="primary" onClick={onPractice}>Now it’s my turn →</Button>}</div></div><div className={styles.playback}><Button onClick={()=>playing?video.current?.pause():play()} disabled={demo&&!['watch','rally','finish'].includes(cue)}>{playing?'Pause video':'Resume video'}</Button><Button onClick={replay}>Replay rally</Button><span>{mode==='expert'?'Expert':'Pro'} mode · actual web scouting controls</span></div>{error&&<p role="alert" className={styles.error}>{error}</p>}{result&&<div className={styles.feedback}><strong>{compareCall(result,rally).correct}/3 match the reference</strong><p>Reference: {lesson.players[rally.player].name} · {rally.outcome} · {rally.shot}</p><Button variant="primary" onClick={onNext}>Next rally →</Button><Button onClick={replay}>Try again</Button></div>}<p className={styles.note}>Practice stays separate from the match. Results measure agreement with the saved scout.</p></section><iframe key={attempt} ref={frame} className={styles.scoutFrame} src={`/scout-web/panel.html?playground&academy=1&mode=${mode}`} title="Web scouting practice controls"/></div>
}
