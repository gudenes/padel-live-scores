'use client'
import {useEffect,useRef,useTransition,type ReactNode,type FormEvent} from 'react'
import {useRouter} from 'next/navigation'

export default function CatalogSearchForm({children,className,initialSearch}:{children:ReactNode;className:string;initialSearch?:string}){
 const formRef=useRef<HTMLFormElement>(null)
 useEffect(()=>{const input=formRef.current?.elements.namedItem('q');if(input instanceof HTMLInputElement&&document.activeElement!==input&&initialSearch!==undefined)input.value=initialSearch},[initialSearch])
 const router=useRouter(),timer=useRef<ReturnType<typeof setTimeout>|null>(null)
 const [pending,startTransition]=useTransition()
 const cancel=()=>{if(timer.current)clearTimeout(timer.current)}
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[])
 function search(form:HTMLFormElement){
  const data=new FormData(form),q=String(data.get('q')??'').trim()
  if(q.length>0&&q.length<3)return
  const params=new URLSearchParams()
  for(const [name,value] of data)if(typeof value==='string'&&(value.trim()||name==='league'||name==='date'))params.set(name,value.trim())
  startTransition(()=>router.replace(`/scouting${params.size?'?'+params:''}`,{scroll:false}))
 }
 function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();cancel();search(event.currentTarget)}
 return <form ref={formRef} className={className} onSubmit={submit} onChange={event=>{
  cancel();const form=event.currentTarget
  if(event.target instanceof HTMLInputElement&&['q','scouter'].includes(event.target.name))timer.current=setTimeout(()=>search(form),400)
  else if(event.target instanceof HTMLSelectElement||(event.target instanceof HTMLInputElement&&event.target.type==='date'))search(form)
 }} aria-busy={pending}>{children}<span role="status" style={{fontSize:11,color:'var(--text-2)'}}>{pending?'Searching…':'Type 3+ letters to search'}</span></form>
}
