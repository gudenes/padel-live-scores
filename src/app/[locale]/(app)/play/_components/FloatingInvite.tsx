'use client'
import {useEffect,useState} from 'react'
import {createPortal} from 'react-dom'
import {Press} from './shared'

export default function FloatingInvite({label,onClick}:{label:string;onClick:()=>void}){
 const [nav,setNav]=useState<HTMLElement|null>(null)
 useEffect(()=>{setNav(document.querySelector<HTMLElement>('.app-screen > nav'))},[])
 if(!nav)return null
 return createPortal(<div className="pl-invite-float">
  <Press size="size-sm" ariaLabel={label} ariaHasPopup="dialog" onClick={onClick}>
   {/* Google Material Icons, filled group_add; licensed alongside asset. */}
   <img src="/play/icons/group-add.svg" width={32} height={32} alt="" aria-hidden="true"/>
  </Press>
 </div>,nav)
}
