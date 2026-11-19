'use client'
import {useEffect,useId,useRef,useState} from 'react'
import styles from './branded-select.module.css'
type Option={value:string;label:string;description?:string}
export default function BrandedSelect({label,value,options,onChange}:{label:string;value:string;options:Option[];onChange:(value:string)=>void}){
 const [open,setOpen]=useState(false),id=useId(),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null)
 const selected=options.find(o=>o.value===value)
 useEffect(()=>{
  if(!open)return
  const dismiss=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false)}
  document.addEventListener('pointerdown',dismiss)
  const buttons=menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
  buttons?.[Math.max(0,options.findIndex(o=>o.value===value))]?.focus()
  return()=>document.removeEventListener('pointerdown',dismiss)
 },[open,value,options])
 const close=()=>{setOpen(false);trigger.current?.focus()}
 return <div ref={root} className={styles.field} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOpen(false)}} onKeyDown={e=>{
  if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();close()}
 }}>
  <span id={id+'-label'} className={styles.label}>{label}</span>
  <button ref={trigger} type="button" className={'ui-btn '+styles.trigger} data-variant="ghost" aria-labelledby={id+'-label '+id+'-value'} aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(!open)} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true)}}}>
    <span id={id+'-value'}>{selected?.label??'Select a value'}</span><span className={styles.chevron} aria-hidden="true">{open?'⌃':'⌄'}</span>
  </button>
  {open&&<div id={id} ref={menu} role="menu" aria-labelledby={id+'-label'} className={styles.menu} onKeyDown={e=>{
    const buttons=Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')??[]),at=buttons.indexOf(document.activeElement as HTMLButtonElement)
    let next=-1
    if(e.key==='ArrowDown')next=(at+1)%buttons.length
    if(e.key==='ArrowUp')next=(at-1+buttons.length)%buttons.length
    if(e.key==='Home')next=0
    if(e.key==='End')next=buttons.length-1
    if(e.key.length===1&&!e.ctrlKey&&!e.metaKey)next=options.findIndex((o,i)=>i>at&&o.label.toLowerCase().startsWith(e.key.toLowerCase()))
    if(next>=0){e.preventDefault();buttons[next]?.focus()}
  }}>
    <div className={styles.caption}>{label}</div>
    {options.map(o=><button key={o.value} type="button" role="menuitemradio" aria-checked={o.value===value} className={'ui-btn '+styles.option} data-variant={o.value===value?'primary':'ghost'} tabIndex={-1} onClick={()=>{onChange(o.value);close()}}><span><span>{o.label}</span>{o.description&&<small>{o.description}</small>}</span><span aria-hidden="true">{o.value===value?'✓':''}</span></button>)}
  </div>}
 </div>
}
