'use client'

import { useEffect, useRef, useState } from 'react'
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'
import MatchPointsBracket from '@/components/MatchPointsBracket'
import styles from './ReleasePopup.module.css'
import { getReleaseCopy, type ReleaseCopy } from './release-copy'
import { getPathname } from '@/i18n/navigation'

// Real portraits with illustrative points, not a second live standings feed.
const raceExamples = [
  {
    "rank": 15,
    "name": "Momo Gonzalez",
    "avatar": "https://jwqaesjjoghzobngxejn.supabase.co/storage/v1/object/public/avatars/d2da1e8c-5bdc-4c46-b5b5-9d680e167153.png",
    "points": 3335,
    "gain": 30
  },
  {
    "rank": 16,
    "name": "Gonzalo Alfonso",
    "avatar": "https://jwqaesjjoghzobngxejn.supabase.co/storage/v1/object/public/avatars/7934d376-5e86-44ca-a4ca-22b6fa971f4e.png",
    "points": 3320,
    "gain": 20
  },
  {
    "rank": 17,
    "name": "Lucas Campagnolo",
    "avatar": "https://jwqaesjjoghzobngxejn.supabase.co/storage/v1/object/public/avatars/c45f4efa-96f7-4759-8ad4-dc5c842245ba.png",
    "points": 3260,
    "gain": 10
  }
]

function RacePreview({ t }: { t: ReleaseCopy }) {
  return <div className={styles.preview}>
    <div className={styles.previewHeader}><strong>Race <span className={styles.raceLive}>● {t.live}</span></strong><small>{t.example}</small></div>
    {raceExamples.map(player => <div key={player.rank}>
      {player.rank === 17 && <div className={styles.finals}>{t.cutoff}</div>}
      <div className={styles.raceRow}><b>{player.rank}</b><span className={styles.playerAvatar}>
        <span aria-hidden="true">{player.name.split(' ').map(word => word[0]).slice(0, 2).join('')}</span>
        <img src={player.avatar} alt="" onError={event => { event.currentTarget.style.display = 'none' }} />
      </span><span className={styles.playerName}>{player.name}</span><strong>{player.points}<small>+{player.gain}</small></strong></div>
    </div>)}
    <p className={styles.previewNote}>{t.provisional}</p>
  </div>
}
function PointsPreview({ t }: { t: ReleaseCopy }) {
  return <div className={styles.preview}>
    <div className={styles.previewHeader}><strong>{t.qualifyingExample}</strong><small>{t.example}</small></div>
    <div className={styles.bracketPreview}>
      <MatchPointsBracket round="Q1" nextRound="Q2" qualifying points={15} loserPoints={0} />
    </div>
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
      <header className={styles.top}><p>{t.new}</p><PressButton {...PRESS_PRESETS.chunkyInline} type="button" onClick={onClose} aria-label={t.close} style={{ minWidth: 44, minHeight: 44, fontSize: 26 }}>×</PressButton></header>
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
