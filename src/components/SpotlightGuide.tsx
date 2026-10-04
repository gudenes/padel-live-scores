'use client'
import {createPortal} from 'react-dom'
import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react'
import styles from '@/app/[locale]/(app)/play/_components/PlayOnboarding.module.css'
export default function SpotlightGuide({step,active=true,selector,expandChoice=false,label,eyebrow,title,description,action,skipLabel,disabled=false,error,onAdvance,onSkip}:{step:string;active?:boolean;selector:string;expandChoice?:boolean;label:string;eyebrow:string;title:(found:boolean)=>ReactNode;description:(found:boolean)=>ReactNode;action?:string;skipLabel:string;disabled?:boolean;error?:string;onAdvance?:()=>void;onSkip:()=>void}){
 const guideRef=useRef<HTMLElement>(null),targetRef=useRef<HTMLElement|null>(null)
 const skipRef=useRef(onSkip);skipRef.current=onSkip
 const [guideHeight,setGuideHeight]=useState(0)
 const [box,setBox]=useState<{x:number;y:number;width:number;height:number;vw:number;vh:number;frameLeft:number;frameWidth:number}|null>(null)
 useEffect(()=>{
  if(!active)return
  let revealed=false
  const measure=()=>{
   let target=Array.from(document.querySelectorAll<HTMLElement>(selector)).find(element=>!element.closest('[hidden]')&&element.getClientRects().length>0)??null
   if(expandChoice)target=target?.closest<HTMLElement>('[data-onboarding-choice]')??null
   targetRef.current=target
   if(target&&!revealed){revealed=true;target.scrollIntoView?.({block:'center',behavior:'instant'})}
   const ownRect=target?.getBoundingClientRect()
   const context=expandChoice?target?.closest('[data-onboarding-market]')?.querySelector('[data-onboarding-context]')?.getBoundingClientRect():null
   const rect=ownRect&&context?{x:ownRect.x,y:Math.min(ownRect.y,context.y),width:ownRect.width,height:ownRect.bottom-Math.min(ownRect.y,context.y)}:ownRect
   const next=rect?{x:Math.max(4,rect.x-6),y:Math.max(4,rect.y-6),width:Math.min(rect.width+12,innerWidth-8),height:rect.height+12,vw:innerWidth,vh:innerHeight}:{x:innerWidth/2,y:100,width:0,height:0,vw:innerWidth,vh:innerHeight}
   const frame=target?.closest('.pl-root,[data-avatar-shop]')?.getBoundingClientRect()
   const bounded={...next,frameLeft:Math.max(0,frame?.left??0),frameWidth:Math.min(innerWidth,frame?.width||innerWidth)}
   setBox(previous=>JSON.stringify(previous)===JSON.stringify(bounded)?previous:bounded)
  }
  measure();const timer=setInterval(measure,400)
  window.addEventListener('resize',measure);window.addEventListener('scroll',measure,true)
  return()=>{clearInterval(timer);window.removeEventListener('resize',measure);window.removeEventListener('scroll',measure,true)}
 },[step,active,selector,expandChoice])
 const visible=active&&!!box
 useLayoutEffect(()=>{
  const guide=guideRef.current
  if(!visible||!guide)return
  const measure=()=>setGuideHeight(guide.getBoundingClientRect().height)
  measure()
  if(typeof ResizeObserver==='undefined')return
  const observer=new ResizeObserver(measure);observer.observe(guide)
  return()=>observer.disconnect()
 },[visible,step,error])
 useEffect(()=>{
  if(!visible)return
  const previous=document.activeElement as HTMLElement|null
  const guide=guideRef.current
  guide?.focus({preventScroll:true})
  const focusable='button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]'
  const allowed=()=>[...Array.from(guide?.querySelectorAll<HTMLElement>(focusable)??[]),...Array.from(targetRef.current?.querySelectorAll<HTMLElement>(focusable)??[])].filter(element=>element.getClientRects().length>0)
  const keydown=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();skipRef.current();return}
   if(event.key!=='Tab')return
   const items=allowed();if(!items.length){event.preventDefault();guide?.focus();return}
   const index=items.indexOf(document.activeElement as HTMLElement)
   event.preventDefault();items[(index+(event.shiftKey?-1:1)+items.length)%items.length]?.focus()
  }
  const focusin=(event:FocusEvent)=>{const node=event.target as Node;if(!guide?.contains(node)&&!targetRef.current?.contains(node))guide?.focus({preventScroll:true})}
  document.addEventListener('keydown',keydown);document.addEventListener('focusin',focusin)
  return()=>{document.removeEventListener('keydown',keydown);document.removeEventListener('focusin',focusin);if(previous?.isConnected)previous.focus({preventScroll:true})}
 },[visible,step])
 if(!active||!box)return null
 const hasTarget=box.width>0
 const width=Math.min(340,box.frameWidth-32),left=Math.max(box.frameLeft+16,Math.min(box.x+box.width/2-width/2,box.frameLeft+box.frameWidth-width-16))
 const below=Math.max(0,box.vh-box.y-box.height-30),above=Math.max(0,box.y-30)
 const useBelow=below>=guideHeight||below>=above
 const maxHeight=Math.max(96,useBelow?below:above)
 const top=Math.max(16,Math.min(box.vh-Math.min(guideHeight,maxHeight)-16,useBelow?box.y+box.height+14:box.y-Math.min(guideHeight,maxHeight)-14))
 return createPortal(<>
 <div className={styles.veil} style={{inset:`0 0 ${Math.max(0,box.vh-box.y)}px 0`}}/>
 <div className={styles.veil} style={{top:box.y+box.height,bottom:0,left:0,right:0}}/>
 <div className={styles.veil} style={{top:box.y,height:box.height,left:0,width:box.x}}/>
 <div className={styles.veil} style={{top:box.y,height:box.height,left:box.x+box.width,right:0}}/>
 {box.width>0&&<div className={styles.focusRing} style={{left:box.x,top:box.y,width:box.width,height:box.height}}/>}
 <aside ref={guideRef} tabIndex={-1} className={styles.spotGuide} style={{left,top,width,maxHeight,overflowY:'auto'}} aria-label={label} aria-live="polite">
 <div className={styles.eyebrow}>{eyebrow}</div>
 <h2>{title(hasTarget)}</h2><p>{description(hasTarget)}</p>
 {error&&<p role="alert" className={styles.error}>{error}</p>}
 <div className={styles.actions}>
 {action&&<button type="button" className="pn-press shape-chunky-tilted intent-primary size-sm" disabled={disabled} onClick={onAdvance}><span className="pn-press-skirt" aria-hidden="true"/><span className="pn-press-face">{action}</span></button>}
 <button type="button" className="pn-press shape-chunky-tilted intent-neutral size-sm" onClick={onSkip}><span className="pn-press-skirt" aria-hidden="true"/><span className="pn-press-face">{skipLabel}</span></button>
 </div></aside></>,document.body)
}
