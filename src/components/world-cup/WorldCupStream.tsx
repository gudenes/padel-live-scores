'use client'

import { useId, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import type { CupStream } from '@/lib/world-cup'
import styles from './WorldCupStream.module.css'

/** Load the official player only after the viewer chooses to watch. */
export default function WorldCupStream({ videoId, streams, title, open: controlledOpen, onOpenChange }: { videoId: string; streams?: CupStream[]; title: string; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const locale = useLocale().split('-')[0]
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null)
  const options = (streams?.length ? streams : [{ videoId, language: null }]).filter(stream => /^[\w-]{11}$/.test(stream.videoId))
  const languageLocales: Record<string,string> = {ENG:'en',ESP:'es',POR:'pt',FRA:'fr',ITA:'it',GER:'de',ARA:'ar'}
  const preferred = options.find(stream => (languageLocales[stream.language ?? ''] ?? stream.language?.toLowerCase()) === locale)
  const activeVideo = options.find(stream => stream.videoId === selectedVideo)?.videoId ?? preferred?.videoId ?? videoId
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
        {options.length > 1 && <select className={styles.toggle} aria-label={`${t('watch')} · ${title}`} value={activeVideo} onChange={event => setSelectedVideo(event.target.value)}>
          {options.map(stream => <option key={stream.videoId} value={stream.videoId}>{stream.language ?? 'YouTube'}</option>)}
        </select>}
        <iframe className={styles.player} src={`https://www.youtube.com/embed/${activeVideo}?autoplay=1&rel=0&playsinline=1`} title={title}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
        <a className={styles.fallback} href={`https://www.youtube.com/watch?v=${activeVideo}`} target="_blank" rel="noopener noreferrer">{tStreams('openOnYoutube')}</a>
      </>}
    </div>
  </div>
}
