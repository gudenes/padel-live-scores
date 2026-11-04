'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'
import { WORLD_CUP } from '@/lib/world-cup'
import styles from './ReleasePopup.module.css'
import { getReleaseCopy, type ReleaseCopy } from './release-copy'
import { getPathname } from '@/i18n/navigation'

const cupHref = `/tournaments/${WORLD_CUP.tournamentId}?tab=matches`

// Same clock outline used by the app's SearchOverlay history rows.
function ClockIcon() {
  return <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
}

function SchedulePreview({ t }: { t: ReleaseCopy }) {
  const [details, setDetails] = useState(false)
  return <div className={styles.schedule}>
    <div className={styles.court}>{t.court} <span>{t.example}</span></div>
    <div className={styles.liveMatch}>
      <span className={styles.liveBadge}>{t.live}</span>
      <div className={styles.scoreRow}><span>Coello / Tapia</span><b>6</b><b>4</b></div>
      <div className={styles.scoreRow}><span>Galán / Chingotto</span><b>3</b><b>4</b></div>
    </div>
    <div className={styles.nextMatch}>
      <span className={styles.nextBadge}>{t.next}</span>
      <div className={styles.nextBody}><div><p>Lebrón / Augsburger</p><p>Yanguas / Nieto</p></div><button type="button" className={styles.estimate} aria-expanded={details} aria-controls="release-estimate" onClick={() => setDetails(value => !value)}><span>{t.estimate}</span><strong>20–35 min</strong><small>{t.details}</small></button></div>
      {details && <div className={styles.timing} id="release-estimate"><strong>{t.window}</strong><span>{t.original}</span><p>{t.explanation}</p></div>}
    </div>
  </div>
}

export default function ReleasePopup({ open, onClose, onShown, locale = 'en' }: { open: boolean; onClose: () => void; onShown?: () => void; locale?: string }) {
  const t = getReleaseCopy(locale)
  const dialog = useRef<HTMLDialogElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const [slide, setSlide] = useState(0)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const isCup = slide === 0
  useEffect(() => {
    const element = dialog.current
    if (!element || !open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (typeof element.showModal !== 'function') return
    element.showModal()
    onShown?.()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      element.close()
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [open, onShown])
  function selectSlide(index: number) {
    setSlide(index)
    scroll.current?.scrollTo({ top: 0 })
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="release-title" aria-describedby="release-description"
    onCancel={event => { event.preventDefault(); onClose() }}
    onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); selectSlide(isCup ? 1 : 0) } }}>
    <div className={styles.scroll} ref={scroll}
      onTouchStart={event => { touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY } }}
      onTouchEnd={event => { const start = touchStart.current; touchStart.current = null; if (!start) return; const x = event.changedTouches[0].clientX - start.x; const y = event.changedTouches[0].clientY - start.y; if (Math.abs(x) > 60 && Math.abs(x) > Math.abs(y) * 1.5) selectSlide(isCup ? 1 : 0) }}>
      <header className={styles.top}><p>{t.new}</p><button type="button" className={styles.close} onClick={onClose} aria-label={t.close}>×</button></header>
      <h2 id="release-title" className={styles.title}>{isCup ? <>{t.titleCup}<br />{t.titleCup2}</> : <>{t.titleSchedule}<br />{t.titleSchedule2}</>}</h2>
      <div aria-live="polite" className={styles.srOnly}>{isCup ? t.updateCup : t.updateSchedule}</div>
      {isCup ? <>
        <div className={styles.art}><Image src="/releases/world-cup-2026.jpg" alt={t.art} fill sizes="(max-width: 480px) 85vw, 390px" priority className={styles.image} /><span>FIP WORLD CUP 2026</span></div>
        <div className={styles.countries}><span><Image src="/flags/es.png" alt="" width={28} height={20} />{t.spain}</span><small>{t.cup}<br />{t.teams}</small><span>{t.argentina}<Image src="/flags/ar.png" alt="" width={28} height={20} /></span></div>
        <p className={styles.features}>{t.matches} <span>·</span> {t.groups} <span>·</span> {t.squads}</p>
        <p id="release-description" className={styles.description}>{t.cupDescription}</p>
      </> : <>
        <p id="release-description" className={styles.scheduleIntro}>{t.intro}</p>
        <SchedulePreview t={t} />
        <p className={styles.description}>{t.scheduleDescription}</p>
      </>}
      <button type="button" className={`${styles.teaser} ${isCup ? '' : styles.cupTeaser}`} onClick={() => selectSlide(isCup ? 1 : 0)}>
        {isCup && <ClockIcon />}<span><strong>{isCup ? t.alsoSchedule : t.alsoCup}</strong><span>{isCup ? t.tune : t.countryMatch}</span></span>
      </button>
    </div>
    <footer className={styles.footer}>
      <div className={styles.navigation}><div className={styles.dots} role="group" aria-label={t.slides}>{[t.showCup, t.showSchedule].map((name, index) => <button type="button" key={name} aria-label={name} aria-pressed={index === slide} onClick={() => selectSlide(index)}><span /></button>)}</div><span>{slide + 1} / 2</span></div>
      <PressButton as="a" href={getPathname({ locale, href: isCup ? cupHref : '/matches' })} onClick={onClose} {...PRESS_PRESETS.chunkyTilted} style={{ width: '100%', padding: '15px 8px', fontSize: 14, fontWeight: 850, textAlign: 'center', textDecoration: 'none' }}>{isCup ? t.explore : t.today}</PressButton>
      <button type="button" className={styles.switch} onClick={() => selectSlide(isCup ? 1 : 0)}>{isCup ? t.nextSlide : t.back}</button>
      <button type="button" className={styles.later} onClick={onClose}>{t.later}</button>
    </footer>
  </dialog>
}
