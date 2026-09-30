'use client'
import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import styles from './PlayerProfile.module.css'

export default function AvatarCamera({ onPhoto, onClose }: { onPhoto: (file: File) => void; onClose: () => void }) {
  const t = useTranslations('playerProfile.photo')
  const video = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [capturing, setCapturing] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    let cancelled = false
    let stream: MediaStream | undefined
    alive.current = true
    const stop = () => { stream?.getTracks().forEach(track => track.stop()) }
    const timeout = window.setTimeout(() => {
      cancelled = true
      stop()
      setError('cameraTimeout')
    }, 15000)
    const loaded = () => window.clearTimeout(timeout)
    const element = video.current
    element?.addEventListener('loadeddata', loaded)
    const close = () => { stop(); onClose() }
    const hide = () => { if (document.visibilityState === 'hidden') close() }
    const dialog = video.current?.closest('dialog')
    dialog?.addEventListener('close', close)
    document.addEventListener('visibilitychange', hide)
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported')
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1024 }, height: { ideal: 1024 } } })
        if (cancelled) { stop(); return }
        if (video.current) { video.current.srcObject = stream; await video.current.play() }
      } catch (e) {
        stop()
        window.clearTimeout(timeout)
        if (!cancelled) setError(typeof e === 'object' && e !== null && 'name' in e && e.name === 'NotAllowedError' ? 'cameraDenied' : 'cameraUnavailable')
      }
    }
    void start()
    return () => { cancelled = true; alive.current = false; window.clearTimeout(timeout); element?.removeEventListener('loadeddata', loaded); stop(); dialog?.removeEventListener('close', close); document.removeEventListener('visibilitychange', hide) }
  }, [onClose])
  function capture() {
    const source = video.current
    if (!ready || capturing || !source?.videoWidth || !source.videoHeight) return
    setCapturing(true)
    const canvas = document.createElement('canvas')
    const scale = Math.min(1, 1024 / Math.max(source.videoWidth, source.videoHeight))
    canvas.width = Math.round(source.videoWidth * scale)
    canvas.height = Math.round(source.videoHeight * scale)
    const context = canvas.getContext('2d')
    if (!context) { setCapturing(false); setError('cameraUnavailable'); return }
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(blob => {
      if (!alive.current) return
      if (!blob) { setCapturing(false); setError('cameraUnavailable'); return }
      onPhoto(new File([blob], 'avatar-photo.jpg', { type: 'image/jpeg' }))
      onClose()
    }, 'image/jpeg', .9)
  }
  return <section className={styles.camera} aria-label={t('cameraPreview')}>
    <video ref={video} aria-label={t('cameraPreview')} autoPlay muted playsInline onLoadedData={() => setReady(true)} />
    {error ? <p role="alert" className={styles.photoError}>{t(error)}</p> : !ready && <p role="status" className={styles.note}>{t('cameraStarting')}</p>}
    <div className={styles.photoButtons}>
      <button type="button" className={styles.uploadButton} onClick={onClose}>{t('cameraCancel')}</button>
      <button type="button" className={styles.primary} disabled={!ready || capturing || !!error} onClick={capture}>{t('cameraCapture')}</button>
    </div>
  </section>
}
