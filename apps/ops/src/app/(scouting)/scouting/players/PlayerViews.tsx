'use client'
import {parseDirectorySort,sortColumns} from '@/lib/scouting/intelligence/directory-sort'
import {useEffect,useState} from 'react'
import Link from 'next/link'
import BrandedSelect from './BrandedSelect'
import {birthFieldOptions} from '@/lib/scouting/intelligence/birthplace-fields'
import {fieldOperators,operators,parsePlayerRules,viewFields,type PlayerRules,type ViewField,type ViewRule} from '@/lib/scouting/intelligence/player-views'
import {defaultSearch,readSavedView,savedViewChanges,sameSearch,serializeRules,type SavedPlayerView,type SavedSearch} from '@/lib/scouting/intelligence/saved-player-views'
import styles from './player-views.module.css'
const blankRule = (): ViewRule => ({field:'birth_region',operator:'is',value:''})
export default function PlayerViews({userId,active,activeId,search,onNavigate}: {userId:string;active:string;activeId:string;search:SavedSearch;onNavigate:(changes:Record<string,string|null>)=>void}) {
  const key='pn-admin-player-views:'+userId
  const [views,setViews]=useState<SavedPlayerView[]>([])
  const [editing,setEditing]=useState(false),[id,setId]=useState(''),[name,setName]=useState('')
  const [draft,setDraft]=useState<PlayerRules>({match:'all',rules:[]})
  const [message,setMessage]=useState(''),[ready,setReady]=useState(false)
  useEffect(()=>{
    try {
      const saved=JSON.parse(localStorage.getItem(key)??'[]')
      if(!Array.isArray(saved))throw Error()
      setViews(saved.map(readSavedView));setReady(true)
    } catch {setMessage('Saved views could not be read. Browser storage may be unavailable.')}
  },[key])
  const selected=views.find(v=>v.id===activeId)??views.find(v=>!!active&&serializeRules(v)===active&&sameSearch(v.search,search))
  const modified=!!selected&&(serializeRules(selected)!==active||!sameSearch(selected.search,search))
  function persist(next:SavedPlayerView[]) {
    try{localStorage.setItem(key,JSON.stringify(next));setViews(next);return true}
    catch{setMessage('Could not save views. Check browser storage and try again.');return false}
  }
  function openBuiltin(filter:string) {
    onNavigate({...defaultSearch,filter,rules:null,savedView:null,page:null});setEditing(false);setMessage('')
  }
  function openView(view:SavedPlayerView) {onNavigate(savedViewChanges(view));setEditing(false);setMessage('')}
  function edit(view?:SavedPlayerView) {
    setId(view?.id??'');setName(view?.name??'')
    try{setDraft(active?parsePlayerRules(active):{match:'all',rules:[]})}catch{setDraft({match:'all',rules:[]})}
    setMessage('');setEditing(true)
  }
  function update(index:number,change:Partial<ViewRule>) {setDraft({...draft,rules:draft.rules.map((r,i)=>i===index?{...r,...change}:r)})}
  function apply(save:boolean) {
    try{
      const rules:PlayerRules=draft.rules.length?parsePlayerRules(serializeRules(draft)):{match:'all',rules:[]}
      if(save){
        if(!name.trim())throw Error('Give this view a name.')
        if(views.some(v=>v.id!==id&&v.name.toLowerCase()===name.trim().toLowerCase()))throw Error('A view with this name already exists.')
        const view:SavedPlayerView={...rules,search:{...search},id:id||crypto.randomUUID(),name:name.trim()}
        if(!persist(id?views.map(v=>v.id===id?view:v):[...views,view]))return
        onNavigate(savedViewChanges(view));setEditing(false);setMessage('Saved to your view tabs in this browser.');return
      }
      onNavigate({rules:serializeRules(rules)||null,page:null});setMessage('Preview applied. Save to keep this view.')
    }catch(e){setMessage(e instanceof Error?e.message:'Check your rules.')}
  }
  return <section className={styles.panel} aria-label="Player views">
    <div className={styles.tabbar}>
      <div className={styles.tabs} role="group" aria-label="Player directory views">
        {[['all','All players'],['scouted','Scouted only'],['watch','My watchlist']].map(([value,label])=><button type="button" key={value} className="ui-btn" data-variant={!selected&&!active&&search.filter===value?'primary':'ghost'} aria-pressed={!selected&&!active&&search.filter===value} onClick={()=>openBuiltin(value)}>{label}</button>)}
        {!!views.length&&<span className={styles.divider} aria-hidden="true"/>}
        {views.map(view=><button type="button" key={view.id} className={'ui-btn '+styles.savedTab} data-variant={selected?.id===view.id?'primary':'ghost'} aria-pressed={selected?.id===view.id} title={view.name} onClick={()=>openView(view)}><span aria-hidden="true">☆</span><span className={styles.tabName}>{view.name}</span>{selected?.id===view.id&&modified&&<span aria-label="Modified"> ·</span>}</button>)}
      </div>
      <button type="button" className="ui-btn" data-variant="ghost" disabled={!ready} onClick={()=>edit()}>+ Create view</button>
    </div>
    {(selected||active)&&!editing&&<div className={styles.context}>
      <div><strong>{selected?.name??'Unsaved view'}</strong>{modified&&<span className={styles.modified}>Unsaved changes</span>}<small>{selected?selected.rules.length+' custom rule'+(selected.rules.length===1?'':'s')+' · Saved in this browser':'Save these filters as a view to keep them in your tabs.'}</small></div>
      <button type="button" className="ui-btn" data-variant="ghost" onClick={()=>edit(selected)}>{selected?'Edit view':'Save view'}</button>
    </div>}
    {editing&&<form className={styles.editor} onKeyDown={e=>{if(e.key==='Escape')setEditing(false)}} onSubmit={e=>{e.preventDefault();apply(true)}}>
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
        <button className="ui-btn" data-variant="primary">{id?'Save changes':'Save view'}</button>
        <button type="button" className="ui-btn" data-variant="ghost" onClick={()=>setEditing(false)}>Cancel</button>
        {id&&<button type="button" className="ui-btn" data-variant="ghost" onClick={()=>{if(persist(views.filter(v=>v.id!==id))){openBuiltin('all');setMessage('View deleted.')}}}>Delete view</button>}
      </div>
    </form>}
    {message&&<p role="status">{message}</p>}
    {editing&&process.env.NODE_ENV==='development'&&<Link className={styles.previewLink} href="/scouting/players/birthplace-preview">Review birthplace normalization ↗</Link>}
  </section>
}
