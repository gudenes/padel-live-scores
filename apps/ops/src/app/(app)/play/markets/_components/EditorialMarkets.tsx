'use client'
import { useEffect, useState } from 'react'
import { Panel, Pill } from '@/components/ui'
import { EDITORIAL_FAMILIES, type EditorialConfig, type EditorialFamily } from '../../../../../../../../shared/play-editorial'
import type { EditorialPreview } from '@/lib/play-editorial-service'
type Draft={id:string;revision:number;status:string;config:EditorialConfig;preview:EditorialPreview|null;preview_token:string|null;preview_expires_at:string|null;market_id:string|null}
type Player={id:string;name:string;category:string;ranking:number}
type Event={id:string;name:string;starts_at:string;ends_at:string}
const initial = ():EditorialConfig=>({family:'round',category:'men',playerIds:[],tournamentIds:[],round:'SF',target:1,minimumStarts:1,startsAt:'',endsAt:'',locksAt:'',voidAfter:'',probability:null,probabilitySource:'',maxLoss:5000})
const input={width:'100%',padding:9,background:'var(--bg-input)',color:'var(--text-1)',border:'1px solid var(--border)',borderRadius:5,font:'inherit'} as const
const field={display:'grid',gap:6,fontSize:12} as const
export default function EditorialMarkets({onPublished}:{onPublished:()=>void}) {
  const [drafts,setDrafts]=useState<Draft[]>([]),[players,setPlayers]=useState<Player[]>([]),[events,setEvents]=useState<Event[]>([])
  const [selected,setSelected]=useState<Draft|null>(null),[config,setConfig]=useState<EditorialConfig>(initial)
  const [publishingEnabled,setPublishingEnabled]=useState(false)
  const [dirty,setDirty]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
  async function load(){const r=await fetch('/api/internal/play-editorial',{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error);setDrafts(d.drafts);setPlayers(d.players);setEvents(d.tournaments);setPublishingEnabled(d.publishingEnabled===true)}
  useEffect(()=>{void load().catch(e=>setError(e.message))},[])
  function change(patch:Partial<EditorialConfig>){setConfig(c=>({...c,...patch}));setDirty(true);setMessage('')}
  function choose(d:Draft|null){setSelected(d);setConfig(d?.config??initial());setDirty(!d);setError('');setMessage('')}
  async function action(action:string){setBusy(true);setError('');setMessage('');try{
    const r=await fetch('/api/internal/play-editorial',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id:selected?.id,revision:selected?.revision,token:selected?.preview_token,config})})
    const d=await r.json();if(!r.ok)throw Error([d.error,...(d.details??[])].join(' '))
    if(d.draft){setSelected(d.draft);setConfig(d.draft.config);setDirty(false)}
    if(d.marketId){setSelected(s=>s?{...s,status:'published',market_id:d.marketId}:s);setMessage('Market published. It is visible through the existing Play whitelist.');onPublished()}
    else setMessage(action==='save'?'Draft saved. No market has been opened.':'Preview refreshed. Review the question, rules, price and deadline below.')
    await load()
  }catch(e){setError(e instanceof Error?e.message:'Operation failed.')}finally{setBusy(false)}}
  const tournament=config.family==='round'||config.family==='other_champion', published=selected?.status==='published'
  const preview=!dirty?selected?.preview:null
  return <Panel>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><h2 style={{margin:0,fontSize:18}}>Create a market</h2><Pill tone="neutral">Saved drafts</Pill></div>
    <p className="hint">Choose a reusable template, bind the players and events, then preview before publishing. All dates below are UTC.</p>
    <label style={field}>Draft<select style={input} disabled={busy} value={selected?.id??''} onChange={e=>choose(drafts.find(d=>d.id===e.target.value)??null)}><option value="">New draft</option>{drafts.map(d=><option key={d.id} value={d.id}>{d.preview?.question.en??`${EDITORIAL_FAMILIES[d.config.family].label} · ${d.id.slice(0,8)}`} · {d.status}</option>)}</select></label>
    <fieldset disabled={busy||published} style={{border:0,padding:0,margin:'16px 0',display:'grid',gap:14}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12}}>
        <label style={field}>Template<select style={input} value={config.family} onChange={e=>change({family:e.target.value as EditorialFamily,playerIds:[],tournamentIds:[],probability:null,probabilitySource:''})}>{Object.entries(EDITORIAL_FAMILIES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></label>
        <label style={field}>Draw<select style={input} value={config.category} onChange={e=>change({category:e.target.value as 'men'|'women',playerIds:[]})}><option value="men">Men</option><option value="women">Women</option></select></label>
        {[0,...(config.family==='ranking'?[]:[1])].map(i=><label key={i} style={field}>Player {i+1}<select style={input} disabled={i===1&&!config.playerIds[0]} value={config.playerIds[i]??''} onChange={e=>{const ids=[...config.playerIds];ids[i]=e.target.value;change({playerIds:ids.filter(Boolean)})}}><option value="">Choose player</option>{players.filter(p=>p.category===config.category).map(p=><option key={p.id} value={p.id}>{p.name} · #{p.ranking}</option>)}</select></label>)}
      </div>
      {config.family!=='ranking'&&<label style={field}>{tournament?'Tournament':'Eligible tournaments (select all that count)'}<select style={input} multiple={!tournament} size={tournament?1:6} value={tournament?config.tournamentIds[0]??'':config.tournamentIds} onChange={e=>{const ids=Array.from(e.target.selectedOptions).map(o=>o.value).filter(Boolean);const ev=events.find(t=>t.id===ids[0]);change({tournamentIds:ids,...(tournament&&ev?{endsAt:ev.ends_at.slice(0,10)+'T23:59:59Z',voidAfter:new Date(Date.parse(ev.ends_at)+8*86400000).toISOString()}: {})})}}>{tournament&&<option value="">Choose event</option>}{events.map(t=><option key={t.id} value={t.id}>{t.name} · {t.starts_at.slice(0,10)}</option>)}</select></label>}
      {config.family==='round'&&<label style={field}>Target round<select style={input} value={config.round} onChange={e=>change({round:e.target.value as 'SF'|'F'})}><option value="SF">Semifinal</option><option value="F">Final</option></select></label>}
      {(config.family==='titles'||config.family==='ranking')&&<label style={field}>{config.family==='titles'?'Titles required':'Official ranking threshold'}<input style={input} type="number" min={1} max={500} value={config.target} onChange={e=>change({target:Number(e.target.value)})}/></label>}
      {config.family==='titles'&&<label style={field}>Minimum events played before settling No<input style={input} type="number" min={1} max={12} value={config.minimumStarts} onChange={e=>change({minimumStarts:Number(e.target.value)})}/></label>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12}}>
        {(tournament?['endsAt','voidAfter'] as const:['startsAt','endsAt','locksAt','voidAfter'] as const).map(k=><label style={field} key={k}>{{startsAt:'Result window starts',endsAt:'Result window ends',locksAt:'Trading closes',voidAfter:'Refund if still unresolved'}[k]} (UTC)<input style={input} type="datetime-local" step={1} value={config[k]?.slice(0,19)??''} onChange={e=>change({[k]:e.target.value?e.target.value+'Z':''})}/></label>)}
      </div>
      {tournament?<p className="hint">Closing time comes from the pair’s next scheduled match. Opening price comes from a recent tournament projection.</p>:<>
        <label style={field}>Opening Yes probability (%)<input style={input} type="number" min={2} max={98} step={.1} value={config.probability===null?'':Math.round(config.probability*1000)/10} onChange={e=>change({probability:e.target.value===''?null:Number(e.target.value)/100})}/></label>
        <label style={field}>Estimate source and reasoning<textarea style={input} value={config.probabilitySource} maxLength={1000} onChange={e=>change({probabilitySource:e.target.value})}/><span>Long-term estimates are explicitly labelled as an estimate, not a live model prediction.</span></label>
      </>}
      <label style={field}>Maximum maker subsidy (Guacas)<input style={input} type="number" min={100} max={50000} value={config.maxLoss} onChange={e=>change({maxLoss:Number(e.target.value)})}/></label>
      <div style={{display:'flex',gap:10}}><button type="button" className="ui-btn" onClick={()=>void action('save')}>Save draft</button><button type="button" className="ui-btn" disabled={dirty||!selected} onClick={()=>void action('preview')}>Preview market</button></div>
    </fieldset>
    {preview&&<section style={{border:'1px solid var(--border)',padding:16,borderRadius:6}}>
      <h3>{preview.question.en}</h3><p>{preview.question.es}</p>
      <p><strong>Yes: {preview.probability===null?'Unavailable':`${(preview.probability*100).toFixed(1)}%`}</strong> · Closes {preview.locksAt||'unavailable'}</p>
      <p className="hint">{preview.priceSource}</p><p style={{fontSize:12,lineHeight:1.7}}>{preview.rules.en}</p><p style={{fontSize:12,lineHeight:1.7}}>{preview.rules.es}</p>
      {preview.errors.length>0?<ul>{preview.errors.map(e=><li key={e}>{e}</li>)}</ul>:<p className="hint">Ready to publish. The preview expires after five minutes; publishing checks the evidence again.</p>}
      {!published&&!publishingEnabled&&<p className="hint">Publishing becomes available after the matching settlement worker is deployed.</p>}
      {!published&&<button type="button" className="ui-btn" disabled={busy||!publishingEnabled||preview.errors.length>0} onClick={()=>void action('publish')}>{busy?'Working…':'Publish market'}</button>}
    </section>}
    {error&&<p role="alert" style={{color:'var(--live-text)'}}>{error}</p>}{message&&<p role="status">{message}</p>}
  </Panel>
}
