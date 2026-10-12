'use client'

import {useEffect,useId,useRef,useState} from 'react'
import ScoutPopupLink from './ScoutPopupLink'
import styles from './scout-launch.module.css'

export default function ScoutLaunchMenu({matchId,continuing,label,extension=false,placement='above'}:{matchId:string;continuing:boolean;label?:string;extension?:boolean;placement?:'above'|'below'}) {
 const [open,setOpen]=useState(false)
 const [action,setAction]=useState<'resume'|'new'>('resume')
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null)
 const id=useId()
 useEffect(()=>{
  if(!open)return
  menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false)}
  document.addEventListener('pointerdown',outside)
  return()=>document.removeEventListener('pointerdown',outside)
 },[open])
 function close(){setOpen(false);trigger.current?.focus()}
 return <div ref={root} className={styles.root} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false)}} onKeyDown={e=>{
  if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();close()}
  if(open&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
   e.preventDefault()
   const items=Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')??[])
   const current=items.indexOf(document.activeElement as HTMLElement)
   const next=e.key==='Home'?0:e.key==='End'?items.length-1:(current+(e.key==='ArrowDown'?1:-1)+items.length)%items.length
   items[next]?.focus()
  }
 }}>
 <button ref={trigger} type="button" className={'ui-btn '+styles.trigger} data-variant="primary" aria-haspopup="menu" aria-controls={id} aria-expanded={open} onClick={()=>setOpen(!open)} onKeyDown={e=>{if(!open&&['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();setOpen(true)}}}>{label??(continuing?'Continue scouting':'Start scouting')}<span aria-hidden="true">⌄</span></button>
 <div ref={menu} id={id} role="menu" data-placement={placement} aria-label="Open scouting" hidden={!open} className={styles.menu}>
{continuing&&<div className={styles.actionChoice}><button type="button" role="menuitem" className="ui-btn" data-variant={action==='resume'?'primary':'ghost'} onClick={()=>setAction('resume')}>Resume saved scout</button><button type="button" role="menuitem" className="ui-btn" data-variant={action==='new'?'primary':'ghost'} onClick={()=>setAction('new')}>Start new scout</button><p>{action==='new'?'Start at 0–0. Confirmation and backup come next.':extension?'Keep your saved points and continue in the browser without video.':'Continue from your saved score and points.'}</p></div>}<div className={styles.heading}><span>OPEN IN BROWSER</span><p>How would you like to open it?</p></div>
 <a className="ui-btn" data-variant="ghost" role="menuitem" aria-label="Same window" href={`/scouting/${matchId}/live${action==='new'?'?action=new':''}`} onClick={close}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M6 6.5h1m2 0h1"/></svg><span className={styles.copy}><strong>Same window</strong><small>Use this tab for scouting.</small></span></a>
 <ScoutPopupLink matchId={matchId} action={action} menuItem onChoose={close}><span className={styles.copy}><strong>Pop-up window</strong><small>A movable window beside your video.</small></span></ScoutPopupLink>
 </div>
 </div>
}
