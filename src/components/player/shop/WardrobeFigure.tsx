'use client'
import Image from 'next/image'
import {useId} from 'react'
import {SHOP_AVATARS,SHOP_SLOTS,SHOP_ITEMS,PHOTO_HAT_PATHS,gearArtwork,wardrobeBody,type ShopItem,type ShopState} from '@/lib/avatar-shop'
import {AVATAR_HEAD_PATH,PRESET_HEAD_PATH,AVATAR_FACE_PATH,capHairEnvelope} from '@/lib/avatar-layers'
import styles from './AvatarShop.module.css'

export function Figure({state,preview,original,portrait=false,imageUrl}:{state:ShopState;preview:ShopItem|null;original:boolean;portrait?:boolean;imageUrl?:string}) {
 const id=useId().replace(/:/g,'')
 const outfit={...state.equipped,...(!original&&preview?{[preview.slot]:preview.id}:{})}
 const sticker=SHOP_ITEMS.find(i=>i.id===outfit.sticker)
 const custom=state.avatar.startsWith('custom:')
 const body=wardrobeBody(state.avatar)
 const headPath=custom?AVATAR_HEAD_PATH:PRESET_HEAD_PATH
 const hatItem=SHOP_ITEMS.find(i=>i.id===outfit.hat)
 const hat=hatItem?.collection??'starter'
 const hairEnvelope=capHairEnvelope(hatItem?.id)
 const headSource=imageUrl??gearArtwork(state.avatar,'starter')
 const hairMask=hairEnvelope?`url(#${id}-cap-hair)`:undefined
 const shoes=SHOP_ITEMS.find(i=>i.id===outfit.shoes)?.collection??'starter'
 return <div className={portrait?styles.portrait:styles.figure}>
 <svg viewBox={portrait?"200 0 620 650":"40 0 860 1480"} role="img" aria-label={`${SHOP_AVATARS.find(a=>a.id===state.avatar)?.name??'Your player'} outfit preview`}>
 <defs>
 <mask id={`${id}-cap-hair`} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1536"><path d={hairEnvelope??'M0 0H1024V1536H0Z'} fill="white"/></mask>
 <mask id={`${id}-body-only`} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1536"><rect width="1024" height="1536" fill="white"/><path d={headPath} fill="black"/><rect y="1200" width="1024" height="336" fill="black"/></mask>
 <mask id={`${id}-rear-hair`} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1536"><path d={headPath} fill="white"/><path d={AVATAR_FACE_PATH} fill="black"/></mask>
 <clipPath id={`${id}-face`}><path d={AVATAR_FACE_PATH}/></clipPath>
 <clipPath id={`${id}-head`}><path d={headPath}/></clipPath>
 <clipPath id={`${id}-brim-back`}><path d="M0 315H360V460H0Z"/></clipPath>
 <mask id={`${id}-cap-front`} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1536"><rect width="1024" height="1536" fill="white"/><path d="M0 315H360V460H0Z" fill="black"/></mask>
 {SHOP_SLOTS.filter(s=>s.id!=='sticker').map(s=><clipPath id={`${id}-${s.id}`} key={s.id}><path d={s.id==='hat'?PHOTO_HAT_PATHS[hat]:s.path}/></clipPath>)}
 </defs>
 <image href={gearArtwork(body,'starter')} width="1024" height="1536" mask={`url(#${id}-body-only)`}/>
 <g mask={hairMask}><image href={headSource} width="1024" height="1536" mask={`url(#${id}-rear-hair)`}/></g>
 {hatItem?.id==='hat-backwards'&&<g clipPath={`url(#${id}-brim-back)`}><image href={hatItem.image} {...hatItem.headwear} preserveAspectRatio="none"/></g>}
 {SHOP_SLOTS.filter(s=>s.id!=='sticker'&&s.id!=='hat').map(s=>{const item=SHOP_ITEMS.find(i=>i.id===(outfit[s.id]??`${s.id}-starter`));return item&&(item.collection!=='starter'||s.id==='shorts'||s.id==='shirt')?<image key={s.id} href={gearArtwork(body,item.collection)}  width="1024" height="1536" clipPath={`url(#${id}-${s.id})`}/>:null})}
 {/* Restore the original face above wardrobe cutouts; rear brim stays behind it. */}
 <g clipPath={`url(#${id}-head)`}><image mask={hairMask} href={headSource} width="1024" height="1536" clipPath={`url(#${id}-face)`}/></g>
 {hatItem?.headwear&&hatItem.image?<g mask={hatItem.id==='hat-backwards'?`url(#${id}-cap-front)`:undefined}><image href={hatItem.image} {...hatItem.headwear} preserveAspectRatio="none"/></g>:hat!=='starter'&&<image href={gearArtwork('face-06',hat)} width="1024" height="1536" transform={hat==='club'||hat==='champion'?'translate(35 55) scale(.94)':custom?'translate(55 25) scale(.9)':undefined} clipPath={`url(#${id}-hat)`}/>}
 <image href={`/play/avatars/shop/shoes/${shoes}-nachos.webp`} width="1024" height="1536" clipPath={`url(#${id}-shoes)`}/>
 </svg>
 {!portrait&&sticker&&<Image className={styles.wornSticker} src={sticker.image!} alt={sticker.name} width={120} height={120} unoptimized/>}
 </div>
}
