'use client'
import {useEffect,useState,useRef} from 'react'
import {analysisProgress} from '@/lib/scouting/analysis-progress'
import {CheckCircle} from './Icons'
import AnalysisActivity from './AnalysisActivity'
import type {VideoSetup} from '@/lib/scouting/video-setup'
import type {HostedVideo} from './HostedVideoUpload'
export default function LocalAnalysis({video,setup,onPrepare,onStatus,players=[]}:{video:HostedVideo;setup:VideoSetup|null;onPrepare:(setup:VideoSetup|null)=>void;onStatus?:(text:string)=>void;players?:{id:string;name:string;shortName:string;avatar:string}[]}){
 const [state,setState]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[scope,setScope]=useState('sample'),[saved,setSaved]=useState<VideoSetup|null>(null)
 const [pollError,setPollError]=useState('')
 const [stored,setStored]=useState<VideoSetup|null>(null),[saveError,setSaveError]=useState('');
 useEffect(()=>{let alive=true;setStored(null);void fetch(`/api/internal/lab-vision/calibration?video=${video.id}`).then(async r=>{if(!r.ok)throw Error('Could not load saved calibration.');return r.json()}).then(d=>{if(alive){setStored(d.setup);setSaveError('')}}).catch(e=>{if(alive)setSaveError(e.message)});return()=>{alive=false}},[video.id]);
 useEffect(()=>{if(!setup?.confirmed||setup.file.name!==video.name||setup.file.size!==video.size)return;let alive=true;void fetch('/api/internal/lab-vision/calibration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({videoId:video.id,setup})}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||'Could not save calibration.');if(alive){setStored(d.setup);setSaveError('')}}).catch(e=>{if(alive)setSaveError(e.message)});return()=>{alive=false}},[setup,video.id,video.name,video.size]);
 const statusCallback=useRef(onStatus);statusCallback.current=onStatus
 async function refresh(){const r=await fetch(`/api/internal/lab-vision/jobs?video=${video.id}`,{cache:'no-store'});if(r.status===403){setState({denied:true});return}const d=await r.json();if(!r.ok)throw Error(d.error||'Could not load worker status.');setState(d);setPollError('')}
 useEffect(()=>{let alive=true;setState(null);setSaved(null);setError('');setPollError('');
 const poll=async()=>{try{const r=await fetch(`/api/internal/lab-vision/jobs?video=${video.id}`,{cache:'no-store'});const d=await r.json();if(!alive)return;if(r.status===403){setState({denied:true});return}if(!r.ok)throw Error(d.error||'Could not load analysis status.');setState(d);setPollError('')}catch(e){if(alive)setPollError((e as Error).message)}};
 void poll();const t=setInterval(poll,5000);try{const raw=localStorage.getItem(`lab-vision-setup:${location.pathname}:${video.name}:${video.size}`);setSaved(raw?JSON.parse(raw):null)}catch{}
 return()=>{alive=false;clearInterval(t)}},[video.id,video.name,video.size])

 async function action(body:unknown){setBusy(true);setError('');try{const r=await fetch('/api/internal/lab-vision/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed.');await refresh();window.dispatchEvent(new Event('lab-vision:jobs-changed'));return d}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function connect(){const d=await action({action:'connect'});if(!d)return;const url=URL.createObjectURL(new Blob([JSON.stringify(d.config,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='lab-vision-worker.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 const job=state?.job,config=setup?.file.name===video.name&&setup?.file.size===video.size?setup:stored??saved??job?.setup,active=job&&['queued','running'].includes(job.status),online=state?.workers?.some((w:any)=>w.online&&(!job?.worker_id||w.id===job.worker_id))
 const view=analysisProgress(job)
 useEffect(()=>{statusCallback.current?.(pollError?'Status unavailable':state?.denied?'Video & analysis':!state?'Checking analysis…':view.pill)},[view.pill,pollError,state?.denied,!!state])
 if(state?.denied)return <p className="va-muted">Analysis controls require administrator access.</p>
 return <section className="va-analysis" aria-label="Local match analysis">
 <div className="va-section va-setup">
 <h3>{config?.confirmed&&<CheckCircle/>}{config?.confirmed?'Setup confirmed':'Confirm match setup'}</h3>
 {config?.confirmed?<><div className="va-players">{players.map(p=><div key={p.id}><img src={p.avatar} alt=""/><span>{p.shortName}</span></div>)}</div><button className="ui-btn" disabled={!!active} onClick={()=>onPrepare(config??null)}>Review court & players</button></>:<><p>Choose the match start, then confirm the court and all four players.</p><button className="ui-btn" onClick={()=>onPrepare(config??null)}>Prepare video</button></>}
 </div>
 <div className="va-section">
 {!active&&<h3>{!state?'Checking analysis…':view.title}</h3>}
 <AnalysisActivity job={job} online={!!online} pollError={!!pollError}/>

 {job?.status==='complete'&&<p>Results are ready{job.result?.viewer?' in the 3D court and Player performance tab':''}.{job.setup?.analysisSeconds<video.duration-5?' This run covers a sample of the video.':''}</p>}
 {job?.download&&<a className="va-download" href={job.download}>Download analysis results</a>}
 {job?.error&&<p role="alert">{job.error}</p>}
 {!active&&state&&<div className="va-run"><label>Analysis length<select aria-label="Analysis length" className="ui-input" value={scope} onChange={e=>setScope(e.target.value)}><option value="sample">First 60 seconds · check setup</option><option value="full">Full match from marked start</option></select></label><button className="ui-btn" data-variant="primary" disabled={busy||!config?.confirmed||!!pollError} onClick={()=>action({action:'run',videoId:video.id,setup:config,scope})}>{job?.status==='complete'?'Run another analysis':'Run analysis locally'}</button></div>}
 </div>
 <div className="va-section va-device"><h3>Local processing <span className="va-connection" data-online={!!online&&!pollError}>{pollError?'Unavailable':!state?'Checking…':online?'Connected':'Offline'}</span></h3><p>{online?'Keep this computer awake while analysis runs.':'Connect the local worker to process this video. Queued jobs wait safely.'}</p>
 <details><summary>Processing settings</summary><p>Download a private connection file and open it with the installed Lab Vision worker.</p><button className="ui-btn" disabled={busy} onClick={connect}>Download connection file</button><div className="va-worker-list">{state?.workers?.map((w:any,i:number)=><div key={w.id}><span>Local worker {i+1} · {w.online?'Connected':'Offline'}</span><button className="ui-btn" disabled={busy} onClick={()=>action({action:'disconnect',workerId:w.id})}>Disconnect</button></div>)}</div></details>
 {active&&<button className="ui-btn va-stop" disabled={busy||!!pollError} onClick={()=>{if(window.confirm('Stop this analysis? The uploaded video will remain available.'))void action({action:'cancel',id:job.id})}}>Stop analysis</button>}
 </div>
 {saveError&&<p role="alert">{saveError}</p>}{pollError&&<p role="alert">Status updates interrupted. Retrying automatically. {pollError}</p>}{error&&<p role="alert">{error}</p>}
 </section>
}
