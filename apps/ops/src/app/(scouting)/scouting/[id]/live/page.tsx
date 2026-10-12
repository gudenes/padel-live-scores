import {auth} from '@/lib/auth'
import {canScout} from '@/lib/scouting-permissions'
import {redirect} from 'next/navigation'
export const metadata={title:'Scout match · Padel Nachos'}
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{action?:string}>}){
 const user=(await auth())?.user
 if(!user)redirect('/login')
 if(!canScout(user))redirect('/scouting')
 const {id}=await params
 const action=(await searchParams).action==='new'?'&action=new':''
 if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))redirect('/scouting')
 return <iframe data-scout-focus="true" title="Match scouting" src={`/scout-web/panel.html?matchId=${id}${action}`} style={{position:'fixed',inset:0,width:'100%',height:'100dvh',border:0,zIndex:60,background:'#f5f6ef'}}/>
}
