'use client'
import {useEffect,useState} from 'react'
import styles from './JoystickSprite.module.css'

/** Registered atlas cells: fixed base, moving shaft, and independent button. */
export default function JoystickSprite({attention=false}:{attention?:boolean}){
 const [visible,setVisible]=useState(false)
 useEffect(()=>{
  const update=()=>setVisible(document.visibilityState==='visible')
  update();document.addEventListener('visibilitychange',update)
  return()=>document.removeEventListener('visibilitychange',update)
 },[])
 return <span className={`${styles.joystick}${attention&&visible?` ${styles.attention}`:''}`} aria-hidden="true">
  <span className={`${styles.layer} ${styles.base}`}/>
  <span className={`${styles.layer} ${styles.shaft}`}/>
  <span className={`${styles.layer} ${styles.button}`}/>
 </span>
}
