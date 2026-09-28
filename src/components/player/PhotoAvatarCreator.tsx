'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import AvatarCamera from './AvatarCamera'
import { prepareAvatarPhoto, uploadAvatarPhoto, AvatarUploadError } from '@/lib/avatar-photo-upload'
import { AVATAR_UPLOAD_MAX_BYTES } from '@/lib/avatar-upload'
import { useTranslations } from 'next-intl'
import { parseOutfit, type PlayerOutfit } from '@/lib/player-outfit'
import { useApiResource } from '@/app/[locale]/(app)/play/_components/usePlayData'
import styles from './PlayerProfile.module.css'

export default function PhotoAvatarCreator({ onPreview }: { onPreview: (outfit: PlayerOutfit) => void }) {
  const t = useTranslations('playerProfile.photo')
  const settings = useApiResource('/api/play/avatar', (data: unknown) => (data as { enabled?: boolean }).enabled === true)
  const [camera, setCamera] = useState(false)
  const closeCamera = useCallback(() => setCamera(false), [])
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const photoUrl = useRef<string | null>(null)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => { request.current?.abort(); if (photoUrl.current) URL.revokeObjectURL(photoUrl.current) }, [])
  function select(next?: File) {
    if (!next || busy) return
    setError('')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type)) { setError(t('invalid_photo')); return }
    if (next.size > AVATAR_UPLOAD_MAX_BYTES) { setError(t('photo_too_large')); return }
    if (photoUrl.current) URL.revokeObjectURL(photoUrl.current)
    photoUrl.current = URL.createObjectURL(next)
    setPreview(photoUrl.current); setFile(next); setConsent(false)
  }
  async function generate() {
    if (!file || !consent || busy || !settings.data) return
    setBusy(true); setError('')
    const controller = new AbortController()
    request.current = controller
    try {
      const photo = await prepareAvatarPhoto(file, controller.signal)
      if (controller.signal.aborted) return
      const outfit = parseOutfit(await uploadAvatarPhoto(photo, controller.signal))
      if (!outfit?.startsWith('custom:')) throw new Error('invalid result')
      onPreview(outfit)
    } catch (error) {
      if (!controller.signal.aborted) setError(t(error instanceof AvatarUploadError ? error.message : 'generation_failed'))
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <div className={styles.photoCreator}>
    <p className={styles.note}>{t('intro')}</p>
    {settings.status === 'loading' && <p role="status" className={styles.note}>{t('checking')}</p>}
    {settings.status === 'error' && <div role="status" className={styles.photoNotice}>{t('unavailable')} <button className={styles.textButton} onClick={settings.reload}>{t('retry')}</button></div>}
    {settings.status === 'ready' && !settings.data && <p className={styles.photoNotice}>{t('not_configured')}</p>}
    {camera && <AvatarCamera onPhoto={select} onClose={closeCamera} />}
    <div className={styles.photoButtons}>
      <button type="button" className={styles.uploadButton} disabled={busy || camera} onClick={() => setCamera(true)}>{t('takePhoto')}</button>
      <label className={styles.uploadButton}>{t('uploadPhoto')}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { closeCamera(); select(e.target.files?.[0]); e.target.value = '' }} /></label>
    </div>
    {preview && <div className={styles.photoPreview}><Image src={preview} alt={t('selectedPhoto')} width={120} height={120} unoptimized /><span>{t('fileHelp')}</span></div>}
    <label className={styles.consent}><input type="checkbox" checked={consent} disabled={busy || !file} onChange={e => setConsent(e.target.checked)} /><span>{t('consent')}</span></label>
    <button className={styles.primary} disabled={!file || !consent || busy || camera || !settings.data} onClick={generate}>{t(busy ? 'generating' : 'generate')}</button>
    <p role="status" className={styles.note}>{busy ? t('waiting') : t('retention')}</p>
    {error && <p role="alert" className={styles.photoError}>{error}</p>}
  </div>
}
