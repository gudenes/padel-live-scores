'use client'
import {useState} from 'react'
import GlobalHeader from '@/components/nav/GlobalHeader'
import PlayerWallet from '@/components/nav/PlayerWallet'
import PressButton,{PRESS_PRESETS} from '@/components/PressButton'
export default function Preview(){
 const [balance,setBalance]=useState(6780)
 return <main style={{background:'#191d17',color:'#eee9d7',minHeight:'100dvh'}}>
  <GlobalHeader playerWallet={<PlayerWallet walletKey="motion-preview:demo-v1" balance={balance} onPositions={()=>{}}/>}/>
  <div style={{padding:24}}><p style={{color:'#a3d774',fontSize:11,letterSpacing:2}}>COIN TRAIL · IMPLEMENTED</p><h1 style={{fontSize:25}}>Watch your header.</h1><p style={{fontSize:14,lineHeight:1.6,color:'#b4beaa'}}>This uses the actual app wallet. Only coins and the balance animate—no extra amount underneath.</p>
  <div style={{display:'flex',gap:14,flexWrap:'wrap',marginTop:28}}>
   <PressButton {...PRESS_PRESETS.chunkyTilted} onClick={()=>setBalance(v=>v+380)}>Add 380</PressButton>
   <PressButton {...PRESS_PRESETS.chunkyTeamOrange} onClick={()=>setBalance(v=>Math.max(0,v-120))}>Remove 120</PressButton>
  </div><p style={{marginTop:26,color:'#a0ac95',fontSize:12}}>Local demo balance only. Your account is unchanged.</p></div>
 </main>
}
