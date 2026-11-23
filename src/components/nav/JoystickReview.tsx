'use client'
import {useEffect,useRef,useState} from 'react'
import JoystickSprite from './JoystickSprite'

/** Local-only interaction sandbox: no navigation or account mutations. */
export default function JoystickReview(){
 const [pressed,setPressed]=useState(false)
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null)
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[])
 function release(){setPressed(false)}
 function replay(){if(timer.current)clearTimeout(timer.current);setPressed(true);timer.current=setTimeout(release,450)}
 return <main style={{maxWidth:600,margin:'60px auto',padding:24,color:'#eee7d2',fontFamily:'inherit'}}>
  <p style={{color:'#7ed321',fontSize:12,letterSpacing:2}}>LOCAL MOTION PREVIEW</p>
  <h1 style={{fontSize:32,margin:'12px 0'}}>Try the joystick</h1>
  <p style={{color:'#a6bac5',lineHeight:1.6}}>The base stays still. The shaft tilts and the orange button presses down, then both spring back. The idle “playing” motion starts after 4 seconds and repeats every 16 seconds.</p>
  <div style={{display:'flex',justifyContent:'space-around',alignItems:'center',minHeight:260,background:'#121a14',border:'1px solid #40522d',margin:'24px 0'}}>
   <div><div className="v3-tab-play" data-joystick-pressed={pressed} style={{width:88,height:88,transform:'scale(2)',margin:44}}><JoystickSprite attention/></div><p style={{textAlign:'center',fontSize:12}}>Enlarged detail</p></div>
   <div><div className="v3-tab-play" data-joystick-pressed={pressed}><JoystickSprite attention/></div><p style={{textAlign:'center',fontSize:12}}>Menu size</p></div>
  </div>
  <div style={{display:'flex',flexWrap:'wrap',gap:16}}>
   <button type="button" className="pn-press shape-chunky-tilted intent-primary size-md" onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);setPressed(true)}} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} onKeyDown={event=>{if(event.key===' '||event.key==='Enter'){event.preventDefault();setPressed(true)}}} onKeyUp={release} onBlur={release}><span className="pn-press-skirt"/><span className="pn-press-face">Press and hold</span></button>
   <button type="button" className="pn-press shape-chunky-tilted intent-ghost size-md" onClick={replay}><span className="pn-press-skirt"/><span className="pn-press-face">Replay tap</span></button>
  </div>
 </main>
}
