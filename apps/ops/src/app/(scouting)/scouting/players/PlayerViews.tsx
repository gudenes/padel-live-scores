'use client'
import {parseDirectorySort,sortColumns} from '@/lib/scouting/intelligence/directory-sort'
import {useEffect,useState,useRef,useCallback} from 'react'
import Link from 'next/link'
import type {AccountPlayerView} from '@/lib/scouting/intelligence/account-player-views'
import BrandedSelect from './BrandedSelect'
import {birthFieldOptions} from '@/lib/scouting/intelligence/birthplace-fields'
import {fieldOperators,operators,parsePlayerRules,viewFields,type PlayerRules,type ViewField,type ViewRule} from '@/lib/scouting/intelligence/player-views'
import {defaultSearch,readSavedView,savedViewChanges,sameSearch,serializeRules,type SavedPlayerView,type SavedSearch} from '@/lib/scouting/intelligence/saved-player-views'
import styles from './player-views.module.css'
const blankRule = (): ViewRule => ({field:'birth_region',operator:'is',value:''})
export default function PlayerViews({userId,active,activeId,search,onNavigate}: {userId:string;active:string;activeId:string;search:SavedSearch;onNavigate:(changes:Record<string,string|null>)=>void}) {
  const key='pn-admin-player-views:'+userId
  const [views,setViews]=useState<AccountPlayerView[]>([])
  const [editing,setEditing]=useState(false),[id,setId]=useState(''),[name,setName]=useState('')
  const [draft,setDraft]=useState<PlayerRules>({match:'all',rules:[]})
  const [message,setMessage]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0),[revision,setRevision]=useState(0)
  const writing=useRef(false)
  const request=useCallback(async(body?:unknown)=>{
    const response=await fetch('/api/internal/player-views',{method:body?'POST':'GET',cache:'no-store',headers:{'x-view-account':userId,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined})
    const result=await response.json()
    if(!response.ok)throw Error(result.error??'Could not sync your views. Please retry.')
    return result.views as AccountPlayerView[]
  },[userId])
  useEffect(()=>{
    let cancelled=false
    async function load(){
      try{
        let remote=await request()
        let warning=''
        // Retain legacy data until the server acknowledges an idempotent import.
        try{
          const raw=localStorage.getItem(key)
          if(raw){
            const local=JSON.parse(raw)
            if(!Array.isArray(local))throw Error('Invalid browser views.')
            const legacy=local.map(readSavedView)
            if(legacy.length)remote=await request({action:'import',views:legacy})
            localStorage.removeItem(key)
          }
        }catch{warning='Your account views are loaded, but browser views could not be migrated. They are retained here; retry to sync them.'}
        if(!cancelled){setViews(remote);setReady(true);setMessage(warning)}
      }catch(e){if(!cancelled)setMessage(e instanceof Error?e.message:'Could not load views.')}
    }
    void load()
    return()=>{cancelled=true}
  },[key,retry,request])
  useEffect(()=>{
    if(!ready||editing)return
    let cancelled=false
    const refresh=()=>{if(!writing.current&&document.visibilityState==='visible')void request().then(v=>{if(!cancelled)setViews(v)}).catch(()=>{if(!cancelled)setMessage('Could not refresh account views. Retry when connected.')})}
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh)
    return()=>{cancelled=true;window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh)}
  },[ready,editing,key,request])
  const selected=views.find(v=>v.id===activeId)??views.find(v=>!!active&&serializeRules(v)===active&&sameSearch(v.search,search))
  const modified=!!selected&&(serializeRules(selected)!==active||!sameSearch(selected.search,search))
  async function persist(body:unknown) {
    try{const next=await request(body);setViews(next);return true}
    catch(e){
      setMessage(e instanceof Error?e.message:'Could not save your view.')
      try{setViews(await request())}catch{}
      return false
    }
  }
  async function remove(){
    if(writing.current)return
    writing.current=true;setBusy(true)
    try{if(await persist({action:'delete',id,revision})){openBuiltin('all');setMessage('View deleted from your account.')}}
    finally{writing.current=false;setBusy(false)}
  }
  function openBuiltin(filter:string) {
    onNavigate({...defaultSearch,filter,rules:null,savedView:null,page:null});setEditing(false);setMessage('')
  }
  function openView(view:SavedPlayerView) {onNavigate(savedViewChanges(view));setEditing(false);setMessage('')}
  function edit(view?:AccountPlayerView) {
    setId(view?.id??'');setName(view?.name??'');setRevision(view?.revision??0)
    try{setDraft(active?parsePlayerRules(active):{match:'all',rules:[]})}catch{setDraft({match:'all',rules:[]})}
    setMessage('');setEditing(true)
  }
  function update(index:number,change:Partial<ViewRule>) {setDraft({...draft,rules:draft.rules.map((r,i)=>i===index?{...r,...change}:r)})}
  async function apply(save:boolean) {
    if(writing.current)return
    writing.current=true;setBusy(true)
    try{
      const rules:PlayerRules=draft.rules.length?parsePlayerRules(serializeRules(draft)):{match:'all',rules:[]}
      if(save){
        if(!name.trim())throw Error('Give this view a name.')
        if(views.some(v=>v.id!==id&&v.name.toLowerCase()===name.trim().toLowerCase()))throw Error('A view with this name already exists.')
        const view:SavedPlayerView={...rules,search:{...search},id:id||crypto.randomUUID(),name:name.trim()}
        if(!await persist({action:'save',view,revision}))return
        onNavigate(savedViewChanges(view));setEditing(false);setMessage('Saved to your account. Available on all your devices.');return
      }
      onNavigate({rules:serializeRules(rules)||null,page:null});setMessage('Preview applied. Save to keep this view.')
    }catch(e){setMessage(e instanceof Error?e.message:'Check your rules.')}
    finally{writing.current=false;setBusy(false)}
  }
  return <section className={styles.panel} aria-label="Player views">
    <div className={styles.tabbar}>
      <div className={styles.tabs} role="group" aria-label="Player directory views">
        {[['all','All players'],['scouted','Scouted only'],['watch','My watchlist']].map(([value,label])=><button type="button" key={value} disabled={busy} className="ui-btn" data-variant={!selected&&!active&&search.filter===value?'primary':'ghost'} aria-pressed={!selected&&!active&&search.filter===value} onClick={()=>openBuiltin(value)}>{label}</button>)}
        {!!views.length&&<span className={styles.divider} aria-hidden="true"/>}
        {views.map(view=><button type="button" key={view.id} disabled={busy} className={'ui-btn '+styles.savedTab} data-variant={selected?.id===view.id?'primary':'ghost'} aria-pressed={selected?.id===view.id} title={view.name} onClick={()=>openView(view)}><span aria-hidden="true">☆</span><span className={styles.tabName}>{view.name}</span>{selected?.id===view.id&&modified&&<span aria-label="Modified"> ·</span>}</button>)}
      </div>
      <button type="button" className="ui-btn" data-variant="ghost" disabled={!ready||busy} onClick={()=>edit()}>+ Create view</button>
    </div>
    {(selected||active)&&!editing&&<div className={styles.context}>
      <div><strong>{selected?.name??'Unsaved view'}</strong>{modified&&<span className={styles.modified}>Unsaved changes</span>}<small>{selected?selected.rules.length+' custom rule'+(selected.rules.length===1?'':'s')+' · Saved to your account':'Save these filters as a view to keep them in your tabs.'}</small></div>
      <button type="button" className="ui-btn" data-variant="ghost" disabled={!ready||busy} onClick={()=>edit(selected)}>{selected?'Edit view':'Save view'}</button>
    </div>}
    {editing&&<form aria-busy={busy} className={styles.editor} onKeyDown={e=>{if(e.key==='Escape'&&!busy)setEditing(false)}} onSubmit={e=>{e.preventDefault();void apply(true)}}><fieldset disabled={busy||!ready} className={styles.editorFields}>
      <div className={styles.editorHeading}><div><h2>{id?'Edit saved view':'Create a saved view'}</h2><p>Save your current search and filters. Add rules to narrow the list further.</p></div><button type="button" className="ui-btn" data-variant="ghost" aria-label="Close view editor" onClick={()=>setEditing(false)}>×</button></div>
      <div className={styles.searchSummary}>Current search: {search.q||'Any player'} · {search.gender==='women'?'Women':search.gender==='men'?'Men':'All genders'} · {search.year||'All seasons'} · {search.filter==='scouted'?'Scouted only':search.filter==='watch'?'Watchlist':'All players'} · Sort: {sortColumns[parseDirectorySort(search.sort).key].label} {parseDirectorySort(search.sort).direction==='asc'?'↑':'↓'}</div>
      <div className={styles.toolbar}>
        <label>View name<input maxLength={80} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Catalunya players"/></label>
        {!!draft.rules.length&&<BrandedSelect label="Include players matching" value={draft.match} onChange={value=>setDraft({...draft,match:value as PlayerRules['match']})} options={[{value:'all',label:'All rules (AND)'},{value:'any',label:'Any rule (OR)'}]}/>}
      </div>
      {draft.rules.map((rule,index)=><div className={styles.rule} key={index}>
        <BrandedSelect label="Field" value={rule.field} onChange={value=>{const field=value as ViewField;update(index,{field,operator:fieldOperators(field)[0],value:''})}} options={Object.entries(viewFields).map(([value,label])=>({value,label}))}/>
        <BrandedSelect label="Condition" value={rule.operator} onChange={value=>update(index,{operator:value as ViewRule['operator']})} options={fieldOperators(rule.field).map(value=>({value,label:operators[value]}))}/>
        {rule.operator!=='missing'&&(birthFieldOptions[rule.field]?<BrandedSelect label="Value" value={rule.value} onChange={value=>update(index,{value})} options={[{value:'',label:'Select a value'},...Object.entries(birthFieldOptions[rule.field]).map(([value,label])=>({value,label}))]}/>:<label>Value<input maxLength={500} value={rule.value} onChange={e=>update(index,{value:e.target.value})} placeholder={rule.operator==='any'?'Separate values with commas':rule.field==='country'?'e.g. ES':rule.field==='category'?'men or women':'Enter value'}/></label>)}
        <button type="button" className="ui-btn" data-variant="ghost" aria-label={'Remove rule '+(index+1)} onClick={()=>setDraft({...draft,rules:draft.rules.filter((_,i)=>i!==index)})}>Remove</button>
      </div>)}
      {draft.rules.some(r=>r.field.startsWith('birth'))&&<p>Birth region includes proposed matches. Add “Birthplace status is Verified” with All rules for verified-only results. Missing and unresolved birthplaces have no region.</p>}
      <div className={styles.toolbar}>
        <button type="button" className="ui-btn" data-variant="ghost" disabled={draft.rules.length>=12} onClick={()=>setDraft({...draft,rules:[...draft.rules,blankRule()]})}>Add rule</button>
        <button type="button" className="ui-btn" data-variant="ghost" onClick={()=>apply(false)}>Preview results</button>
        <button disabled={busy} className="ui-btn" data-variant="primary">{busy?'Saving…':id?'Save changes':'Save view'}</button>
        <button type="button" className="ui-btn" data-variant="ghost" onClick={()=>setEditing(false)}>Cancel</button>
        {id&&<button type="button" className="ui-btn" data-variant="ghost" disabled={busy} onClick={()=>void remove()}>Delete view</button>}
      </div>
    </fieldset></form>}
    {message&&<p role="status">{message}</p>}
    {!ready&&!message&&<p role="status">Loading saved views…</p>}
    {message&&(!ready||message.includes('retry')||message.includes('Retry'))&&<button type="button" className="ui-btn" data-variant="ghost" disabled={busy} onClick={()=>{setReady(false);setRetry(n=>n+1)}}>Retry sync</button>}
    {editing&&process.env.NODE_ENV==='development'&&<Link className={styles.previewLink} href="/scouting/players/birthplace-preview">Review birthplace normalization ↗</Link>}
  </section>
}
