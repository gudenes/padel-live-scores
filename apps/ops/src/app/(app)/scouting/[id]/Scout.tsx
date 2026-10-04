'use client'
import {useEffect,useMemo,useRef,useState} from 'react'
import Link from 'next/link'
import {Button,Pill} from '@/components/ui'
import {activeEvents,freshDoc,replay,teamOf,validateDoc,validateSeed,type ScoreSeed,type ScoutDoc,type Event,type Player,type Outcome} from '@/lib/scouting/model'
import {formatDuration,pressure} from '@/lib/scouting/tracking'
import {isStarPoint} from '@/lib/scouting/scoring'
import styles from './scout.module.css'
import Insights from './Insights'
import {sessionExport,pointsCsv,type ScoutPerson} from '@/lib/scouting/export'
type Person=ScoutPerson
type Action=Event extends infer E?E extends Event?Omit<E,'id'|'at'>:never:never
export default function Scout({matchId}:{matchId:string}){
  const [view,setView]=useState<'court'|'insights'>('court')
  const [now,setNow]=useState(()=>Date.now())
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[])
  const [players,setPlayers]=useState<Person[]>([]),[doc,setDoc]=useState<ScoutDoc|null>(null),[setup,setSetup]=useState(freshDoc)
  const [loading,setLoading]=useState(true),[message,setMessage]=useState(''),[sync,setSync]=useState(''),[error,setError]=useState(''),[conflict,setConflict]=useState(false),[smashError,setSmashError]=useState<Player|null>(null)
  const rosterRef=useRef<Person[]>([])
  const current=useRef<ScoutDoc|null>(null),revision=useRef(0),saved=useRef(''),saving=useRef(false),blocked=useRef(false),mounted=useRef(true)
  const key=`pn-scout-v1:${matchId}`
  const [completed,setCompleted]=useState(''),[gamesA,setGamesA]=useState('0'),[gamesB,setGamesB]=useState('0'),[pointsA,setPointsA]=useState('0'),[pointsB,setPointsB]=useState('0'),[returns,setReturns]=useState('0')
  function cache(d:ScoutDoc){try{localStorage.setItem(key,JSON.stringify({revision:revision.current,document:d,players:rosterRef.current}))}catch{setError('Browser storage is unavailable. Keep this page open until the session is saved.')}}
  async function save(){
    if(saving.current||blocked.current||!current.current)return
    saving.current=true
    try{
      while(current.current&&saved.current!==JSON.stringify(current.current)){
        const snapshot=current.current;setSync('Saving…')
        const response=await fetch(`/api/internal/scouting/${matchId}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:revision.current,document:snapshot})})
        const result=await response.json()
        if(!response.ok){if(response.status===409){blocked.current=true;setConflict(true)}throw Error(result.error??'Could not save.')}
        revision.current=result.revision;saved.current=JSON.stringify(snapshot);cache(current.current)
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
      saved.current=remote?JSON.stringify(remote):''
      let chosen=remote
      try{
        const raw=localStorage.getItem(key)
        if(raw){const local=validateDoc(JSON.parse(raw).document)
          if(!remote||JSON.stringify(local)===JSON.stringify(remote))chosen=local
          else if(JSON.stringify({...local,events:[]})===JSON.stringify({...remote,events:[]})&&JSON.stringify(local.events.slice(0,remote.events.length))===JSON.stringify(remote.events))chosen=local
          else if(JSON.stringify({...local,events:[]})===JSON.stringify({...remote,events:[]})&&JSON.stringify(remote.events.slice(0,local.events.length))===JSON.stringify(local.events))chosen=remote
          else{chosen=local;blocked.current=true;setConflict(true);setError('Local and server sessions differ. Download your local copy before loading the server session.')}
        }
      }catch{setError('The local recovery copy could not be read. The saved server session is loaded.')}
      current.current=chosen;setDoc(chosen);setLoading(false);setSync(chosen?'Saved':'')
      if(chosen&&!blocked.current)void save()
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
    const online=()=>void save(),leave=(e:BeforeUnloadEvent)=>{if(current.current&&saved.current!==JSON.stringify(current.current)){e.preventDefault();e.returnValue=''}}
    window.addEventListener('online',online);window.addEventListener('beforeunload',leave)
    return()=>{mounted.current=false;controller.abort();window.removeEventListener('online',online);window.removeEventListener('beforeunload',leave)}
  // Match identity owns the session; refs keep fast consecutive taps ordered.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[matchId])
  function start(){const d=validateDoc(setup);current.current=d;setDoc(d);cache(d);void save()}
  function record(action:Action){
    if(!current.current||blocked.current)return
    const next={...current.current,events:[...current.current.events,{...action,id:crypto.randomUUID(),at:new Date().toISOString()} as Event]}
    try{validateDoc(next);current.current=next;setDoc(next);cache(next);setMessage(action.kind==='point'?`${players[action.player].name}: ${action.smash?'smash ':''}${action.outcome==='winner'?'winner':action.outcome+' error'}`:action.kind==='smash'?`${players[action.player].name}: smash kept in play`:action.kind==='rally_start'?'Rally started':action.kind==='first_fault'?'First serve fault · second serve':action.kind==='double_fault'?'Double fault · point to receiving pair':action.kind==='undo'?'Last action undone':action.kind==='flip'?'Court view flipped':'Updated');void save()}catch(e){setError(e instanceof Error?e.message:'Invalid action.')}
  }
  useEffect(()=>{
    function startRallyShortcut(e:KeyboardEvent){
      if(view!=='court')return
      if(e.code!=='Space'||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||e.isComposing||e.defaultPrevented)return
      const target=e.target
      if(target instanceof HTMLElement&&(target.isContentEditable||target.closest('input,textarea,select,a,summary,[role="textbox"],[role="dialog"],dialog')))return
      if(!current.current)return
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
  function exportSession(){if(current.current)download(JSON.stringify(sessionExport(matchId,players,revision.current,current.current),null,2),'application/json','json')}
  function exportPoints(){if(current.current)download(pointsCsv(players,current.current),'text/csv;charset=utf-8','csv')}

  function loadServer(){localStorage.removeItem(key);window.location.reload()}
  const model=useMemo(()=>doc?replay(doc):null,[doc])
  const clock=model?.tracking
  const elapsed=(at:string|null)=>at?formatDuration((clock?.endedAt?Date.parse(clock.endedAt):now)-Date.parse(at)):'—'
  const situation=model&&model.score.phase!=='finished'?pressure(model.score):null
  const pairName=(team:'a'|'b')=>players.slice(team==='a'?0:2,team==='a'?2:4).map(p=>p.name).join(' / ')
  const result=(p:Player,outcome:Outcome,smash=false)=>{record({kind:'point',player:p,outcome,smash});setSmashError(null)}
  function playerCard(p:Player){
    const s=model!.stats[p],isServer=model!.server===p
    return <article className={`${styles.player} ${isServer&&model!.score.phase!=='finished'?styles.serving:''}`} key={players[p].id} aria-label={players[p].name}>
      <div className={styles.playerHead}><h2>{players[p].name}</h2>{isServer&&model!.score.phase!=='finished'&&<Pill tone="lime">Serving</Pill>}</div>
      {isServer&&model!.score.phase!=='finished'&&<p className={styles.serverTime}>● Serving now · turn {model!.tracking.serviceStartedAt?formatDuration(now-Date.parse(model!.tracking.serviceStartedAt)):'start time unknown'}{model!.tracking.serviceStartedAt&&` · started ${new Date(model!.tracking.serviceStartedAt).toLocaleTimeString()}`}</p>}
      <fieldset className={styles.shotControls} disabled={!model!.tracking.rally}>
      <div className={styles.outcomes}>
        <Button onClick={()=>result(p,'winner')}>Winner</Button><Button onClick={()=>result(p,'unforced')}>Unforced error</Button><Button onClick={()=>result(p,'forced')}>Forced error</Button>
      </div>
      <div className={styles.smashRow}><span>Smash</span><Button size="sm" onClick={()=>record({kind:'smash',player:p})}>In play +1</Button><Button size="sm" onClick={()=>result(p,'winner',true)}>Winner +1</Button><Button size="sm" onClick={()=>setSmashError(smashError===p?null:p)}>Error…</Button></div>
      {smashError===p&&<div className={styles.errorChoice}><span>Smash error:</span><Button size="sm" onClick={()=>result(p,'unforced',true)}>Unforced</Button><Button size="sm" onClick={()=>result(p,'forced',true)}>Forced</Button><Button size="sm" variant="ghost" onClick={()=>setSmashError(null)}>Cancel</Button></div>}
      </fieldset>
      <p className={styles.playerStats}>{s.winners} W · {s.unforced} UE · {s.forced} FE <span>{s.smashWinners}/{s.smashes} smash winners · {s.smashes?Math.round(s.smashWinners/s.smashes*100)+'%':'—'}</span></p>
    </article>
  }
  function half(team:'a'|'b',near:boolean){
    let ps:Player[]=team==='a'?[0,1]:[2,3]
    if(!near)ps.reverse();if(model!.swapped[team])ps.reverse()
    return <div className={styles.half}><div className={styles.pairLabel}><span>Pair {team.toUpperCase()} · {near?'near':'far'} end</span><Button size="sm" variant="ghost" onClick={()=>record({kind:'swap',team})}>Swap left / right</Button></div><div className={styles.players}>{ps.map(playerCard)}</div></div>
  }
  return <div className={styles.page}>
    <header className={styles.header}><div><Link href="/today">← Today</Link><h1>Match scouting</h1><p>Manual observation · best of three sets · separate from the official score</p></div><div className={styles.tools}>{sync&&<Pill tone={sync==='Saved'?'lime':'warn'}>{sync}</Pill>}{doc&&<><Button onClick={exportSession}>Export session (JSON)</Button><Button onClick={exportPoints}>Export points (CSV)</Button></>}</div></header>
    {doc&&<nav className={styles.viewTabs} aria-label="Scouting views"><Button aria-pressed={view==='court'} variant={view==='court'?'primary':'default'} onClick={()=>setView('court')}>Live court{clock?.rally?' · rally active':''}</Button><Button aria-pressed={view==='insights'} variant={view==='insights'?'primary':'default'} onClick={()=>setView('insights')}>Insights</Button></nav>}
    {error&&<div className={styles.notice} role="alert"><p>{error}</p>{conflict?<><Button onClick={exportSession}>Download local copy</Button> <Button onClick={loadServer}>Load server session</Button></>:<Button onClick={()=>doc?void save():window.location.reload()}>Retry</Button>}</div>}
    {view==='insights'&&model&&<Insights model={model} players={players} doc={doc!}/>}
    <div hidden={view==='insights'}>
    {loading?<p>Loading match and saved scouting…</p>:!players.length?<p>Scouting requires four confirmed players.</p>:!doc?<section className={`ui-panel ${styles.setup}`}>
      <h2>Set up the court</h2><p>{pairName('a')} vs {pairName('b')}</p><p>Starts at 0–0. Joining a match already in progress? Start the session, then use Score setup to enter its current score.</p>
      <div className={styles.setupFields}>
        <label>Scoring rule<select className="ui-select" value={setup.rule} onChange={e=>setSetup({...setup,rule:e.target.value as ScoutDoc['rule']})}><option value="star-point">Star Point</option><option value="advantage">Advantage</option><option value="golden-point">Golden Point</option></select></label>
        <label>First server<select className="ui-select" value={setup.firstServer} onChange={e=>{const p=Number(e.target.value) as Player;setSetup({...setup,firstServer:p,otherServer:teamOf(p)==='a'?2:0})}}>{players.map((p,i)=><option key={p.id} value={i}>{p.name}</option>)}</select></label>
        <label>First server for the other pair<select className="ui-select" value={setup.otherServer} onChange={e=>setSetup({...setup,otherServer:Number(e.target.value) as Player})}>{players.map((p,i)=>teamOf(i as Player)!==teamOf(setup.firstServer)&&<option key={p.id} value={i}>{p.name}</option>)}</select></label>
        <label>Pair at the near end<select className="ui-select" value={setup.near} onChange={e=>setSetup({...setup,near:e.target.value as 'a'|'b'})}><option value="a">Pair A · {pairName('a')}</option><option value="b">Pair B · {pairName('b')}</option></select></label>
      </div><Button variant="primary" onClick={start}>Start scouting</Button>
    </section>:model&&<>
      <section className={`ui-panel ${styles.scoreboard}`} aria-label="Scouting scoreboard"><table><thead><tr><th>Pair</th>{model.score.sets.map((_,i)=><th key={i}>Set {i+1}</th>)}<th>Points</th></tr></thead><tbody>{(['a','b'] as const).map(team=><tr key={team}><th>{pairName(team)} {model.score.servingTeam===team&&model.score.phase!=='finished'?'•':''}</th>{model.score.sets.map((set,i)=><td key={i}>{set[team]}</td>)}<td><strong>{model.score.currentGame[team]}</strong></td></tr>)}</tbody></table><div className={styles.scoreMeta}><Pill>{doc.rule.replace('-',' ')}</Pill><span>{model.score.phase==='finished'?`${pairName(model.score.winner!)} wins`:isStarPoint(model.score)?'Star Point':model.score.phase==='tiebreak'?'Tie-break · first to 7, lead by 2':`${players[model.server].name} serving`}</span></div></section>
      <section className={`ui-panel ${styles.timing}`} aria-label="Match timing">
        <div><span>{clock!.scope==='observation'?'Observation time':'Match time'}</span><strong>{elapsed(clock!.startedAt)}</strong><small>{clock!.startedAt?`Started ${new Date(clock!.startedAt).toLocaleTimeString()}`:'Start at the first serve'}</small></div>
        <div><span>Current game</span><strong>{elapsed(clock!.gameStartedAt)}</strong><small>{clock!.gamePartial?'Start missed · duration unknown':clock!.gameStartedAt?'Clock running':'Waiting for first serve'}</small></div>
        <div><span>Breaks · A / B</span><strong>{clock!.pairs.a.breaks} / {clock!.pairs.b.breaks}</strong><small>Observed service breaks</small></div>
        <div><span>Star Points · A / B</span><strong>{clock!.pairs.a.starPointsWon} / {clock!.pairs.b.starPointsWon}</strong><small>Won · {clock!.pairs.a.starPoints} played</small></div>
        <div><span>First server</span><strong className={styles.firstServer}>{players[doc.firstServer].name}</strong><small>Set during match setup</small></div>
      </section>
      {situation&&(situation.breakPoint||situation.star||situation.setPoint.a||situation.setPoint.b)&&<p className={styles.pressure} role="status">{[situation.star?'Star Point':null,situation.breakPoint?`Break point · pair ${situation.breakPoint.toUpperCase()}`:null,...(['a','b'] as const).map(t=>situation.matchPoint[t]?`Match point · pair ${t.toUpperCase()}`:situation.setPoint[t]?`Set point · pair ${t.toUpperCase()}`:null)].filter(Boolean).join(' · ')}</p>}
      <div className={styles.actionBar}><Button disabled={conflict||!activeEvents(doc).length} onClick={()=>{record({kind:'undo'});setSmashError(null)}}>Undo last action</Button><Button disabled={conflict} onClick={()=>record({kind:'flip'})}>Flip court view</Button><label>Server<select className="ui-select" disabled={conflict||!!clock!.rally||model.score.phase==='finished'} value={model.server} onChange={e=>record({kind:'server',player:Number(e.target.value) as Player})}>{players.map((p,i)=><option key={p.id} value={i}>{p.name}</option>)}</select></label><span role="status" className={styles.feedback}>{message}</span></div>
      <section className={`ui-panel ${styles.rallyBar}`} aria-label="Rally and serve controls">
        <div><strong>{clock!.rally?`${players[clock!.rally.server].name} · ${clock!.rally.firstFaultAt?'Second serve':'First serve / rally in progress'}`:`${players[model.server].name} to serve`}</strong><p>{clock!.rally?`Rally elapsed ${formatDuration(now-Date.parse(clock!.rally.startedAt))} · finish using a player’s outcome below`:'Press Space or tap Start rally when the first serve begins. Match and game clocks start automatically.'}</p></div>
        <div className={styles.tools}><Button variant="primary" aria-keyshortcuts="Space" disabled={conflict||!!clock!.rally||model.score.phase==='finished'} onClick={()=>record({kind:'rally_start'})}>{clock!.rally?'Rally in progress':<>Start rally <kbd className={styles.shortcut}>Space</kbd></>}</Button>
        <Button disabled={conflict||!clock!.rally||!!clock!.rally.firstFaultAt} onClick={()=>record({kind:'first_fault'})}>First-serve fault</Button>
        <Button variant="danger" disabled={conflict||!clock!.rally?.firstFaultAt} onClick={()=>{record({kind:'double_fault'});setSmashError(null)}}>Double fault</Button></div>
      </section>
      <fieldset className={styles.court} disabled={conflict||model.score.phase==='finished'} aria-label="Court and player scouting controls">{half(model.near==='a'?'b':'a',false)}<div className={styles.net}><span>NET · ends change automatically</span></div>{half(model.near,true)}</fieldset>
      <p className={styles.hint}>Start each rally, then tap the player who hit the winner or made the error. Smash “In play” counts a returned smash without ending the point. Smash “Winner” or “Error” counts the attempt and ends the point in one action. Don’t also count that same smash as “In play”.</p>
      <details className={`ui-panel ${styles.details}`}><summary>Statistics & point log · {model.points} points observed</summary><p>Smash conversion = direct smash winners ÷ all recorded smash attempts. These are operator observations; {model.unclassified} points have no player attribution.</p><div className={styles.scroll}><table><thead><tr><th>Player</th><th>W</th><th>UE</th><th>FE</th><th>Smashes</th><th>Smash W</th><th>Smash errors</th><th>Conversion</th></tr></thead><tbody>{players.map((p,i)=>{const s=model.stats[i];return <tr key={p.id}><th>{p.name}</th><td>{s.winners}</td><td>{s.unforced}</td><td>{s.forced}</td><td>{s.smashes}</td><td>{s.smashWinners}</td><td>{s.smashErrors}</td><td>{s.smashes?(100*s.smashWinners/s.smashes).toFixed(1)+'%':'—'}</td></tr>})}</tbody></table></div><ol>{activeEvents(doc).slice(-20).reverse().map(e=><li key={e.id}>{new Date(e.at).toLocaleTimeString()} · {e.kind==='point'?`${players[e.player].name} · ${e.smash?'smash ':''}${e.outcome}`:e.kind==='smash'?`${players[e.player].name} · smash returned`:e.kind==='unclassified'?`Unclassified point for pair ${e.team.toUpperCase()}`:e.kind}</li>)}</ol></details>
      <details className={`ui-panel ${styles.details}`}><summary>Serve, pressure points & timing</summary>
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
