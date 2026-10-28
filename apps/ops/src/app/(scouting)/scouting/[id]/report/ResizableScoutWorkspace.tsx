'use client'
import {Children,useEffect,useRef,useState,type CSSProperties,type ReactNode} from 'react'
import styles from './scout-live.module.css'

const storageKey='pn-live-scout-panel-width'
const minimum=300
const defaultWidth=520

export default function ResizableScoutWorkspace({children}:{children:ReactNode}){
 const container=useRef<HTMLDivElement>(null)
 const drag=useRef<{pointerId:number;startX:number;startWidth:number}|null>(null)
 const [preferred,setPreferred]=useState(defaultWidth)
 const [maximum,setMaximum]=useState(720)
 const [dragging,setDragging]=useState(false)
 const width=Math.max(minimum,Math.min(maximum,preferred))
 useEffect(()=>{
  try{const saved=Number(localStorage.getItem(storageKey));if(Number.isFinite(saved)&&saved>=minimum&&saved<=720)setPreferred(saved)}catch{}
  const node=container.current
  if(!node)return
  const observer=new ResizeObserver(()=>setMaximum(Math.max(minimum,Math.min(720,node.clientWidth-396))))
  observer.observe(node)
  return()=>observer.disconnect()
 },[])
 function resize(next:number){
  const value=Math.round(Math.max(minimum,Math.min(maximum,next)))
  setPreferred(value)
  try{localStorage.setItem(storageKey,String(value))}catch{}
 }
 const panels=Children.toArray(children)
 return <div ref={container} className={styles.workspace} data-resizing={dragging||undefined} style={{'--scout-panel-width':`${width}px`} as CSSProperties}>
  {panels[0]}
  <div className={styles.divider} role="separator" aria-label="Scouting controls width" aria-orientation="vertical" aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={width} aria-valuetext={`${width} pixels. Use left and right arrows to resize.`} tabIndex={0} title="Drag to resize · Arrow keys to adjust · Double-click to reset"
   onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);drag.current={pointerId:event.pointerId,startX:event.clientX,startWidth:width};setDragging(true)}}
   onPointerMove={event=>{const active=drag.current;if(active?.pointerId===event.pointerId)resize(active.startWidth+active.startX-event.clientX)}}
   onPointerUp={event=>{if(drag.current?.pointerId!==event.pointerId)return;drag.current=null;setDragging(false);event.currentTarget.releasePointerCapture(event.pointerId)}}
   onPointerCancel={()=>{drag.current=null;setDragging(false)}}
   onLostPointerCapture={()=>{drag.current=null;setDragging(false)}}
   onDoubleClick={()=>resize(defaultWidth)}
   onKeyDown={event=>{const step=event.shiftKey?40:10;const next=event.key==='ArrowLeft'?width+step:event.key==='ArrowRight'?width-step:event.key==='Home'?minimum:event.key==='End'?maximum:event.key==='Enter'?defaultWidth:null;if(next!==null){event.preventDefault();resize(next)}}}
  ><span aria-hidden="true"/></div>
  {panels[1]}
 </div>
}
