'use client'
import GuacaCoin from '@/components/GuacaCoin'
import {useVisibleWalletMotion} from './useVisibleWalletMotion'
import styles from './PlayerWallet.module.css'
export default function ProfileWalletBalance({walletKey,balance,locale}:{walletKey?:string;balance:number;locale:string}){
 const motion=useVisibleWalletMotion(walletKey,balance)
 return <div ref={motion.ref} style={{position:'relative',display:'inline-flex'}}>
  <strong><GuacaCoin size={30}/>{Math.round(motion.amount??balance).toLocaleString(locale)}</strong>
  {motion.direction&&<span className={styles.trail} data-direction={motion.direction} aria-hidden="true">{Array.from({length:motion.direction==='gain'?5:3},(_,i)=><span key={i} className={styles.flying} style={{animationDelay:`${i*100}ms`}}><GuacaCoin size={22}/></span>)}</span>}
 </div>
}
