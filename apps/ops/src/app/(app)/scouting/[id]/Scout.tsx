'use client'
import {useEffect,useMemo,useRef,useState} from 'react'
import Link from 'next/link'
import {Button,Pill} from '@/components/ui'
import {activeEvents,freshDoc,replay,teamOf,validateDoc,validateSeed,type ScoreSeed,type ScoutDoc,type Event,type Player,type Outcome} from '@/lib/scouting/model'
import {formatDuration,pressure} from '@/lib/scouting/tracking'
import {scoreLabel} from '@/lib/scouting/score-label'
import {isStarPoint} from '@/lib/scouting/scoring'
import styles from './scout.module.css'
import {DEFAULT_METHODOLOGY,type MethodologyId} from '@/lib/scouting/methodology'
import Insights from './Insights'
import ShotPicker,{type ShotDetails} from './ShotPicker'
import {scoutingEventId} from '@/lib/scouting/event-id'
import {historyJson} from '@/lib/scouting/history'
import {sessionExport,pointsCsv,type ScoutPerson} from '@/lib/scouting/export'
type Person=ScoutPerson
type Action=Event extends infer E?E extends Event?Omit<E,'id'|'at'>:never:never
export default function Scout({matchId,landscapeOnly=false}:{matchId:string;landscapeOnly?:boolean}){
  const [methodology,setMethodology]=useState<MethodologyId>(DEFAULT_METHODOLOGY)
  const [chosenOutcome,setChosenOutcome]=useState<Outcome>('winner')
  const [winnerAt,setWinnerAt]=useState<string|null>(null)
  const [focus,setFocus]=useState(true)
  const [extras,setExtras]=useState(false)
  const [menuOpen,setMenuOpen]=useState(false)
  const [setupStep,setSetupStep]=useState<1|2>(1)
  const [view,setView]=useState<'court'|'insights'>('court')
  const [now,setNow]=useState(()=>Date.now())
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[])
  const [players,setPlayers]=useState<Person[]>([]),[doc,setDoc]=useState<ScoutDoc|null>(null),[setup,setSetup]=useState(freshDoc)
  const [loading,setLoading]=useState(true),[message,setMessage]=useState(''),[sync,setSync]=useState(''),[error,setError]=useState(''),[conflict,setConflict]=useState(false),[winnerChoice,setWinnerChoice]=useState<Player|null>(null)
  const rosterRef=useRef<Person[]>([])
  const current=useRef<ScoutDoc|null>(null),revision=useRef(0),saved=useRef(''),saving=useRef(false),blocked=useRef(false),mounted=useRef(true)
  const key=`pn-scout-v1:${matchId}`
  const [completed,setCompleted]=useState(''),[gamesA,setGamesA]=useState('0'),[gamesB,setGamesB]=useState('0'),[pointsA,setPointsA]=useState('0'),[pointsB,setPointsB]=useState('0'),[returns,setReturns]=useState('0')
  function cache(d:ScoutDoc){try{localStorage.setItem(key,JSON.stringify({revision:revision.current,document:d,players:rosterRef.current}))}catch{setError('Browser storage is unavailable. Keep this page open until the session is saved.')}}
  async function save(){
    if(saving.current||blocked.current||!current.current)return
    saving.current=true
    try{
      while(current.current&&saved.current!==historyJson(current.current)){
        const snapshot=current.current;setSync('Saving…')
        const response=await fetch(`/api/internal/scouting/${matchId}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:revision.current,document:snapshot})})
        const result=await response.json()
        if(!response.ok){if(response.status===409){blocked.current=true;setConflict(true)}throw Error(result.error??'Could not save.')}
        revision.current=result.revision;saved.current=historyJson(snapshot);cache(current.current)
      }
      if(mounted.current){setSync('Saved');setError('')}
    }catch(e){if(mounted.current){setSync('Not synced');setError(e instanceof Error?e.message:'Connection lost. Local copy retained; retry when online.')}}
    finally{saving.current=false}
  }
  useEffect(()=>{
    mounted.current=true
    const controller=new AbortController()
    fetch(`/api/internal/scouting/${matchId}`,{cache:'no-store',signal:controller.signal}).then(async r=>{const j=await r.json();if(!r.ok)throw Error(j.error);return j}).then(data=>{
      if(controller.signal.aborted)return
      rosterRef.current=data.players;setPlayers(data.players);revision.current=data.session?.revision??0
      const remote=data.session?.document as ScoutDoc|null
      saved.current=remote?historyJson(remote):''
      let chosen=remote,localReadable=true
      try{
        const raw=localStorage.getItem(key)
        if(raw){const local=validateDoc(JSON.parse(raw).document)
          if(!remote||historyJson(local)===historyJson(remote))chosen=local
          else if(historyJson({...local,events:[]})===historyJson({...remote,events:[]})&&historyJson(local.events.slice(0,remote.events.length))===historyJson(remote.events))chosen=local
          else if(historyJson({...local,events:[]})===historyJson({...remote,events:[]})&&historyJson(remote.events.slice(0,local.events.length))===historyJson(local.events))chosen=remote
          else{chosen=local;blocked.current=true;setConflict(true);setError('Local and server sessions differ. Download your local copy before loading the server session.')}
        }
      }catch{localReadable=false;setError('The local recovery copy could not be read. The saved server session is loaded.')}
      current.current=chosen;setDoc(chosen);setLoading(false);setSync(chosen?'Saved':'')
      if(chosen&&!blocked.current){if(localReadable)cache(chosen);void save()}
    }).catch(e=>{if(!controller.signal.aborted){
      try{
        const raw=localStorage.getItem(key),local=raw?JSON.parse(raw):null
        if(local&&Array.isArray(local.players)&&local.players.length===4&&local.players.every((p:Person)=>typeof p.id==='string'&&typeof p.name==='string')&&Number.isInteger(local.revision)){
          const recovered=validateDoc(local.document)
          rosterRef.current=local.players;setPlayers(local.players);revision.current=local.revision;current.current=recovered;setDoc(recovered);setSync('Not synced')
          setError('Working from your local recovery copy. Reconnect and retry to sync this session.');setLoading(false);return
        }
      }catch{/* Leave an unreadable copy untouched for recovery. */}
      setError(e.message);setLoading(false)
    }})
    const online=()=>void save(),leave=(e:BeforeUnloadEvent)=>{if(current.current&&saved.current!==historyJson(current.current)){e.preventDefault();e.returnValue=''}}
    window.addEventListener('online',online);window.addEventListener('beforeunload',leave)
    return()=>{mounted.current=false;controller.abort();window.removeEventListener('online',online);window.removeEventListener('beforeunload',leave)}
  // Match identity owns the session; refs keep fast consecutive taps ordered.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[matchId])
  function start(){record({kind:'court_setup',settings:{rule:setup.rule,firstServer:setup.firstServer,otherServer:setup.otherServer,near:setup.near}})}
  function record(action:Action,at=new Date().toISOString()){
    if(blocked.current)return
    const base=current.current??{...freshDoc(),preparation:true as const}
    const next={...base,events:[...base.events,{...action,id:scoutingEventId(),at} as Event]}
    try{validateDoc(next);current.current=next;setDoc(next);cache(next);setMessage(action.kind==='point'?`${players[action.player].name}: ${action.smash?'smash ':''}${action.outcome==='winner'?'winner':action.outcome+' error'}`:action.kind==='smash'?`${players[action.player].name}: smash attempt counted`:action.kind==='rally_start'?'Rally started':action.kind==='first_fault'?'First serve fault · second serve':action.kind==='double_fault'?'Double fault · point to receiving pair':action.kind==='server'?`Server changed to ${players[action.player].name}${model?.tracking.rally?' · current rally kept':''}`:action.kind==='undo'?'Last action undone':action.kind==='flip'?'Court view flipped':'Updated');void save()}catch(e){setError(e instanceof Error?e.message:'Invalid action.')}
  }
  useEffect(()=>{
    function startRallyShortcut(e:KeyboardEvent){
      if(view!=='court'||winnerChoice!==null)return
      if(landscapeOnly&&window.matchMedia?.('(max-width: 700px) and (orientation: portrait)').matches)return
      if(e.code!=='Space'||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||e.isComposing||e.defaultPrevented)return
      const target=e.target
      if(target instanceof HTMLElement&&(target.isContentEditable||target.closest('input,textarea,select,a,summary,[role="textbox"],[role="dialog"],dialog')))return
      if(!current.current||!replay(current.current).ready)return
      // Override Space on focused outcome buttons too, so it cannot record a
      // second outcome or fault. Enter retains normal button activation.
      e.preventDefault();e.stopPropagation()
      if(e.repeat||blocked.current)return
      const latest=replay(current.current)
      if(!latest.tracking.rally&&latest.score.phase!=='finished')record({kind:'rally_start'})
    }
    window.addEventListener('keydown',startRallyShortcut,true)
    return()=>window.removeEventListener('keydown',startRallyShortcut,true)
  })
  function download(data:string,type:string,extension:string){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=`scouting-${matchId}.${extension}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  function exportSession(){if(current.current)download(JSON.stringify(sessionExport(matchId,players,revision.current,current.current,methodology),null,2),'application/json','json')}
  function exportPoints(){if(current.current)download(pointsCsv(players,current.current),'text/csv;charset=utf-8','csv')}

  function loadServer(){localStorage.removeItem(key);window.location.reload()}
  const model=useMemo(()=>doc?replay(doc):null,[doc])
  const clock=model?.tracking
  const elapsed=(at:string|null)=>at?formatDuration((clock?.endedAt?Date.parse(clock.endedAt):now)-Date.parse(at)):'—'
  const situation=model&&model.score.phase!=='finished'?pressure(model.score):null
  const pairName=(team:'a'|'b')=>players.slice(team==='a'?0:2,team==='a'?2:4).map(p=>p.name).join(' / ')
function chooseOutcome(p:Player,outcome:Outcome){setWinnerChoice(p);setChosenOutcome(outcome);setWinnerAt(new Date().toISOString())}
  function finishPoint(details:ShotDetails){if(winnerChoice===null)return;record({kind:'point',player:winnerChoice,outcome:chosenOutcome,smash:details.shot==='smash',...details},winnerAt??undefined);setWinnerChoice(null)}
  const rallyEvents=doc?activeEvents(doc):[]
  const latestAttempt=winnerChoice===null?undefined:rallyEvents.slice(rallyEvents.findLastIndex(e=>e.kind==='rally_start')+1).findLast(e=>e.kind==='smash'&&e.player===winnerChoice)
  const shortName=(name:string)=>name.split(' ').slice(-1)[0]
  function playerCard(p:Player){
    const s=model!.stats[p],isServer=model!.server===p
    return <article className={`${styles.player} ${isServer&&model!.score.phase!=='finished'?styles.serving:''}`} key={players[p].id} aria-label={players[p].name}>
      <div className={styles.playerHead}><h2 title={players[p].name}><span className={styles.desktopLabel}>{players[p].name}</span><span className={styles.mobileLabel}>{shortName(players[p].name)}</span></h2>{isServer&&model!.score.phase!=='finished'&&<Pill tone="lime">Serving</Pill>}{!isServer&&model!.score.phase!=='finished'&&<Button className={styles.serverCorrection} size="sm" disabled={conflict} aria-label={`Set ${players[p].name} as server`} onClick={()=>record({kind:'server',player:p})}><span className={styles.desktopLabel}>Set as server</span><span className={styles.mobileLabel}>Serve</span></Button>}</div>
      {isServer&&model!.score.phase!=='finished'&&<p className={styles.serverTime}>● Serving now · turn {model!.tracking.serviceStartedAt?formatDuration(now-Date.parse(model!.tracking.serviceStartedAt)):'start time unknown'}{model!.tracking.serviceStartedAt&&` · started ${new Date(model!.tracking.serviceStartedAt).toLocaleTimeString()}`}</p>}
      <fieldset className={styles.shotControls} disabled={!model!.tracking.rally}>
      <div className={styles.outcomes}>
        <Button variant="primary" aria-expanded={winnerChoice===p} onClick={()=>chooseOutcome(p,'winner')}>Winner</Button><Button onClick={()=>chooseOutcome(p,'unforced')} aria-label="Unforced error"><span className={styles.desktopLabel}>Unforced error</span><span className={styles.mobileLabel}>Unforced</span><span className={styles.compactLabel}>UE</span></Button><Button onClick={()=>chooseOutcome(p,'forced')} aria-label="Forced error"><span className={styles.desktopLabel}>Forced error</span><span className={styles.mobileLabel}>Forced</span><span className={styles.compactLabel}>FE</span></Button>
      </div>
      <div className={styles.smashLabel}><span>Smashes</span><span>{s.smashWinners}/{s.smashes} winners</span></div>
      <div className={styles.attemptRow}><Button aria-label={`Smash attempt for ${players[p].name}`} onClick={()=>record({kind:'smash',player:p})}>Smash attempt +1</Button></div>
      </fieldset>
      <p className={styles.playerStats}>{s.winners} W · {s.unforced} UE · {s.forced} FE <span>{s.smashWinners}/{s.smashes} smash winners · {s.smashes?Math.round(s.smashWinners/s.smashes*100)+'%':'—'}</span></p>
    </article>
  }
  function half(team:'a'|'b',near:boolean){
    let ps:Player[]=team==='a'?[0,1]:[2,3]
    if(!near)ps.reverse();if(model!.swapped[team])ps.reverse()
    return <div className={styles.half}><div className={styles.pairLabel}><span>Pair {team.toUpperCase()} · {near?'near':'far'}</span></div><div className={styles.players}>{ps.map(playerCard)}</div></div>
  }
  return <div className={styles.page} data-scout-focus={!!model?.ready&&focus} data-scout-ready={!!model?.ready} data-landscape-only={landscapeOnly} data-extra-tools={extras}>
    {winnerChoice!==null&&<ShotPicker key={`${winnerChoice}-${chosenOutcome}`} name={players[winnerChoice].name} partner={players[winnerChoice^1].name} partnerId={(winnerChoice^1) as Player} outcome={chosenOutcome} attemptId={latestAttempt?.id} disabled={conflict||!clock?.rally} onCancel={()=>setWinnerChoice(null)} onConfirm={finishPoint}/>}
    {landscapeOnly&&<div className={styles.rotatePrompt} role="status"><span aria-hidden="true">↻</span><h2>Rotate your phone</h2><p>Landscape keeps the scoreboard and all four players together.</p><p>Your session stays open while you rotate.</p><Link href="/today">← Today</Link></div>}
    {(!model?.ready||view!=='court')&&<header className={styles.header}>
      <div className={styles.heading}><Link href="/today">← Today</Link><h1>Match scouting</h1>{sync&&<Pill tone={sync==='Saved'?'lime':'warn'}>{sync}</Pill>}</div>
      <div className={styles.tools}>
        {model?.ready&&<nav className={styles.viewTabs} aria-label="Scouting views"><Button size="sm" aria-pressed={view==='court'} variant={view==='court'?'primary':'default'} onClick={()=>setView('court')}>Live court</Button><Button size="sm" aria-pressed={view==='insights'} variant={view==='insights'?'primary':'default'} onClick={()=>setView('insights')}>Insights</Button></nav>}
        {model?.ready&&view==='court'&&<Button size="sm" variant="ghost" onClick={()=>setFocus(!focus)}>{focus?'Show admin':'Focus court'}</Button>}
        {doc&&view==='insights'&&<><Button onClick={exportSession}>Export session (JSON)</Button><Button onClick={exportPoints}>Export points (CSV)</Button></>}
      </div>
    </header>}
    {error&&<div className={styles.notice} role="alert"><p>{error}</p>{conflict?<><Button onClick={exportSession}>Download local copy</Button> <Button onClick={loadServer}>Load server session</Button></>:<Button onClick={()=>doc?void save():window.location.reload()}>Retry</Button>}</div>}
    {view==='insights'&&model&&<Insights model={model} players={players} doc={doc!} methodology={methodology} onMethodologyChange={setMethodology}/>}
    <div hidden={view==='insights'}>
    {loading?<p>Loading match and saved scouting…</p>:!players.length?<p>Scouting requires four confirmed players.</p>:!model?.ready?<section className={`ui-panel ${styles.setup}`}>
      <p className={styles.steps}>1 · Pairs on court <span>→</span> 2 · Servers & positions</p>
      {setupStep===1?<>
        <h2>1. Pairs on court</h2><p>Mark each pair as they arrive. Arrival times are saved separately from the first serve.</p>
        <div className={styles.arrivalCards}>{(['a','b'] as const).map(team=><article className={styles.player} key={team}>
          <Pill tone={model?.arrivals[team]?'lime':'neutral'}>{model?.arrivals[team]?'On court':'Waiting for pair'}</Pill>
          <h3>Pair {team.toUpperCase()}</h3><p>{pairName(team)}</p>
          {model?.arrivals[team]?<><p>Arrived at {new Date(model.arrivals[team]!).toLocaleTimeString()}</p><Button size="sm" variant="ghost" disabled={blocked.current||activeEvents(doc!).at(-1)?.kind!=='pair_arrived'||(activeEvents(doc!).at(-1) as {team?:string})?.team!==team} onClick={()=>record({kind:'undo'})}>Undo arrival</Button></>:<Button disabled={blocked.current} onClick={()=>record({kind:'pair_arrived',team})}>Mark pair {team.toUpperCase()} on court</Button>}
        </article>)}</div>
        <Button variant="primary" disabled={!model?.arrivals.a||!model?.arrivals.b||blocked.current} onClick={()=>setSetupStep(2)}>Next: servers & positions</Button>
      </>:<>
      <Button variant="ghost" size="sm" onClick={()=>setSetupStep(1)}>← Pairs on court</Button>
      <h2>2. Servers & positions</h2><p>{pairName('a')} vs {pairName('b')}</p><p>Starts at 0–0. Joining a match already in progress? Start the session, then use Score setup to enter its current score.</p>
      <div className={styles.setupFields}>
        <label>Scoring rule<select className="ui-select" value={setup.rule} onChange={e=>setSetup({...setup,rule:e.target.value as ScoutDoc['rule']})}><option value="star-point">Star Point</option><option value="advantage">Advantage</option><option value="golden-point">Golden Point</option></select></label>
        <label>First server<select className="ui-select" value={setup.firstServer} onChange={e=>{const p=Number(e.target.value) as Player;setSetup({...setup,firstServer:p,otherServer:teamOf(p)==='a'?2:0})}}>{players.map((p,i)=><option key={p.id} value={i}>{p.name}</option>)}</select></label>
        <label>First server for the other pair<select className="ui-select" value={setup.otherServer} onChange={e=>setSetup({...setup,otherServer:Number(e.target.value) as Player})}>{players.map((p,i)=>teamOf(i as Player)!==teamOf(setup.firstServer)&&<option key={p.id} value={i}>{p.name}</option>)}</select></label>
        <label>Pair at the near end<select className="ui-select" value={setup.near} onChange={e=>setSetup({...setup,near:e.target.value as 'a'|'b'})}><option value="a">Pair A · {pairName('a')}</option><option value="b">Pair B · {pairName('b')}</option></select></label>
      </div><p>The match clock starts when you start the first rally (Space).</p><Button variant="primary" disabled={blocked.current} onClick={start}>Confirm court & start scouting</Button></>}
    </section>:model&&<>
      <div className={styles.liveHud}>
      <section className={`ui-panel ${styles.scoreboard}`} aria-label="Scouting scoreboard"><table><thead><tr><th>Pair</th>{model.score.sets.map((_,i)=><th key={i}>Set {i+1}</th>)}<th>Points</th></tr></thead><tbody>{(['a','b'] as const).map(team=><tr key={team}><th><span className={styles.desktopLabel}>{pairName(team)}</span><span className={styles.mobileLabel}>{players.slice(team==='a'?0:2,team==='a'?2:4).map(p=>shortName(p.name)).join(' / ')}</span> {model.score.servingTeam===team&&model.score.phase!=='finished'?'•':''}</th>{model.score.sets.map((set,i)=><td key={i}>{set[team]}</td>)}<td><strong>{scoreLabel(model.score,team)}</strong></td></tr>)}</tbody></table><div className={styles.scoreMeta}><span>Match <b>{elapsed(clock!.startedAt)}</b> · Game <b>{elapsed(clock!.gameStartedAt)}</b></span><Pill>{model.settings.rule.replace('-',' ')}</Pill><span>{model.score.phase==='finished'?`${pairName(model.score.winner!)} wins`:isStarPoint(model.score)?'Star Point':model.score.phase==='tiebreak'?'Tie-break · first to 7, lead by 2':`${players[model.server].name} serving`}</span></div></section>
      {situation&&(situation.breakPoint||situation.star||situation.setPoint.a||situation.setPoint.b)&&<p className={styles.pressure} role="status">{[situation.star?'Star Point':null,situation.breakPoint?`Break point · pair ${situation.breakPoint.toUpperCase()}`:null,...(['a','b'] as const).map(t=>situation.matchPoint[t]?`Match point · pair ${t.toUpperCase()}`:situation.setPoint[t]?`Set point · pair ${t.toUpperCase()}`:null)].filter(Boolean).join(' · ')}</p>}
      <div className={styles.actionBar}>
        <div className={styles.scoutMenu} onKeyDown={e=>{if(e.key==='Escape'){setMenuOpen(false);e.currentTarget.querySelector<HTMLButtonElement>('button')?.focus()}}}>
          <Button variant="ghost" aria-label="Scouting menu" aria-expanded={menuOpen} aria-controls="scouting-menu-panel" onClick={()=>setMenuOpen(!menuOpen)}>☰</Button>
          {menuOpen&&<div id="scouting-menu-panel" className={styles.menuPanel}>
            <strong>Scouting menu</strong><Link href="/today">← Today</Link>
            <Button onClick={()=>{setView('insights');setMenuOpen(false)}}>Insights</Button>
            <Button variant="ghost" onClick={()=>setFocus(!focus)}>{focus?'Show admin':'Focus court'}</Button>
            <Button disabled={conflict} onClick={()=>record({kind:'flip'})}>Flip court view</Button>
            <label>Server<select className="ui-select" disabled={conflict||model.score.phase==='finished'} value={model.server} onChange={e=>record({kind:'server',player:Number(e.target.value) as Player})}>{players.map((p,i)=><option key={p.id} value={i}>{p.name}</option>)}</select></label>
            {(['a','b'] as const).map(team=><Button key={team} disabled={conflict||model.score.phase==='finished'} onClick={()=>record({kind:'swap',team})}>Swap pair {team.toUpperCase()} left / right</Button>)}
            <Button aria-expanded={extras} onClick={()=>{setExtras(!extras);setMenuOpen(false)}}>{extras?'Hide':'Show'} statistics & score tools</Button>
            <Button onClick={exportSession}>Export session (JSON)</Button><Button onClick={exportPoints}>Export points (CSV)</Button>
          </div>}
        </div>
        <Button size="sm" disabled={conflict||!activeEvents(doc!).length} onClick={()=>{record({kind:'undo'});setWinnerChoice(null)}}>Undo last action</Button>
        {sync&&view==='court'&&<Pill tone={sync==='Saved'?'lime':'warn'}>{sync}</Pill>}
        <span role="status" className={styles.feedback}>{message||(clock!.rally?'Select the player’s outcome':'Ready for the next rally')}</span>
      </div>
      <section className={`ui-panel ${styles.rallyBar}`} aria-label="Rally and serve controls" data-rally-active={!!clock!.rally}>
        <div><strong>{clock!.rally?`${players[clock!.rally.server].name} · ${clock!.rally.firstFaultAt?'Second serve':'Rally in progress'}`:`${players[model.server].name} to serve`}</strong><p>{clock!.rally?`Rally ${formatDuration(now-Date.parse(clock!.rally.startedAt))} · tap an outcome below`:'Start at the first serve · Space on keyboard'}</p></div>
        <div className={styles.tools}>{!clock!.rally&&<Button variant="primary" aria-keyshortcuts="Space" disabled={conflict||model.score.phase==='finished'} onClick={()=>record({kind:'rally_start'})}>Start rally <kbd className={styles.shortcut}>Space</kbd></Button>}

        <Button disabled={conflict||!clock!.rally||!!clock!.rally.firstFaultAt} onClick={()=>record({kind:'first_fault'})}>First-serve fault</Button>
        <Button variant="danger" disabled={conflict||!clock!.rally?.firstFaultAt} onClick={()=>{record({kind:'double_fault'});setWinnerChoice(null)}}>Double fault</Button></div>
      </section>
      </div>
      <fieldset className={styles.court} disabled={conflict||model.score.phase==='finished'} aria-label="Court and player scouting controls">{half(model.near==='a'?'b':'a',false)}<div className={styles.net}><span>NET · ends change automatically</span></div>{half(model.near,true)}</fieldset>
      <details className={styles.help}><summary>How to scout · controls & shortcuts</summary><p className={styles.hint}>Use “Set as server” on a player to correct the current server, even during a rally. Earlier points stay unchanged. Start each rally, then tap the player who hit the winner or made the error. Count each smash with “Smash attempt +1”. Tap Winner or an error, choose the finishing shot and save. Winners can include a teammate assist and an outside-court recovery tag. A finishing smash adds its attempt automatically; if already counted, select “Smash already counted”. Other attempts earlier in the rally still count separately.</p></details>
      <details className={`ui-panel ${styles.details}`}><summary>Statistics & point log · {model.points} points observed</summary><p>Smash conversion = direct smash winners ÷ all recorded smash attempts. These are operator observations; {model.unclassified} points have no player attribution.</p><div className={styles.scroll}><table><thead><tr><th>Player</th><th>W</th><th>UE</th><th>FE</th><th>Smashes</th><th>Smash W</th><th>Smash errors</th><th>Conversion</th></tr></thead><tbody>{players.map((p,i)=>{const s=model.stats[i];return <tr key={p.id}><th>{p.name}</th><td>{s.winners}</td><td>{s.unforced}</td><td>{s.forced}</td><td>{s.smashes}</td><td>{s.smashWinners}</td><td>{s.smashErrors}</td><td>{s.smashes?(100*s.smashWinners/s.smashes).toFixed(1)+'%':'—'}</td></tr>})}</tbody></table></div><ol>{activeEvents(doc!).slice(-20).reverse().map(e=><li key={e.id}>{new Date(e.at).toLocaleTimeString()} · {e.kind==='point'?`${players[e.player].name} · ${e.smash?'smash ':''}${e.outcome}`:e.kind==='smash'?`${players[e.player].name} · smash attempt`:e.kind==='unclassified'?`Unclassified point for pair ${e.team.toUpperCase()}`:e.kind}</li>)}</ol></details>
      <details className={`ui-panel ${styles.details}`}><summary>Serve, pressure points & timing</summary>      <section className={`ui-panel ${styles.timing}`} aria-label="Match timing">
        <div><span>{clock!.scope==='observation'?'Observation time':'Match time'}</span><strong>{elapsed(clock!.startedAt)}</strong><small>{clock!.startedAt?`Started ${new Date(clock!.startedAt).toLocaleTimeString()}`:'Start at the first serve'}</small></div>
        <div><span>Current game</span><strong>{elapsed(clock!.gameStartedAt)}</strong><small>{clock!.gamePartial?'Start missed · duration unknown':clock!.gameStartedAt?'Clock running':'Waiting for first serve'}</small></div>
        <div><span>Breaks · A / B</span><strong>{clock!.pairs.a.breaks} / {clock!.pairs.b.breaks}</strong><small>Observed service breaks</small></div>
        <div><span>Star Points · A / B</span><strong>{clock!.pairs.a.starPointsWon} / {clock!.pairs.b.starPointsWon}</strong><small>Won · {clock!.pairs.a.starPoints} played</small></div>
        <div><span>First server</span><strong className={styles.firstServer}>{players[model.settings.firstServer].name}</strong><small>Set during match setup</small></div>
      </section>

        <p>Observed points only. Break points count each receiving opportunity, including repeat deuces. Tie-breaks do not count as service breaks. Start rally starts the match, game and service-turn clocks as needed. Rally time runs from the first serve through point completion, including the wait for a second serve; it is not ball-in-play time. Timers include pauses. Earlier observations without rally starts have no rally duration.</p>
        <div className={styles.scroll}><table><thead><tr><th>Pair</th><th>Breaks / chances</th><th>Break points saved</th><th>Holds</th><th>Star Points won</th><th>Set points won</th><th>Match points won</th></tr></thead><tbody>{(['a','b'] as const).map(t=>{const s=clock!.pairs[t];return <tr key={t}><th>Pair {t.toUpperCase()}</th><td>{s.breaks} / {s.breakPoints}</td><td>{s.breakPointsSaved} / {s.breakPointsFaced}</td><td>{s.holds}</td><td>{s.starPointsWon} / {s.starPoints}</td><td>{s.setPointsWon} / {s.setPoints}</td><td>{s.matchPointsWon} / {s.matchPoints}</td></tr>})}</tbody></table></div>
        <div className={styles.scroll}><table><thead><tr><th>Server</th><th>Service points won</th><th>Win rate</th><th>First faults</th><th>Double faults</th></tr></thead><tbody>{players.map((p,i)=>{const s=clock!.service[i];return <tr key={p.id}><th>{p.name}</th><td>{s.won} / {s.points}</td><td>{s.points?Math.round(100*s.won/s.points)+'%':'—'}</td><td>{s.firstFaults}</td><td>{s.doubleFaults}</td></tr>})}</tbody></table></div>
        <h3>Completed rallies · {clock!.rallies.length}</h3><p>Double faults are listed separately from unforced errors to avoid counting them twice. First-fault totals below update when the point ends.</p>
        {clock!.rallies.length>0&&<div className={styles.scroll}><table><thead><tr><th>Server</th><th>Start</th><th>Duration</th><th>Serve</th><th>Outcome</th></tr></thead><tbody>{clock!.rallies.slice(-20).reverse().map((r,i)=><tr key={i}><th>{players[r.server].name}</th><td>{new Date(r.startedAt).toLocaleTimeString()}</td><td>{formatDuration(r.durationMs)}</td><td>{r.firstFaultAt?'Second':'First'}</td><td>{r.doubleFault?'Double fault · ':''}Pair {r.winner.toUpperCase()} wins</td></tr>)}</tbody></table></div>}
        <h3>Completed games</h3><p>Missing starts and partially observed games have no full duration. Score corrections begin a new timing segment; they do not reconstruct earlier play.</p>
        {clock!.games.length?<div className={styles.scroll}><table><thead><tr><th>Set / game</th><th>Server</th><th>Started</th><th>Ended</th><th>Duration</th><th>Won by</th></tr></thead><tbody>{clock!.games.map((g,i)=><tr key={i}><td>{g.set} / {g.game}{g.tieBreak?' · tie-break':''}</td><td>{g.server===null?'Rotating':players[g.server].name}</td><td>{g.startedAt?new Date(g.startedAt).toLocaleTimeString():'Unknown'}</td><td>{new Date(g.endedAt).toLocaleTimeString()}</td><td>{formatDuration(g.durationMs)}{g.partial?' · partial':''}</td><td>Pair {g.winner.toUpperCase()}</td></tr>)}</tbody></table></div>:<p>No completed games observed yet.</p>}
      </details>
      <details className={`ui-panel ${styles.details}`}><summary>Score setup / missed point</summary>
        <p>Joining part-way through or correcting the scoreboard? Enter the score before the next point. Existing observations stay in the statistics; earlier play is not invented.</p>
        <div className={styles.setupFields}>
          <label>Completed sets (A-B, comma separated)<input className="ui-select" placeholder="6-4, 4-6" value={completed} onChange={e=>setCompleted(e.target.value)}/></label>
          <label>Current games · pair A<input className="ui-select" type="number" min="0" max="6" value={gamesA} onChange={e=>setGamesA(e.target.value)}/></label>
          <label>Current games · pair B<input className="ui-select" type="number" min="0" max="6" value={gamesB} onChange={e=>setGamesB(e.target.value)}/></label>
          <label>Points · pair A<input className="ui-select" value={pointsA} onChange={e=>setPointsA(e.target.value)}/></label>
          <label>Points · pair B<input className="ui-select" value={pointsB} onChange={e=>setPointsB(e.target.value)}/></label>
          <label>Star Point · lost advantages in this game<select className="ui-select" value={returns} onChange={e=>setReturns(e.target.value)}><option value="0">0</option><option value="1">1</option><option value="2">2 · next deuce is Star Point</option></select></label>
        </div><p>Use 0 / 15 / 30 / 40 / Adv, or tie-break point numbers at 6–6. Set the server and camera orientation above to match what you see.</p>
        <Button disabled={conflict||!!clock!.rally} onClick={()=>{try{
          const sets=completed.trim()?completed.split(',').map(s=>{if(!/^\s*\d+\s*-\s*\d+\s*$/.test(s))throw Error('Use completed sets like 6-4, 4-6.');const [a,b]=s.trim().split('-').map(Number);return {a,b}}):[]
          sets.push({a:Number(gamesA),b:Number(gamesB)})
          const point=(s:string)=>s.trim().toLowerCase()==='adv'?'Adv' as const:Number(s)
          const seed:ScoreSeed={sets,game:{a:point(pointsA),b:point(pointsB)},phase:Number(gamesA)===6&&Number(gamesB)===6?'tiebreak':'playing',returns:Number(returns),server:model.server}
          validateSeed(seed);record({kind:'score',seed})
        }catch(e){setError(e instanceof Error?e.message:'Invalid score.')}}}>Apply scoreboard correction</Button><p>Add points without guessing who hit the final shot. These advance the scoreboard but are excluded from player and smash statistics.</p><Button disabled={conflict||model.score.phase==='finished'} onClick={()=>record({kind:'unclassified',team:'a'})}>Point for pair A</Button> <Button disabled={conflict||model.score.phase==='finished'} onClick={()=>record({kind:'unclassified',team:'b'})}>Point for pair B</Button></details>
    </>}
    </div>
  </div>
}
