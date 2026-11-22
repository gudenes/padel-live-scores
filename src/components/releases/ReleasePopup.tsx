'use client'

import { useEffect, useRef, useState } from 'react'
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'
import { PairIllustration } from '@/components/MatchPointsBadge'
import styles from './ReleasePopup.module.css'
import { getReleaseCopy, type ReleaseCopy } from './release-copy'
import { getPathname } from '@/i18n/navigation'

function RacePreview({ t }: { t: ReleaseCopy }) {
  return <div className={styles.preview}>
    <div className={styles.previewHeader}><strong>Race <span className={styles.raceLive}>● {t.live}</span></strong><small>{t.example}</small></div>
    {[15, 16, 17].map((rank, index) => <div key={rank}>
      {rank === 17 && <div className={styles.finals}>{t.cutoff}</div>}
      <div className={styles.raceRow}><b>{rank}</b><span className={styles.playerAvatar}>{String.fromCharCode(65 + index)}</span><span>{t.player} {String.fromCharCode(65 + index)}</span><strong>{2500 - index * 20}<small>+{30 - index * 10}</small></strong></div>
    </div>)}
    <p className={styles.previewNote}>{t.provisional}</p>
  </div>
}
function PointsPreview({ t }: { t: ReleaseCopy }) {
  return <div className={styles.preview}>
    <div className={styles.previewHeader}><strong>{t.qualifyingExample}</strong><small>{t.example}</small></div>
    <div className={styles.pointsBadge}>{t.winPreview} ⓘ</div>
    <div className={styles.pointsPanels}>{[true, false].map(winner => <div key={String(winner)}>
      <PairIllustration winner={winner} />
      <b>{winner ? t.winner : t.loser}</b><strong>{winner ? 15 : 0}<small> pts</small></strong><span>{t.perPlayer}</span>
      {winner && <em>✓ {t.secured}</em>}
    </div>)}</div>
    <p className={styles.previewNote}>{t.pointsHint}</p>
  </div>
}

export default function ReleasePopup({ open, onClose, onShown, locale = 'en' }: { open: boolean; onClose: () => void; onShown?: () => void; locale?: string }) {
  const t = getReleaseCopy(locale)
  const dialog = useRef<HTMLDialogElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const [slide, setSlide] = useState(0)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const isRace = slide === 0
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
    onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); selectSlide(isRace ? 1 : 0) } }}>
    <div className={styles.scroll} ref={scroll}
      onTouchStart={event => { touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY } }}
      onTouchEnd={event => { const start = touchStart.current; touchStart.current = null; if (!start) return; const x = event.changedTouches[0].clientX - start.x; const y = event.changedTouches[0].clientY - start.y; if (Math.abs(x) > 60 && Math.abs(x) > Math.abs(y) * 1.5) selectSlide(isRace ? 1 : 0) }}>
      <header className={styles.top}><p>{t.new}</p><PressButton {...PRESS_PRESETS.chunkyInline} type="button" onClick={onClose} aria-label={t.close} style={{ padding: '3px 9px', fontSize: 20 }}>×</PressButton></header>
      <h2 id="release-title" className={styles.title}>{isRace ? <>{t.titleRace}<br />{t.titleRace2}</> : <>{t.titlePoints}<br />{t.titlePoints2}</>}</h2>
      <div aria-live="polite" className={styles.srOnly}>{isRace ? t.updateRace : t.updatePoints}</div>
      {isRace ? <RacePreview t={t} /> : <PointsPreview t={t} />}
      <p id="release-description" className={styles.description}>{isRace ? t.raceDescription : t.pointsDescription}</p>
    </div>
    <footer className={styles.footer}>
      <div className={styles.navigation}><div className={styles.slideButtons} role="group" aria-label={t.slides}>{[t.showRace, t.showPoints].map((name, index) => <PressButton {...PRESS_PRESETS.chunkyInline} type="button" key={name} aria-label={name} aria-pressed={index === slide} onClick={() => selectSlide(index)} style={{ padding: '4px 10px', fontSize: 11, opacity: index === slide ? 1 : .55 }}>{index + 1}</PressButton>)}</div><span>{slide + 1} / 2</span></div>
      <PressButton as="a" href={getPathname({ locale, href: isRace ? '/rankings?type=race' : '/matches' })} onClick={onClose} {...PRESS_PRESETS.chunkyTilted} style={{ width: '100%', padding: '15px 8px', fontSize: 14, fontWeight: 850, textAlign: 'center', textDecoration: 'none' }}>{isRace ? t.raceCta : t.pointsCta}</PressButton>
      <div className={styles.bottomActions}><PressButton {...PRESS_PRESETS.chunkyInline} type="button" onClick={() => selectSlide(isRace ? 1 : 0)} style={{ padding: '6px 8px', fontSize: 11 }}>{isRace ? t.nextSlide : t.back}</PressButton><PressButton {...PRESS_PRESETS.chunkyInline} type="button" onClick={onClose} style={{ padding: '6px 8px', fontSize: 11 }}>{t.later}</PressButton></div>
    </footer>
  </dialog>
}
