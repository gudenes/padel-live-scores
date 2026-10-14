'use client'
import {useEffect,useId,useRef,useState} from 'react'
import styles from './filter-controls.module.css'
type Option={value:string;label:string;group?:string}
export default function FilterSelect({name,label,value,options,onChange}:{name:string;label:string;value:string;options:Option[];onChange?:(value:string)=>void}){
 const id=useId(),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),input=useRef<HTMLInputElement>(null),search=useRef<HTMLInputElement>(null)
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(0),[selected,setSelected]=useState(value)
 useEffect(()=>setSelected(value),[value])
 useEffect(()=>{if(!open)return;search.current?.focus();const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false)};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[open])
 const visible=options.filter(o=>`${o.group??''} ${o.label}`.toLowerCase().includes(query.toLowerCase()))
 function choose(option:Option){setSelected(option.value);setOpen(false);if(onChange)onChange(option.value);else if(input.current){input.current.value=option.value;input.current.form?.requestSubmit()}trigger.current?.focus()}
 return <div className={styles.field} ref={root} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false)}}>
 <span id={id+'-label'}>{label}</span><input ref={input} type="hidden" name={name} value={selected}/>
 <button ref={trigger} type="button" className={'ui-btn '+styles.trigger} aria-labelledby={id+'-label '+id+'-value'} aria-expanded={open} aria-haspopup="listbox" aria-controls={id} onClick={()=>{setQuery('');setActive(0);setOpen(!open)}} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true);setActive(0)}}}><span id={id+'-value'}>{options.find(o=>o.value===selected)?.label??'All'}</span><span aria-hidden="true">⌄</span></button>
 {open&&<div className={styles.menu}><input ref={search} className="ui-input" placeholder="Find an option…" aria-label={`Search ${label}`} role="combobox" aria-expanded="true" aria-controls={id} aria-activedescendant={visible.length?id+'-'+active:undefined} value={query} onChange={e=>{setQuery(e.target.value);setActive(0)}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setOpen(false);trigger.current?.focus()}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();setActive(i=>e.key==='Home'?0:e.key==='End'?Math.max(0,visible.length-1):Math.max(0,Math.min(visible.length-1,i+(e.key==='ArrowDown'?1:-1))))}else if(e.key==='Enter'){e.preventDefault();if(visible[active])choose(visible[active])}}}/>
 <div id={id} role="listbox" aria-label={label} className={styles.options}>{visible.map((o,i)=><div key={o.value}>{o.group&&o.group!==visible[i-1]?.group&&<div className={styles.group}>{o.group}</div>}<button type="button" id={id+'-'+i} role="option" aria-selected={selected===o.value} tabIndex={-1} className={'ui-btn '+styles.option} data-variant="ghost" data-active={active===i} onMouseEnter={()=>setActive(i)} onClick={()=>choose(o)}>{o.label}{selected===o.value&&<span aria-hidden="true">✓</span>}</button></div>)}{!visible.length&&<p className={styles.empty}>No options found</p>}</div></div>}
 </div>
}
