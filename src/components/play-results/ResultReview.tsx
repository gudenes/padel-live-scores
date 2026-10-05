'use client'
import {useState} from 'react'
import {useLocale} from 'next-intl'
import ResultPanel from './ResultPanel'
import {Press} from '@/app/[locale]/(app)/play/_components/shared'
import type {ResultPanelData} from '@/lib/play-result-panel'
const example:ResultPanelData={id:'preview',marketId:'preview',question:'¿Ganarán Coello / Tapia?',match:'Coello / Tapia vs Galán / Chingotto',context:'Madrid P1 · Masculino · SF',side:'yes',kind:'won',paid:380,cost:200,delta:380}
export default function ResultReview(){
 const es=useLocale()==='es'
 const [bulk,setBulk]=useState(true)
 const [kind,setKind]=useState<ResultPanelData['kind']>('won'),[open,setOpen]=useState(true),[viewed,setViewed]=useState(false)
 const result={...example,question:es?example.question:'Will Coello / Tapia win?',context:es?example.context:'Madrid P1 · Men · SF',kind,paid:kind==='lost'?0:kind==='refunded'?200:380,delta:kind==='corrected'?-180:380}
 return <main style={{minHeight:'100dvh',background:'#171918',padding:'24px 18px',color:'#eee9d7'}}>
 <img src="/padelnachos-logo-v2.png" alt="Padel Nachos" width={96}/><h1 style={{fontSize:24,margin:'30px 0 12px'}}>{es?'Mis jugadas':'My plays'}</h1><p style={{color:'#a9bec9'}}>{es?'Vista de prueba · no cambia tu saldo':'Preview · your balance stays unchanged'}</p>
 <div style={{display:'flex',gap:8,flexWrap:'wrap',margin:'24px 0'}}>{(['won','lost','refunded','corrected'] as const).map((k,i)=><Press key={k} size="size-sm" intent={kind===k?'intent-primary':'intent-neutral'} onClick={()=>{setBulk(false);setKind(k);setOpen(true);setViewed(false)}}>{(es?['Acierto','Fallo','Devolución','Corrección']:['Correct','Incorrect','Refund','Correction'])[i]}</Press>)}<Press size="size-sm" onClick={()=>{setBulk(true);setOpen(true)}}>{es?'Varios resultados':'Multiple results'}</Press></div>
 <section style={{padding:20,border:'1px solid #42503e',background:'#202824'}}><small>MADRID P1 · MASCULINO · SF</small><h2 style={{fontSize:18,marginTop:12}}>{example.match}</h2><p>{result.question}</p><p style={{color:'#94dd32',fontSize:26,marginTop:16}}>200 → {result.paid} Guacas</p>{viewed&&<p role="status">{es?'Resultado seleccionado':'Result selected'}</p>}</section>
 <div style={{marginTop:20}}><Press onClick={()=>setOpen(true)}>{es?'Ver notificación':'Show notification'}</Press></div>
 {open&&<ResultPanel preview result={result} results={bulk?[{...result,kind:'won',paid:380},{...result,id:'loss',marketId:'loss',question:es?'¿Habrá 3 sets?':'Will this match go to 3 sets?',kind:'lost',paid:0,delta:0},{...result,id:'refund',marketId:'refund',question:es?'¿Ganarán Yanguas / Nieto?':'Will Yanguas / Nieto win?',match:'Yanguas / Nieto vs Stupaczuk / Sanz',kind:'refunded',paid:200,delta:200}]:undefined} onClose={()=>setOpen(false)} onView={()=>{setOpen(false);setViewed(true)}}/>}
 </main>
}
