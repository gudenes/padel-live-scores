'use client'

import {useRef, useState, type ReactNode, type MouseEvent} from 'react'

export default function ScoutPopupLink({matchId,action,menuItem=false,onChoose,children}:{matchId:string;action?:'new'|'resume';menuItem?:boolean;onChoose?:()=>void;children?:ReactNode}) {
 const [blocked,setBlocked]=useState(false)
 const popup = useRef<Window | null>(null)
 const href = `/scouting/${matchId}/live${action==='new'?'?action=new':''}`
 function open(event:MouseEvent<HTMLAnchorElement>) {
  if(event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return
  if(popup.current && !popup.current.closed){event.preventDefault();popup.current.focus();onChoose?.();return}
  setBlocked(false)
  const width=Math.min(480,window.screen.availWidth)
  const height=Math.min(900,window.screen.availHeight)
  const features=`popup=yes,width=${width},height=${height},resizable=yes,scrollbars=yes`
  const opened=window.open(href,`padel-scout-${matchId}`,features)
  // Keep the choice explicit in the menu when the browser blocks pop-ups.
  if(opened){event.preventDefault();opened.opener=null;popup.current=opened;opened.focus();onChoose?.()}
  else if(menuItem){event.preventDefault();setBlocked(true)}
 }
 return <><a className="ui-btn" data-variant="ghost" href={href} role={menuItem?"menuitem":undefined} onClick={open} title="Open scouting in a separate, resizable window" aria-label={menuItem?"Pop-up window":"Open scouting in pop-up"}>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3h7v7M21 3l-9 9"/><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></svg>
  {children??(menuItem?"Pop-up window":"Open in pop-up")}
 </a>{blocked&&<p role="alert">Allow pop-ups for this site and try again, or choose Same window.</p>}</>
}
