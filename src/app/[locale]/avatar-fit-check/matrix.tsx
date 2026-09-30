'use client'
import {useState,useSyncExternalStore} from 'react'
import {createPortal} from 'react-dom'
import {Figure} from '@/components/player/shop/AvatarShop'
import {SHOP_AVATARS,SHOP_ITEMS,initialShopState} from '@/lib/avatar-shop'
const subscribe=()=>()=>{}
export default function Matrix(){
 const ready=useSyncExternalStore(subscribe,()=>true,()=>false)
 const [avatar,setAvatar]=useState(SHOP_AVATARS[0].id)
 const [mixed,setMixed]=useState(false)
 if(!ready)return null
 return createPortal(<main style={{position:'fixed',inset:0,zIndex:99999,background:'#242520',color:'#eee9d7',overflow:'auto',padding:12}}><nav style={{display:'flex',gap:16,marginBottom:8}}>{SHOP_AVATARS.map(a=><button key={a.id} onClick={()=>{setMixed(false);setAvatar(a.id)}} style={{color:avatar===a.id?'#9fef29':'white'}}>{a.name}</button>)}<button onClick={()=>setMixed(true)}>Mixed outfits</button></nav>{mixed?<div style={{display:'grid',gridTemplateColumns:'repeat(5,minmax(0,1fr))',gap:8}}>{SHOP_AVATARS.map(a=><section key={a.id}><div style={{height:280}}><Figure state={{...initialShopState(),avatar:a.id,equipped:{hat:'hat-club',shirt:'shirt-club',shorts:'shorts-sunset',shoes:'shoes-club',wrist:'wrist-cobalt',racket:'racket-champion'}}} preview={null} original/></div><p>{a.name}</p></section>)}</div>:<div style={{display:'grid',gridTemplateColumns:'repeat(7,minmax(0,1fr))',gap:4}}>{SHOP_ITEMS.map(item=><section key={item.id} style={{border:'1px solid #414637',padding:3}}><div style={{height:165}}><Figure state={{...initialShopState(),avatar}} preview={item} original={false}/></div><p style={{fontSize:11,textAlign:'center'}}>{item.slot}: {item.name}</p></section>)}</div>}</main>,document.body)
}
