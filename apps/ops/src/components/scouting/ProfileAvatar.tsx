'use client'
import {useState} from 'react'
import {Icon} from '@/components/IconSprite'
import type {Person} from '@/lib/scouting/intelligence/model'
import styles from '@/app/(scouting)/scouting/players/intelligence.module.css'
export function Country({code}:{code:string|null}){const [failed,setFailed]=useState(false);const valid=!!code&&/^[a-z]{2}$/i.test(code);let name='Country not recorded';if(valid){try{name=new Intl.DisplayNames(['en'],{type:'region'}).of(code!.toUpperCase())||name}catch{}}return <span className={styles.country} title={name}>{valid&&!failed?<img src={`/flags/${code!.toLowerCase()}.png`} alt={name} onError={()=>setFailed(true)}/>:<><Icon id="flag"/><span>{name}</span></>}</span>}
export function Avatar({p,large=false}:{p:Person;large?:boolean}){const [failed,setFailed]=useState(false);return <span className={`${styles.avatarShell} ${large?styles.avatarShellLarge:''}`}><span data-profile-avatar="" className={`${styles.avatar} ${large?styles.large:''}`}>{p.avatar_url&&!failed?<img src={p.avatar_url} alt="" onError={()=>setFailed(true)}/>:<span aria-hidden="true">{p.name.split(/\s+/).slice(0,2).map(x=>x[0]).join('')}</span>}</span>{p.country&&<span className={styles.avatarFlag}><Country code={p.country}/></span>}</span>}
