'use client'
import {Figure} from './WardrobeFigure'
import AvatarShare from '../AvatarShare'

import Image from 'next/image'
import {useShopWardrobe} from '@/hooks/useShopWardrobe'
import {useLocale} from 'next-intl'
import {useAuth} from '@/components/AuthProvider'
import PhotoAvatarCreator from '../PhotoAvatarCreator'
import {useEffect,useId,useMemo,useRef,useState,useSyncExternalStore} from 'react'
import GuacaCoin from '@/components/GuacaCoin'
import {PlayerAvatar} from '@/components/PlayerAvatar'
import {SHOP_AVATARS,SHOP_SLOTS,SHOP_ITEMS,PHOTO_HAT_PATHS,gearArtwork,wardrobeBody,parseShopState,purchaseItem,equipItem,type ShopItem,type ShopState,type ShopSlot} from '@/lib/avatar-shop'
import styles from './AvatarShop.module.css'
import gameMotion from '@/components/GameMotion.module.css'
import {AVATAR_HEAD_PATH,PRESET_HEAD_PATH,AVATAR_FACE_PATH,capHairEnvelope} from '@/lib/avatar-layers'

const KEY='pn:avatar-shop:preview:v1', EVENT='pn-shop-preview'
function subscribe(fn:()=>void){window.addEventListener(EVENT,fn);window.addEventListener('storage',fn);return()=>{window.removeEventListener(EVENT,fn);window.removeEventListener('storage',fn)}}
function snapshot(){try{return localStorage.getItem(KEY)}catch{return null}}
function Picture({item}: {item:ShopItem}) {
 const clipId=`product-${useId().replace(/:/g,'')}`
 if(item.image)return <Image src={item.image} alt="" width={160} height={160} unoptimized />
 if(item.slot==='hat'&&item.collection==='starter')return <span className={styles.noAccessory} aria-hidden="true">No hat</span>
 const index=SHOP_SLOTS.findIndex(s=>s.id===item.slot)
 // Product-only atlas: racket, shoes, shorts / shirt, wristband, hat.
 // Clip the atlas cell itself: a rectangular SVG viewport can expose neighboring cells.
 return <svg viewBox={`${index%3} ${Math.floor(index/3)} 1 1`} aria-hidden="true" overflow="hidden"><defs><clipPath id={clipId}><rect x={index%3} y={Math.floor(index/3)} width="1" height="1"/></clipPath></defs><image clipPath={`url(#${clipId})`} href={`/play/avatars/shop/products/${item.collection}-clean-v2.webp`} width="3" height="2" preserveAspectRatio="none" /></svg>
}
export {Figure} from './WardrobeFigure'

export default function AvatarShop(){
 const {profile,user,loading:authLoading}=useAuth()
 const locale=useLocale()
 const es=locale==='es'
 const slotLabels:Record<ShopSlot,string>={racket:'Pala',shoes:'Zapatillas',shorts:'Pantalón',shirt:'Camiseta',wrist:'Muñequera',hat:'Gorra',sticker:'Pegatinas'}
 const [savedName,setSavedName]=useState<string|null>(null)
 const displayName=savedName??profile?.display_name?.trim()??(es?'Mi jugador':'My player')
 const nameDialog=useRef<HTMLDialogElement>(null)
 const [nameDraft,setNameDraft]=useState('')
 const [nameError,setNameError]=useState('')
 const [savingName,setSavingName]=useState(false)
 const [motion,setMotion]=useState(0)
 async function saveName(e:React.FormEvent){
  e.preventDefault();if(savingName||!nameDraft.trim())return
  if(!user){setNameError(es?'Inicia sesión para guardar tu nombre.':'Sign in to save your name.');return}
  setSavingName(true);setNameError('')
  try{const response=await fetch('/api/user/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({display_name:nameDraft.trim()})});if(response.status===401)throw new Error(es?'Tu sesión ha caducado. Inicia sesión de nuevo para guardar tu nombre.':'Your session has expired. Sign in again to save your name.');if(!response.ok)throw new Error(es?'No se pudo guardar tu nombre. Inténtalo de nuevo.':'Could not save your name. Try again.');setSavedName(nameDraft.trim());window.dispatchEvent(new Event('pn:profile-updated'));nameDialog.current?.close();setNotice(es?'Nombre actualizado.':'Name updated.')}catch(e){setNameError((e as Error).message)}finally{setSavingName(false)}
 }
 const raw=useSyncExternalStore(subscribe,snapshot,()=>null)
 const localState=useMemo(()=>parseShopState(raw),[raw])
 const remote=useShopWardrobe(process.env.NODE_ENV==='production')
 const state:ShopState=process.env.NODE_ENV==='production'?(remote.data??{...localState,balance:0,owned:[],equipped:{},avatar:'face-06' as const}):localState
 const exportStage=useRef<HTMLDivElement>(null)
 const [slot,setSlot]=useState<ShopSlot>('hat')
 const [selected,setSelected]=useState('hat-club')
 const [compare,setCompare]=useState(false)
 const wins=process.env.NODE_ENV==='production'?(remote.data?.wins??0):0
 const [savedAvatars,setSavedAvatars]=useState<ShopState['avatar'][]>([])
 const [savedError,setSavedError]=useState(false)
 useEffect(()=>{let active=true;fetch('/api/play/avatar/saved').then(async response=>{if(!response.ok)throw Error();return response.json()}).then(data=>{if(active){setSavedError(false);setSavedAvatars((data.avatars??[]).filter((value:unknown)=>typeof value==='string'&&/^custom:[a-f0-9-]{36}$/.test(value)))}}).catch(()=>{if(active)setSavedError(true)});return()=>{active=false}},[profile?.id])
 const [picker,setPicker]=useState<'characters'|'photo'|null>(null)
 const chooser=useRef<HTMLDialogElement>(null)
 const [notice,setNotice]=useState('')
 useEffect(()=>{if(!notice){return}const timer=window.setTimeout(()=>setNotice(''),6500);return()=>window.clearTimeout(timer)},[notice])
 const [processing,setProcessing]=useState(false)
 const purchaseLock=useRef(false)
 const purchaseTimer=useRef<ReturnType<typeof setTimeout>|null>(null)
 useEffect(()=>()=>{if(purchaseTimer.current)clearTimeout(purchaseTimer.current)},[])
 const [purchaseError,setPurchaseError]=useState('')
 const [purchased,setPurchased]=useState<ShopItem|null>(null)
 const [noticeItem,setNoticeItem]=useState<ShopItem|null>(null)
 const [celebration,setCelebration]=useState(0)
 const [pending,setPending]=useState<ShopItem|null>(null)
 const dialog=useRef<HTMLDialogElement>(null)
 const rail=useRef<HTMLDivElement>(null)
 const item=SHOP_ITEMS.find(i=>i.id===selected)!
 const owned=state.owned.includes(item.id), locked=!owned&&wins<item.wins
 const worn=(state.equipped[item.slot]??`${item.slot}-starter`)===item.id
 const visible=SHOP_ITEMS.filter(i=>i.slot===slot)
 const enough=state.balance>=item.price
 async function persist(next:ShopState){try{if(process.env.NODE_ENV==='production'){if(next.avatar!==state.avatar)await remote.update('avatar',undefined,next.avatar);else{const change=SHOP_SLOTS.find(slot=>next.equipped[slot.id]!==state.equipped[slot.id]);if(change)await remote.update(change.id==='sticker'&&!next.equipped.sticker?'remove_sticker':'equip',next.equipped[change.id]);}return true}localStorage.setItem(KEY,JSON.stringify(next));window.dispatchEvent(new Event(EVENT));return true}catch{setNotice(es?'No se pudo guardar. Inténtalo de nuevo.':'Could not save. Please try again.');return false}}
 function pick(next:ShopItem){setSelected(next.id);setCompare(false);setMotion(n=>n+1)}
 function category(next:ShopSlot){setSlot(next);const first=SHOP_ITEMS.find(i=>i.slot===next);if(first)pick(first);rail.current?.scrollTo({left:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})}

 function closePurchase(){if(purchaseLock.current)return;dialog.current?.close();setPending(null);setPurchased(null);setPurchaseError('')}
 function confirm(){
  if(!pending||purchaseLock.current)return
  purchaseLock.current=true;setProcessing(true);setPurchaseError('')
  const buying=pending
  // Let the processing state paint; use the latest balance at commit time.
  purchaseTimer.current=setTimeout(async()=>{
   try{
    const next=process.env.NODE_ENV==='production'?await remote.update('buy',buying.id):purchaseItem(parseShopState(snapshot()),buying.id,wins)
    if(process.env.NODE_ENV!=='production'&&!await persist(next))throw Error(es?'No se pudo guardar. Inténtalo de nuevo.':'Could not save. Please try again.')
    setPurchased(buying);setPending(null)
   }catch(e){const code=(e as Error).message;setPurchaseError(code==='insufficient_balance'?(es?'No tienes suficientes Guacas.':'Not enough Guacas.'):code==='performance_locked'?(es?'Todavía no has alcanzado este objetivo.':'This milestone has not been reached yet.'):(es?'No se pudo completar la compra. Inténtalo de nuevo.':'Could not complete the purchase. Please try again.'))}
   finally{purchaseLock.current=false;setProcessing(false);purchaseTimer.current=null}
  },180)
 }
 async function action(){if(purchaseLock.current||locked||!visible.length)return;if(owned){try{if(await persist(equipItem(state,item.id))){setMotion(n=>n+1);setCelebration(n=>n+1);setNoticeItem(item);setNotice(`${item.name} · ${es?'Equipado':'Equipped'}.`)}}catch(e){setNoticeItem(null);setNotice((e as Error).message)}}else if(enough){setPurchaseError('');setPurchased(null);setPending(item);dialog.current?.showModal()}}
 const empty=visible.length===0
 if(process.env.NODE_ENV==='production'&&!remote.data)return <main data-avatar-shop className={styles.shop}><p role="status">{remote.failed?(es?'No se pudo cargar el vestuario.':'Could not load your wardrobe.'):(es?'Cargando tu vestuario…':'Loading your wardrobe…')}</p>{remote.failed&&<button onClick={remote.reload}>{es?'Reintentar':'Try again'}</button>}</main>
 return <main data-avatar-shop className={styles.shop}>
 <header className={styles.header}><a href="profile" aria-label={es?'Volver al perfil':'Back to profile'}>‹</a><div className={styles.editorIdentity}><small>{es?'TU JUGADOR':'YOUR PLAYER'}</small><h1>{displayName}</h1><button className={styles.editName} onClick={()=>{setNameDraft(displayName);setNameError('');nameDialog.current?.showModal()}}>{es?'Editar nombre':'Edit name'}</button></div><div key={state.balance} className={`${styles.wallet} ${celebration?gameMotion.pulse:''}`}><GuacaCoin size={25}/><strong>{state.balance.toLocaleString('en-US')}</strong></div></header>
 <div className={styles.editorActions}><button onClick={()=>{setPicker('characters');chooser.current?.showModal()}}><PlayerAvatar outfit={state.avatar} size={28}/><span>{es?'Cambiar personaje':'Change character'} <small>{es?'Ver los 10':'See all 10'}</small></span><span aria-hidden>⌄</span></button><button onClick={()=>{setPicker('photo');chooser.current?.showModal()}}>{es?'Crear con una foto':'Create from a photo'} <span aria-hidden>＋</span></button></div>
 <div hidden ref={exportStage}><div data-avatar-art><Figure state={state} preview={null} original={false}/></div></div>
 <div className={styles.stage}>
 <AvatarShare stage={exportStage} compact/>
 {celebration>0&&<span key={celebration} className={styles.equipHalo} aria-hidden="true"/>}
 <div key={`${motion}-${state.avatar}-${compare}`} className={styles.tryOn}><Figure state={state} preview={empty?null:item} original={compare}/></div>
 <button className={styles.compare} aria-pressed={compare} onClick={()=>setCompare(!compare)}>{compare?(es?'Ver artículo':'Preview item'):(es?'Comparar':'Compare')}</button>
 </div>
 <div className={styles.categories} role="group" aria-label="Item categories">{SHOP_SLOTS.map(s=><button key={s.id} aria-pressed={slot===s.id} onClick={()=>category(s.id)}><span className={styles.categoryArt}><Picture item={SHOP_ITEMS.find(i=>i.slot===s.id&&(i.collection==='club'||s.id==='sticker'))!}/></span>{es?slotLabels[s.id]:s.name}</button>)}</div>
 <div key={slot} className={`${styles.items} ${gameMotion.enter}`} ref={rail} role="group" aria-label={`${slot} items`}>
 {visible.map(i=><button key={i.id} aria-label={`${i.name}${!state.owned.includes(i.id)&&wins<i.wins?' · locked':''}`} aria-pressed={selected===i.id} onClick={()=>pick(i)} className={styles.tile}>
 <Picture item={i}/><strong>{i.name}</strong><span>{state.owned.includes(i.id)?(state.equipped[i.slot]??`${i.slot}-starter`)===i.id?(es?'Equipado':'Equipped'):(es?'En propiedad':'Owned'):<><GuacaCoin size={18}/>{i.price}</>}</span>{!state.owned.includes(i.id)&&i.wins>0&&<small>{wins>=i.wins?(es?'Objetivo alcanzado':'Milestone reached'):`${i.wins} ${es?'pronósticos acertados':'correct picks'}`}</small>}
 </button>)}

 </div>
 {!empty&&<div className={styles.purchase}>
 {locked&&<div className={styles.progress}><span>{Math.min(wins,item.wins)} / {item.wins} {es?'pronósticos acertados':'correct predictions'}</span><progress value={Math.min(wins,item.wins)} max={item.wins}/><small>{es?'Alcanza este objetivo para poder comprarlo.':'Reach this milestone to unlock purchasing.'}</small></div>}
 <button className={styles.primary} disabled={locked||(owned&&worn)||(!owned&&!enough)} onClick={action}>{locked?(es?'Requiere un logro':'Performance locked'):owned?worn?(es?'Equipado ✓':'Equipped ✓'):(es?'Equipar':'Wear this'):!enough?(es?'Guacas insuficientes':'Not enough Guacas'):<>{es?'Comprar':'Unlock'} · {item.price} <GuacaCoin size={23}/></>}</button>
 <p>{compare?(es?'Tu conjunto guardado':'Your saved outfit'):`${es?'Vista previa:':'Previewing'} ${item.name}`}</p>
 {slot==='sticker'&&state.equipped.sticker&&<button className={styles.textButton} onClick={async()=>{const equipped={...state.equipped};delete equipped.sticker;if(await persist({...state,equipped}))setNotice(es?'Pegatina retirada.':'Sticker removed.')}}>{es?'Quitar pegatina':'Remove equipped sticker'}</button>}
 </div>}
 <div className={styles.toastRegion} role="status" aria-live="polite" aria-atomic="true">{notice&&<div className={styles.toast} key={notice}><>{noticeItem&&notice.startsWith(`${noticeItem.name} ·`)&&<span className={styles.toastPicture}><Picture item={noticeItem}/></span>}</><span>{notice}</span><button aria-label={es?'Cerrar aviso':'Dismiss notification'} onClick={()=>setNotice('')}>×</button></div>}</div>
 <dialog ref={nameDialog} className={styles.dialog} aria-label={es?'Editar nombre':'Edit name'} onCancel={e=>{if(savingName)e.preventDefault()}}>
 <form onSubmit={saveName} className={styles.nameForm}><h2>{es?'Tu nombre':'Your name'}</h2><label htmlFor="player-display-name">{es?'Nombre visible':'Display name'}</label><input id="player-display-name" autoFocus maxLength={40} value={nameDraft} onChange={e=>setNameDraft(e.target.value)} disabled={savingName}/><p>{authLoading?(es?'Comprobando tu sesión…':'Checking your session…'):!user?(es?'Inicia sesión para guardar el nombre en tu perfil.':'Sign in to save the name to your profile.'):(es?'Se actualizará también en tu perfil.':'This also updates your profile.')}</p>{!authLoading&&!user&&<a className={styles.sessionLink} href={`/${locale}/profile`}>{es?'Ir al perfil e iniciar sesión':'Go to profile and sign in'}</a>}{nameError&&<p role="alert">{nameError}</p>}<button className={styles.primary} disabled={savingName||authLoading||!user||!nameDraft.trim()||nameDraft.trim()===displayName}>{savingName?(es?'Guardando…':'Saving…'):(es?'Guardar nombre':'Save name')}</button><button type="button" className={styles.cancel} disabled={savingName} onClick={()=>nameDialog.current?.close()}>{es?'Cancelar':'Cancel'}</button></form>
 </dialog>
 <dialog ref={chooser} className={`${styles.dialog} ${styles.chooser}`} onClose={()=>setPicker(null)} aria-label={picker==='photo'?'Create your avatar':'Choose your character'}>
 <div className={styles.chooserHeading}><h2>{picker==='photo'?'Create your avatar':'Choose your character'}</h2><button aria-label="Close" onClick={()=>chooser.current?.close()}>×</button></div>
 {picker==='characters'&&<><p>Find your style. Your gear stays with you.</p>{savedAvatars.length>0&&<><h3>{es?'Mis avatares de foto':'My photo avatars'}</h3><div className={styles.characterGrid}>{savedAvatars.map((avatar,index)=><button key={avatar} aria-pressed={state.avatar===avatar} onClick={async()=>{if(await persist({...state,avatar})){chooser.current?.close();setNotice(es?'Tu avatar ha vuelto.':'Your avatar is back.')}}}><PlayerAvatar outfit={avatar} size={64}/><span>{es?'Mi avatar':'My avatar'}{index===0?(es?' · Reciente':' · Latest'):` ${savedAvatars.length-index}`}</span></button>)}</div></>}{savedError&&<p role="status">{es?'No se pudieron cargar tus avatares. Vuelve a abrir esta página para intentarlo de nuevo.':'Could not load your saved avatars. Refresh to try again.'}</p>}<h3>{es?'Personajes':'Characters'}</h3><div className={styles.characterGrid}>{SHOP_AVATARS.map(a=><button key={a.id} aria-pressed={state.avatar===a.id} onClick={async()=>{if(await persist({...state,avatar:a.id})){chooser.current?.close();setNotice(`${a.name} selected.`)}}}><PlayerAvatar outfit={a.id} size={64}/><span>{a.name}</span></button>)}</div><button className={styles.primary} onClick={()=>setPicker('photo')}>Create my own avatar · Photo</button></>}
 {picker==='photo'&&<PhotoAvatarCreator onPreview={async value=>{if(value.startsWith('custom:')&&await persist({...state,avatar:value as ShopState['avatar']})){chooser.current?.close();setSavedAvatars(previous=>[value as ShopState['avatar'],...previous.filter(avatar=>avatar!==value)]);setNotice('Your avatar is ready.')}}}/>}
 </dialog>
 <dialog ref={dialog} className={`${styles.dialog} ${styles.purchaseDialog}`} onCancel={e=>{if(purchaseLock.current)e.preventDefault();else{setPending(null);setPurchased(null)}}} aria-label={es?'Confirmar compra':'Confirm purchase'} aria-busy={processing}>
 {purchased?<div className={styles.reward}>
  <small><svg className={styles.rewardCheck} viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="14" pathLength="1"/><path d="m10 16 4 4 8-9" pathLength="1"/></svg>{es?'YA ES TUYO':'IT’S YOURS'}</small>
  <div className={`${styles.confirmPicture} ${styles.rewardPicture}`}><Picture item={purchased}/></div>
  <h2>{purchased.name}</h2><p>{es?'Añadido a tu vestuario y equipado.':'Added to your wardrobe and equipped.'}</p>
  <button autoFocus className={styles.primary} onClick={()=>{setMotion(n=>n+1);setNoticeItem(purchased);setNotice(`${purchased.name} · ${es?'Comprado y equipado':'Purchased and equipped'}.`);closePurchase()}}>{es?'Listo para la pista':'Ready for the court'} ✓</button>
 </div>:pending&&<><h2>{es?'Hazlo tuyo.':'Make it yours.'}</h2><div className={styles.confirmPicture}><Picture item={pending}/></div><h3>{pending.name}</h3><p>{es?'Comprar y equipar por':'Unlock and wear for'} <strong>{pending.price}</strong> <GuacaCoin size={20}/></p><p>{es?'Saldo después:':'Balance after:'} {(state.balance-pending.price).toLocaleString(locale)} Guacas</p>
 {purchaseError&&<p role="alert" className={styles.purchaseError}>{purchaseError}</p>}
 <button className={styles.primary} disabled={processing} onClick={confirm}>{processing?<><span className={styles.spinner} aria-hidden="true"/>{es?'Guardando…':'Saving…'}</>:<>{es?'Confirmar compra':'Confirm purchase'} · {pending.price} <GuacaCoin size={22}/></>}</button><button className={styles.cancel} disabled={processing} onClick={closePurchase}>{es?'Seguir mirando':'Keep browsing'}</button></>}
 </dialog>
 </main>
}

export function ShopProfileFigure({className,fallback}:{className:string;fallback:React.ReactNode}) {
 const raw=useSyncExternalStore(subscribe,snapshot,()=>null)
 const local=useMemo(()=>parseShopState(raw),[raw])
 const remote=useShopWardrobe(process.env.NODE_ENV==='production')
 const state=process.env.NODE_ENV==='production'?remote.data:raw?local:null
 if(!state)return <>{fallback}</>
 return <div className={className}><Figure state={state} preview={null} original/></div>
}

/** Header portrait follows the same saved selection as the local wardrobe/profile. */
export function ShopProfileAvatar({fallback,size}:{fallback:React.ReactNode;size:number}) {
 const raw=useSyncExternalStore(subscribe,snapshot,()=>null)
 const local=useMemo(()=>parseShopState(raw),[raw])
 const remote=useShopWardrobe(process.env.NODE_ENV==='production')
 const state=process.env.NODE_ENV==='production'?remote.data:raw?local:null
 if(!state)return <>{fallback}</>
 return <span style={{width:size,height:size,display:'block',overflow:'hidden',borderRadius:'50%',background:'#242520'}}><Figure state={state} preview={null} original portrait/></span>
}
