'use client'
import {useEffect,useRef,useState} from 'react'
import {Button} from '@/components/ui'
import ShotIcon from './ShotIcon'
import {shots,type Shot,type ShotSide} from '@/lib/scouting/shots'
import type {Outcome,Player} from '@/lib/scouting/model'
import styles from './scout.module.css'
const groups=[{name:'Overheads',icon:'overhead',shots:['smash','vibora','bandeja','bajada','rulo','gancho']},{name:'Net',icon:'net',shots:['volley','drop','block','half_volley']},{name:'Ground & defence',icon:'defence',shots:['groundstroke','lob','chiquita','wall','contrapared']},{name:'Serve & return',icon:'serve',shots:['serve','return','other']}] as const
export type ShotDetails={shot?:Shot;side?:ShotSide;assistBy?:Player;recovery?:boolean;smashRecovery?:boolean;netCord?:'lucky'|'unlucky';smashAttemptId?:string}
export default function ShotPicker({name,partner,partnerId,outcome,attemptId,disabled,onCancel,onConfirm}:{name:string;partner:string;partnerId:Player;outcome:Outcome;attemptId?:string;disabled:boolean;onCancel:()=>void;onConfirm:(details:ShotDetails)=>void}){
 const dialog=useRef<HTMLDialogElement>(null)
 const [shot,setShot]=useState<Shot>(),[side,setSide]=useState<ShotSide>(),[assist,setAssist]=useState(false),[recovery,setRecovery]=useState(false),[counted,setCounted]=useState(false),[smashRecovery,setSmashRecovery]=useState(false),[netCord,setNetCord]=useState<'lucky'|'unlucky'>()
 useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close()},[])
 const label=outcome==='winner'?'Winner':outcome==='unforced'?'Unforced error':'Forced error'
 return <dialog ref={dialog} className={styles.shotDialog} aria-labelledby="shot-picker-title" onCancel={e=>{e.preventDefault();onCancel()}}>
  <form onKeyDown={e=>{
   if(e.nativeEvent.isComposing||e.altKey)return
   const save=e.key==='Enter'&&(e.ctrlKey||e.metaKey)
   const assistKey=e.key.toLowerCase()==='a'&&!e.ctrlKey&&!e.metaKey&&outcome==='winner'
   if(!save&&!assistKey)return
   const target=e.target as HTMLElement
   if(!save&&(target.isContentEditable||target.closest('textarea,select,input:not([type="checkbox"]):not([type="radio"])')))return
   e.preventDefault();e.stopPropagation()
   if(e.repeat||disabled)return
   if(save)e.currentTarget.requestSubmit()
   else setAssist(value=>!value)
  }} onSubmit={e=>{e.preventDefault();if(disabled)return;onConfirm({...(shot?{shot}:{}),...(side?{side}:{}),...(assist&&outcome==='winner'?{assistBy:partnerId}:{}),...(recovery&&outcome==='winner'?{recovery:true}:{}),...(smashRecovery&&outcome==='winner'?{smashRecovery:true}:{}),...(netCord?{netCord}:{}),...(shot==='smash'&&counted&&attemptId?{smashAttemptId:attemptId}:{})})}}>
   <header><div><h2 id="shot-picker-title">{name} · {label}</h2><p>Choose the finishing shot. Extra details are optional.</p></div><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button></header>
   <div className={styles.shotPickerBody}>
    <section aria-label="Shot type">
     <div className={styles.allShotGroups}>{groups.map(g=><section key={g.name} aria-label={g.name}><h3><ShotIcon kind={g.icon}/>{g.name}</h3><div className={styles.shotGrid}>{g.shots.map(key=><Button type="button" key={key} aria-pressed={shot===key} variant={shot===key?'primary':'default'} onClick={()=>setShot(key)}><span>{shots[key]}</span></Button>)}</div></section>)}</div>
     <div className={styles.shotPickerLinks}><Button type="button" size="sm" aria-pressed={!shot} variant={!shot?'primary':'ghost'} onClick={()=>setShot(undefined)}>Not recorded</Button>{shot&&<span>Selected: {shots[shot]}</span>}<div className={styles.shotSide}><span>Side</span>{(['forehand','backhand'] as const).map(s=><Button key={s} type="button" size="sm" aria-pressed={side===s} variant={side===s?'primary':'default'} onClick={()=>setSide(side===s?undefined:s)}>{s==='forehand'?'Forehand':'Backhand'}</Button>)}</div></div>
    </section>
    <aside className={styles.shotTags} aria-label="Extra details">
     {outcome==='winner'?<><label><input type="checkbox" aria-keyshortcuts="A" checked={assist} onChange={e=>setAssist(e.target.checked)}/><span><b>Teammate assist · A</b><small>Credit {partner} for setting up the winner</small></span></label><div className={styles.recoveryToggle}><button type="button" className="ui-switch" role="switch" aria-checked={recovery} data-on={recovery} onClick={()=>setRecovery(!recovery)}><span className="ui-switch-track" aria-hidden="true"/><span>Outside-court recovery</span></button><small>Winner hit from outside the court · {recovery?'On':'Off'}</small></div><div className={styles.recoveryToggle}><button type="button" className="ui-switch" role="switch" aria-checked={smashRecovery} data-on={smashRecovery} onClick={()=>setSmashRecovery(!smashRecovery)}><span className="ui-switch-track" aria-hidden="true"/><span>Smash recovery</span></button><small>Winner returning an opponent’s smash</small></div></>:<p>Shot type is saved with this error. Assists and recovery tags apply to winners.</p>}
     <div role="group" aria-label="Net cord"><b>Net cord</b><small>Luck for the player taking this shot</small><div className={styles.shotSide}>{(['lucky','unlucky'] as const).map(tag=><Button key={tag} type="button" size="sm" aria-pressed={netCord===tag} variant={netCord===tag?'primary':'default'} onClick={()=>setNetCord(netCord===tag?undefined:tag)}>{tag==='lucky'?'Lucky':'Unlucky'}</Button>)}</div></div>
     {shot==='smash'&&attemptId&&<label><input type="checkbox" checked={counted} onChange={e=>setCounted(e.target.checked)}/><span><b>Smash already counted</b><small>Use this player’s latest attempt in this rally</small></span></label>}
    </aside>
   </div>
   <footer><span>{shot?shots[shot]:'Shot not recorded'}{side?` · ${side}`:''}{assist?' · assist':''}{recovery?' · outside court':''}{smashRecovery?' · smash recovery':''}{netCord?` · ${netCord} net cord`:''}</span><Button type="submit" variant="primary" disabled={disabled} aria-label={`Save ${label.toLowerCase()}`} aria-keyshortcuts="Control+Enter Meta+Enter">Save {label.toLowerCase()} · ⌘/Ctrl ↵</Button></footer>
  </form>
 </dialog>
}
