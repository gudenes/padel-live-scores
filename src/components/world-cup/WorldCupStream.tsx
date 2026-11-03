'use client'

import { useId, useState } from 'react'
import { useTranslations } from 'next-intl'
import styles from './WorldCupStream.module.css'

/** Load the official player only after the viewer chooses to watch. */
export default function WorldCupStream({ videoId, title, open: controlledOpen, onOpenChange }: { videoId: string; title: string; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const t = useTranslations('worldCup')
  const tStreams = useTranslations('events.dayStreams')
  const [localOpen, setLocalOpen] = useState(false)
  const open = controlledOpen ?? localOpen
  const setOpen = onOpenChange ?? setLocalOpen
  const panelId = useId()
  if (!/^[\w-]{11}$/.test(videoId)) return null
  return <div className={styles.root}>
    <button className={styles.toggle} type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
      <span>▷ {t('watch')}</span><span aria-hidden="true">{open ? '−' : '+'}</span>
    </button>
    <div id={panelId}>
      {open && <>
        <iframe className={styles.player} src={`https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&playsinline=1`} title={title}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        <a className={styles.fallback} href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noopener noreferrer">{tStreams('openOnYoutube')}</a>
      </>}
    </div>
  </div>
}
