'use client'
import {useState} from 'react'
import {useLocale,useTranslations} from 'next-intl'
import Image from 'next/image'
import GuacaCoin from '@/components/GuacaCoin'
import {IdentitySetup,OnboardingGuide,type Progress} from '../play/_components/PlayOnboarding'
import MatchMarketCard from '../play/_components/MatchMarketCard'
import TradeSheet from '../play/_components/TradeSheet'
import {PLAY_STYLES} from '../play/_components/styles'
import {Press} from '../play/_components/shared'
import type {PlayMarket,PlayPlayer,Side} from '../play/_components/types'
import {previewBuy} from '../play/_components/market-preview'

const player=(name:string):PlayPlayer=>({id:null,name,surname:name.split(' ').slice(-1)[0],avatarUrl:null,country:null,ranking:null,raceRanking:null,winRate:null,totalMatches:null,titles:null,form:null})
export default function OnboardingReview(){
 const t=useTranslations('play'),locale=useLocale(),es=locale==='es'
 const [progress,setProgress]=useState<Progress>({step:'identity',name:'',avatar:'face-06'})
 const [balance,setBalance]=useState(1000)
 const [side,setSide]=useState<Side|null>(null)
 const [success,setSuccess]=useState(false),[mine,setMine]=useState(false)
 const [prediction,setPrediction]=useState<{side:Side;amount:number;payout:number}|null>(null)
 const market:PlayMarket={id:'onboarding-example',publicId:'onboarding-example',question:es?'¿Ganarán Coello / Tapia este partido?':'Will Coello / Tapia win this match?',subtitle:'Coello / Tapia vs Galán / Chingotto',horizon:'match',context:'Madrid P1 · SF',competition:'Madrid P1',roundLabel:'SF',categoryLabel:es?'Hombres':'Men',priceYes:.5,modelProb:null,baselineProb:null,live:false,stateLabel:'Open',locksAt:null,volumeGuacas:0,monogram:{a:'CT',b:'GC'},players:{pair1:[player('Arturo Coello'),player('Agustín Tapia')],pair2:[player('Alejandro Galán'),player('Federico Chingotto')]},h2h:null,subjectPair:1,resolverKey:'match.winner_is_pair',book:{qYes:0,qNo:0,b:1000}}
 const done=()=>{setProgress(p=>({...p,step:'done'}));setSuccess(false)}
 if(progress.step==='identity')return <IdentitySetup initial={progress} onSave={async(name,avatar)=>setProgress({step:'wallet',name,avatar})}/>
 return <div className="pl-root" data-onboarding={success?'success':progress.step} style={{minHeight:'100%',paddingBottom:70}}>
 <style dangerouslySetInnerHTML={{__html:PLAY_STYLES}}/>
 <header style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:16}}><Image src="/padelnachos-logo-v2.png" alt="Padel Nachos" width={90} height={49}/><span data-onboarding-wallet style={{display:'flex',gap:6,alignItems:'center'}}><GuacaCoin size={26}/><b>{balance.toLocaleString(locale)}</b></span></header>
 <div className="pl-subnav"><button onClick={()=>setMine(false)}>{t('subnav.markets')}</button><button onClick={()=>{done();setMine(true)}}>{t('subnav.mine')}</button></div>
 <p style={{fontSize:11,color:'#bac7b2',textAlign:'center',padding:8}}>{es?'Demo local · datos de ejemplo · no se guardan jugadas':'Local demo · example data · no predictions are saved'}</p>
 <div style={{padding:12}}>{mine&&prediction?<article style={{padding:18,background:'#20291e'}}><b>{t('onboarding.successTitle')}</b><p>{market.question}</p><p>{t(`deck.${prediction.side}`)} · {prediction.amount} <span aria-hidden>→</span> {prediction.payout} G</p></article>:<MatchMarketCard markets={[market]} positions={[]} onChoose={(_,choice)=>setSide(choice)} onDetail={()=>{}} onViewPositions={()=>setMine(true)}/>}</div>
 {(progress.step!=='done'||success)&&<OnboardingGuide step={success?'success':progress.step} balance={balance} hasMarkets trading={side!==null} error={false} onSkip={done} onAdvance={()=>{if(success){done();setMine(true)}else setProgress(p=>({...p,step:'prediction'}))}}/>}
 {side&&<TradeSheet market={market} side={side} initialStake={50} balance={balance} onboarding previewOnly submitting={false} error={null} onClose={()=>setSide(null)} onConfirm={(amount,choice)=>{const quote=previewBuy(market,choice,amount);if(!quote)return;setPrediction({side:choice,amount,payout:quote.payout});setBalance(value=>value-amount);setSide(null);setSuccess(true)}}/>}
 {progress.step==='done'&&<div style={{padding:16}}><Press onClick={()=>{setProgress({step:'identity',name:'',avatar:'face-06'});setBalance(1000);setPrediction(null);setMine(false)}}>{es?'Volver a empezar':'Start again'}</Press></div>}
 </div>
}
