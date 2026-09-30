'use client'
import Image from 'next/image'
import {Capacitor} from '@capacitor/core'
import {shareAvatarFile,isAvatarShareCancelled,AvatarShareUpdateRequired} from '@/lib/share-avatar-file'
import {useRef,useState,useEffect,type FormEvent,type RefObject} from 'react'
import {useLocale,useTranslations} from 'next-intl'
import {avatarShareFile,type AvatarShareFormat,type AvatarShareBackground} from '@/lib/avatar-share'
import styles from './PlayerProfile.module.css'

export default function AvatarShare({stage,compact=false}:{stage:RefObject<HTMLDivElement|null>;compact?:boolean}) {
  const t=useTranslations('avatarSharing')
  const es=useLocale()==='es'
  const [format,setFormat]=useState<AvatarShareFormat>('full')
  const [background,setBackground]=useState<AvatarShareBackground>('court')
  const dialog=useRef<HTMLDialogElement>(null)
  const [file,setFile]=useState<File|null>(null)
  const [url,setUrl]=useState('')
  const [downloadData,setDownloadData]=useState('')
  const [saved,setSaved]=useState(false)
  const [copied,setCopied]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState(false)
  const [sharing,setSharing]=useState(false)
  const [shareUnavailable,setShareUnavailable]=useState(false)
  const [needsUpdate,setNeedsUpdate]=useState(false)
  const native=Capacitor.isNativePlatform()
  const [downloadRequested,setDownloadRequested]=useState(false)
  const generation=useRef(0)
  useEffect(()=>()=>{generation.current++},[])
  useEffect(()=>()=>{if(url)URL.revokeObjectURL(url)},[url])
  useEffect(()=>{
    const root=stage.current
    if(!root)return
    let timer:ReturnType<typeof setTimeout>
    const warm=()=>{clearTimeout(timer);timer=setTimeout(()=>{const svg=root.querySelector<SVGSVGElement>('[data-avatar-art] svg');if(svg)void avatarShareFile(svg,'full').catch(()=>{})},700)}
    const observer=new MutationObserver(warm)
    observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['href','viewBox','transform','d']})
    warm()
    return()=>{clearTimeout(timer);observer.disconnect()}
  },[stage])
  async function prepare(nextFormat:AvatarShareFormat=format,nextBackground:AvatarShareBackground=background){
    setBackground(nextBackground)
    setFormat(nextFormat);setDownloadRequested(false);setSaved(false);setCopied(false);setShareUnavailable(false)
    dialog.current?.showModal(); setBusy(true);setError(false);setFile(null);setUrl('');setDownloadData('')
    const attempt=++generation.current
    try {
      const svg=stage.current?.querySelector<SVGSVGElement>('[data-avatar-art] svg')
      if(!svg)throw new Error()
      const image=await avatarShareFile(svg,nextFormat,nextBackground)
      const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(image)})
      if(attempt===generation.current){setFile(image);setUrl(URL.createObjectURL(image));setDownloadData(data)}
    }catch{if(attempt===generation.current)setError(true)}
    finally{if(attempt===generation.current)setBusy(false)}
  }
  async function share(){
    if(!file || sharing)return
    setShareUnavailable(false);setNeedsUpdate(false)
    setSharing(true);setError(false)
    try{await shareAvatarFile(file,downloadData)}
    catch(e){if(e instanceof AvatarShareUpdateRequired)setNeedsUpdate(true);else if(!isAvatarShareCancelled(e))setShareUnavailable(true)}
    finally{setSharing(false)}
  }
  async function download(event:FormEvent<HTMLFormElement>){
    if((event.nativeEvent as SubmitEvent).submitter?.getAttribute('name')==='display')return
    const picker=(window as Window & {showSaveFilePicker?: (options:unknown)=>Promise<{createWritable:()=>Promise<{write:(data:Blob)=>Promise<void>;close:()=>Promise<void>}>}>}).showSaveFilePicker
    setDownloadRequested(true)
    if(!picker||!file)return // Standard attachment opens visibly in a separate tab.
    event.preventDefault()
    setError(false)
    try{
      const handle=await picker({suggestedName:file.name,types:[{description:'PNG image',accept:{'image/png':['.png']}}]})
      const writable=await handle.createWritable();await writable.write(file);await writable.close();setSaved(true)
    }catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))setError(true)}
  }
  async function copyImage(){
    if(!file)return
    setError(false)
    try{await navigator.clipboard.write([new ClipboardItem({'image/png':file})]);setCopied(true)}catch{setError(true)}
  }
  return <>
    <button type="button" className={`${styles.avatarShareButton} ${compact?styles.compactShareButton:''}`} aria-label={t('title')} title={t('title')} onClick={()=>void prepare('full','court')}><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></svg><span>{t('title')}</span></button>
    <dialog ref={dialog} className={`${styles.dialog} ${styles.shareDialog}`} style={{pointerEvents:'auto'}} aria-label={t('title')}>
      <div className={styles.shareContent}>
        <div className={styles.row}><h2>{t('title')}</h2><button className={styles.close} aria-label={t('close')} onClick={()=>dialog.current?.close()}>×</button></div>
        <div className={styles.shareFormats}>
          <span>{format==='full'?(es?'Avatar completo':'Full avatar'):(es?'Foto de perfil':'Profile picture')}</span>
          <button type="button" disabled={busy} onClick={()=>void prepare(format==='full'?'portrait':'full')}>{format==='full'?(es?'Ver foto de perfil':'Try profile picture'):(es?'Volver al avatar completo':'Back to full avatar')}</button>
        </div>
        <div className={styles.shareFormats}><span>{background==='court'?(es?'Pista de pádel':'Padel court'):(es?'Fondo transparente':'Transparent background')}</span><button type="button" disabled={busy} onClick={()=>void prepare(format,background==='court'?'transparent':'court')}>{background==='court'?(es?'Usar transparente':'Use transparent'):(es?'Usar pista':'Use court')}</button></div>
        {busy&&<p role="status" className={styles.note}>{t('preparing')}</p>}
        {url&&<Image src={url} alt={t('preview')} width={1080} height={format==='portrait'?1080:1440} unoptimized className={styles.sharePreview}/>}
        {error&&<p role="alert" className={styles.photoError}>{t('error')}</p>}
        {error&&!file&&<button className={styles.secondary} onClick={()=>void prepare()}>{t('retry')}</button>}
        {file&&<div className={styles.shareActions}>
          <button type="button" className={styles.downloadAvatar} disabled={sharing} onClick={()=>void share()}>{t('share')}</button>
          {needsUpdate&&<p role="status" className={styles.note}>{es?'Compartir el avatar requiere la próxima actualización de la app.':'Sharing your avatar requires the next app update.'}</p>}
          {native&&<p className={styles.note}>{es?'Elige WhatsApp u otra app, o una opción para guardar, en el menú del teléfono.':'Choose WhatsApp, another app, or a save option in your phone’s share menu.'}</p>}
          {shareUnavailable&&<p role="status" className={styles.note}>{es?'Este navegador no puede compartir la imagen. Abre Padel Nachos en Safari o Chrome mediante HTTPS, o guarda la imagen abajo.':'This browser cannot share the image. Open Padel Nachos in Safari or Chrome over HTTPS, or save the image below.'}</p>}
          {!native&&<details><summary>{es?'Guardar imagen y otras opciones':'Save image and other options'}</summary>
          <form method="post" action="/api/play/avatar/download" target="_blank" rel="noopener" onSubmit={download}>
            <input type="hidden" name="image" value={downloadData}/><input type="hidden" name="format" value={format}/>
            <button type="submit" className={styles.downloadAvatar}>{t('download')}</button>
            <button type="submit" name="display" value="inline" className={styles.secondary} formAction="/api/play/avatar/download?display=inline">{es?'Abrir imagen para guardar':'Open image to save'}</button>
          </form>
          {typeof ClipboardItem!=='undefined'&&typeof navigator!=='undefined'&&typeof navigator.clipboard?.write==='function'&&<button className={styles.secondary} onClick={()=>void copyImage()}>{copied?(es?'Copiada: pega en WhatsApp':'Copied: paste in WhatsApp'):(es?'Copiar imagen para WhatsApp':'Copy image for WhatsApp')}</button>}
          <p className={styles.note}>{saved?(es?'Imagen guardada.':'Image saved.'):es?'Si WhatsApp no aparece al compartir, copia la imagen y pégala en el chat, o guarda el PNG y adjúntalo.':'If WhatsApp is missing from the share menu, copy the image and paste it into your chat, or save the PNG and attach it.'}</p>
          {downloadRequested&&!saved&&<p role="status" className={styles.note}>{es?'Si la descarga no empieza, usa «Abrir imagen para guardar» y mantén pulsada la imagen o haz clic derecho para guardarla.':'If the download does not start, use “Open image to save”, then long-press or right-click the image to save it.'}</p>}
          </details>}
        </div>}

      </div>
    </dialog>
  </>
}
