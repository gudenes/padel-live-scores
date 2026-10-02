'use client'
import {useLayoutEffect,useRef} from 'react'
import {Figure} from '@/components/player/shop/WardrobeFigure'
import {SHOP_AVATARS,SHOP_ITEMS,initialShopState} from '@/lib/avatar-shop'
import {usesA01Artwork} from '@/lib/avatar-a01'
export default function Review(){
 const root=useRef<HTMLElement>(null)
 useLayoutEffect(()=>{root.current?.querySelectorAll<SVGElement>('svg[data-review-crop],section svg').forEach(svg=>{svg.setAttribute('viewBox',svg.dataset.avatarRenderer==='a01'?'680 690 180 200':'680 815 145 155');svg.style.maskImage='none'})},[])
 return <main ref={root} style={{background:'#23251f',padding:12,color:'#eee9d7'}}><h1>Muñequeras · todos los personajes</h1>{SHOP_AVATARS.map(a=><section key={a.id}><h2 style={{margin:'12px 0'}}>{a.name} · {usesA01Artwork(a.id)?'A01':'Actual'}</h2><div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:4}}>{SHOP_ITEMS.filter(i=>i.slot==='wrist').map(item=><div key={item.id}><p style={{fontSize:10}}>{item.name}</p><div style={{height:110}}><Figure state={{...initialShopState(),avatar:a.id}} preview={item} original={false}/></div></div>)}</div></section>)}</main>
}
