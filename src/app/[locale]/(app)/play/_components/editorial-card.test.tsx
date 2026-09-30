import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import messages from '@/messages/es.json'
import MarketCard from './MarketCard'
import { PLAY_STYLES } from './styles'
import { parseMarkets } from './types'
import { parseEditorialView } from '../../../../../../shared/play-editorial-view'
vi.mock('./EditorialMarketHero.module.css',()=>({default:new Proxy({}, {get:(_,key)=>String(key)})}))
vi.mock('@/i18n/navigation',()=>({Link:({href,children,...props}:any)=><a href={href} {...props}>{children}</a>}))
vi.mock('next/image',()=>({default:({fill,sizes,onError,...props}: any)=><img {...props} style={fill?{position:'absolute',width:'100%',height:'100%'}:undefined}/>}))
const base='https://jwqaesjjoghzobngxejn.supabase.co/storage/v1/object/public/avatars/'
const player=(id:string,name:string,photo:string|null=null)=>({id,name,avatarUrl:base+id+'.png',photoUrl:photo?base+photo:null,ranking:15})
const ranking={kind:'ranking',players:[player('699d9934-8407-4b9a-ae4b-b0aecc7e44c0','Javi Leal','699d9934-8407-4b9a-ae4b-b0aecc7e44c0-full.webp')],target:12,endsAt:'2026-11-30T23:59:59Z',openingProbability:.25}
const pair={kind:'titles',players:[player('978d1b86-c53f-490f-88ce-bbe1be682228','Arturo Coello','978d1b86-c53f-490f-88ce-bbe1be682228-full.png'),player('c95d2602-fb24-4b4b-9c60-40a0950a4eae','Agustín Tapia','c95d2602-fb24-4b4b-9c60-40a0950a4eae-full.webp')],target:2,completed:0,endsAt:'2026-11-30T23:59:59Z',scope:'Alemania P2 · Milano P1 · México Major'}
function render(editorial:unknown){
 const [market]=parseMarkets({markets:[{id:'example',question:'Original full rules question',horizon:'season',priceYes:.25,book:{qYes:1000*Math.log(.25),qNo:1000*Math.log(.75),b:1000},editorial}]})
 return renderToStaticMarkup(<NextIntlClientProvider locale="es" messages={messages}><article className="pl-mcard"><MarketCard market={market} onChoose={()=>{}} onDetail={()=>{}}/></article></NextIntlClientProvider>)
}
describe('editorial card',()=>{
 it('keeps ranking target and real current ranking distinct',()=>{const html=render(ranking);expect(html).toContain('TOP 12');expect(html).toContain('#15');expect(html).toContain('Javi Leal')})
 it('renders partners together, without a versus or invented title progress',()=>{const html=render({...pair,completed:null});expect(html).toContain('Arturo Coello');expect(html).toContain('Agustín Tapia');expect(html).not.toContain('<progress');expect(html).not.toContain('pl-vs')})
 it('shows recorded zero progress when supplied',()=>expect(render(pair)).toContain('value="0"'))
 it('rejects invalid progress and keeps unknown ranking unknown',()=>{const parsed=parseEditorialView({...ranking,completed:-2,players:[{...ranking.players[0],ranking:0}]});expect(parsed?.completed).toBeNull();expect(parsed?.players[0].ranking).toBeNull();expect(parseEditorialView({kind:'nonsense',players:[]})).toBeNull()})
 it('can export the actual cards for local visual review',()=>{
  if(process.env.EXPORT_EDITORIAL_PREVIEW!=='1')return
  const globalCss=readFileSync('src/app/globals.css','utf8').split('\n').slice(618,731).join('\n')
  const css=readFileSync('src/app/[locale]/(app)/play/_components/EditorialMarketHero.module.css','utf8')
  mkdirSync('output/editorial-cards',{recursive:true})
  writeFileSync('output/editorial-cards/index.html',`<!doctype html><html lang="es"><meta charset="utf-8"><base href="http://localhost:3012/"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Editorial cards — design preview</title><style>${globalCss}\n${PLAY_STYLES}\n${css}\nbody{margin:0;background:#111;color:#f1efde;font-family:Arial,sans-serif}main{display:flex;flex-wrap:wrap;gap:24px;padding:20px;justify-content:center}.pl-root{width:390px;max-width:100%;height:550px;--lime:#7ed321;--lime-skirt:#558d14;--clip-chunky:polygon(2% 0,100% 0,98% 100%,0 100%);--bg-card:#191b16;--border-card:#444b32;--text-primary:#f1efde;--text-muted:#adb49b;--accent:#ff6b2b;--yes:#ff6b2b;--no:#7ed321}.pl-mcard{position:relative;inset:auto;height:520px;width:100%;box-sizing:border-box}h1{text-align:center;font-size:14px}</style><h1>Vista previa · datos de ejemplo · no permite comprar</h1><main>${[ranking,pair].map(data=>`<div class="pl-root">${render(data)}</div>`).join('')}</main></html>`)
 })
})
