'use client'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import styles from './PredictionRate.module.css'
export default function PredictionRate({userId, metric=false}:{userId:string;metric?:boolean}) {
  const t=useTranslations('predictionRate')
  const [result,setResult]=useState<{correct:number;settled:number;percent:number|null}|null>(null)
  const [failed,setFailed]=useState(false)
  useEffect(()=>{
    const controller=new AbortController()
    setResult(null);setFailed(false)
    fetch(`/api/play/players/stats?userId=${encodeURIComponent(userId)}`,{signal:controller.signal,cache:'no-store'})
      .then(async r=>{if(!r.ok)throw Error();return r.json()})
      .then(d=>{if(!controller.signal.aborted)setResult(d)})
      .catch(()=>{if(!controller.signal.aborted)setFailed(true)})
    return()=>controller.abort()
  },[userId])
  const value=result?.percent!=null?`${result.percent}%`:'—'
  const description=failed?t('unavailable'):!result?t('loading'):result.settled?t('label'):t('empty')
  if(metric) return <strong aria-label={`${description}: ${value}`} title={`${description}: ${value}`}>{value}</strong>
  return <span className={styles.rate} aria-label={`${description}: ${value}`} title={`${description}: ${value}`}>
    <span aria-hidden="true">✓</span> {value}
  </span>
}
