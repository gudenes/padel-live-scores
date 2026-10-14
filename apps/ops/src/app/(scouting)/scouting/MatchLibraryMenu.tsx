'use client'
import {useEffect,useRef,useState} from 'react'
import LibrarySidebar from './LibrarySidebar'
import styles from './match-library-menu.module.css'

export default function MatchLibraryMenu({userId}:{userId:string}){
 const dialog=useRef<HTMLDialogElement>(null)
 const [headerBottom,setHeaderBottom]=useState(76)
 useEffect(()=>{
  const header=document.querySelector('.gheader')
  if(!header)return
  const update=()=>setHeaderBottom(Math.max(0,header.getBoundingClientRect().bottom))
  update()
  const observer=new ResizeObserver(update);observer.observe(header)
  window.addEventListener('resize',update)
  return()=>{observer.disconnect();window.removeEventListener('resize',update)}
 },[])
 return <>
 <button type="button" className="ui-btn" data-variant="ghost" aria-haspopup="dialog" onClick={()=>dialog.current?.showModal()}>
 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg> My Library
 </button>
 <dialog ref={dialog} className={styles.drawer} style={{top:headerBottom,height:`calc(100dvh - ${headerBottom}px)`,maxHeight:`calc(100dvh - ${headerBottom}px)`}} aria-label="My Library" onClick={e=>{
  if(e.target!==dialog.current)return
  const r=dialog.current.getBoundingClientRect()
  if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.current.close()
 }}>
 <div className={styles.content} onClick={e=>{if((e.target as HTMLElement).closest('a'))dialog.current?.close()}}>
 <LibrarySidebar userId={userId} closeControl={<button type="button" className="ui-btn" data-size="sm" data-variant="ghost" aria-label="Close library" onClick={()=>dialog.current?.close()}>×</button>}/>
 </div>
 </dialog>
 </>
}
