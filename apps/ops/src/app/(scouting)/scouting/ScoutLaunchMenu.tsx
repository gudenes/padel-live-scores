'use client'

import {useEffect,useId,useRef,useState} from 'react'
import ScoutPopupLink from './ScoutPopupLink'
import styles from './scout-launch.module.css'

export default function ScoutLaunchMenu({matchId,continuing}:{matchId:string;continuing:boolean}) {
 const [open,setOpen]=useState(false)
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
 <a className={"ui-btn "+styles.mainAction} data-variant="primary" href={`/scouting/${matchId}/live`}>{continuing?'Continue scouting':'Start scouting'}</a>
 <button ref={trigger} type="button" className={'ui-btn '+styles.trigger} data-variant="primary" aria-label="Scouting window options" title="Scouting window options" aria-haspopup="menu" aria-controls={id} aria-expanded={open} onClick={()=>setOpen(!open)} onKeyDown={e=>{if(!open&&['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();setOpen(true)}}}><span aria-hidden="true">⌄</span></button>
 <div ref={menu} id={id} role="menu" aria-label="Open scouting" hidden={!open} className={styles.menu}>
 <p>Open scouting</p>
 <a className="ui-btn" data-variant="ghost" role="menuitem" href={`/scouting/${matchId}/live`} onClick={close}><span aria-hidden="true">▣</span>Same window</a>
 <ScoutPopupLink matchId={matchId} menuItem onChoose={close}/>
 </div>
 </div>
}
