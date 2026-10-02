'use client'
import {useState,useSyncExternalStore} from 'react'
import {createPortal} from 'react-dom'
const subscribe=()=>()=>{}
import {SHOP_AVATARS} from '@/lib/avatar-shop'
import {renderAvatar} from '@/lib/avatar-a01-renderer.mjs'
const hats=[['club','Club Cap'],['cobalt','Blue Visor'],['sunset','Sun Rally'],['champion','Champion Cap'],['backwards','Reverse Rally'],['bandana','Court Bandana']]
export default function HatReview(){
 const [dark,setDark]=useState(true),[full,setFull]=useState(false),[selected,setSelected]=useState('face-06')
 const ready=useSyncExternalStore(subscribe,()=>true,()=>false)
 if(!ready)return null
 return createPortal(<main style={{position:'fixed',inset:0,zIndex:99999,overflow:'auto',padding:16,background:dark?'#23251f':'#f4f2e9',color:dark?'#eee9d7':'#24271f',minHeight:'100vh'}}>
 <h1 style={{fontSize:24,fontWeight:750}}>Revisión de gorras · A01</h1>
 <p style={{fontSize:13,margin:'8px 0'}}>Vista local. Revisar pelo, sienes, visera y proporción. Los ajustes siguen en evaluación.</p>
 <nav style={{display:'flex',gap:16,margin:'16px 0',flexWrap:'wrap'}}>
 <a href="avatar-preview" style={{textDecoration:'underline'}}>Volver al vestuario</a>
 <button onClick={()=>setDark(!dark)}>Fondo {dark?'claro':'oscuro'}</button>
 <button onClick={()=>setFull(!full)}>{full?'Ver cabeza':'Ver cuerpo completo'}</button>
 <select aria-label="Personaje" value={selected} onChange={e=>setSelected(e.target.value)} style={{background:'transparent',color:'inherit',border:'1px solid #80836d',padding:'4px 8px'}}>{SHOP_AVATARS.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}<option value="all">Todos</option></select></nav>
 {SHOP_AVATARS.filter(a=>selected==='all'||selected===a.id).map(({id:avatar,name})=><section key={avatar}>
 <h2 style={{fontSize:20,fontWeight:700,margin:'24px 0 12px'}}>{name}</h2>
 <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:12}}>
 {hats.map(([hat,name])=><article key={hat} style={{border:'1px solid #80836d',borderRadius:12,padding:10}}>
 <p style={{fontSize:10,textAlign:'center',opacity:.75}}>Ajuste integrado · en revisión</p>
 <h3 style={{textAlign:'center',fontWeight:700}}>{name}</h3>
 <div style={{height:full?370:205}} dangerouslySetInnerHTML={{__html:renderAvatar({avatar,outfit:{hat},portrait:!full,id:`review-${avatar}-${hat}`,base:'/play/avatars/a01-local/'}).replace('<svg ','<svg style="width:100%;height:100%" ')}}/>
 </article>)}
 </div></section>)}
 </main>,document.body)
}
