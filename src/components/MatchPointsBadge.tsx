'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import MatchPointsBracket from './MatchPointsBracket'
import PressButton, { PRESS_PRESETS } from './PressButton'

export default function MatchPointsBadge({ points, loserPoints, qualifying = false, qualificationBonus = 0, round, nextRound }: { round?: string | null; nextRound?: string; points: number; loserPoints: number; qualifying?: boolean; qualificationBonus?: number }) {
  const t = useTranslations('raceStandings')
  const common = useTranslations('common')
  const id = useId()
  const trigger = useRef<HTMLButtonElement | null>(null)
  const popup = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const isOpen = open
  useEffect(() => {
    if (!isOpen) return
    popup.current?.querySelector('button')?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = overflow }
  }, [isOpen])
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!popup.current?.parentElement?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  return <>
    <PressButton {...PRESS_PRESETS.chunkyInline} type="button" data-match-points={points}
      aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog"
      aria-label={`${points} pts — ${t('how')}`}
      style={{ padding: '2px 5px', fontSize: 9, lineHeight: '12px', fontWeight: 800, whiteSpace: 'nowrap', flexShrink: 0 }}
      onClick={event => {
        event.preventDefault(); event.stopPropagation()
        trigger.current = event.currentTarget
        setOpen(!open)
      }}
    >{`${points} pts`} ⓘ</PressButton>
    {open && createPortal(<div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center', padding: 12, background: '#0008', backdropFilter: 'blur(2px)' }} onClick={event => { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus() }}>
    <div ref={popup} id={id} role="dialog" aria-modal="true" aria-label={t('pointsVisual.title')}
      onClick={event => { event.stopPropagation() }}
      onKeyDown={event => { if (event.key !== 'Tab') return; const controls = popup.current?.querySelectorAll<HTMLElement>('button, summary'); if (!controls?.length) return; const first = controls[0]; const last = controls[controls.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() } }}
      style={{ position: 'relative', zIndex: 10000, width: 'min(320px, calc(100vw - 24px))', maxHeight: 'calc(100dvh - 24px)', overflowY: 'auto', boxSizing: 'border-box', padding: 14, borderRadius: 0, clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)', border: '2px solid #7ed32155', background: '#1a1a1d', color: '#e2e8f0', boxShadow: '0 8px 24px #0008', fontSize: 12, lineHeight: 1.5 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}><strong style={{ fontSize: 14 }}>{t('pointsVisual.title')}</strong><PressButton {...PRESS_PRESETS.chunkyInline} type="button" aria-label={common('close')} onClick={() => { setOpen(false); trigger.current?.focus() }} style={{ minWidth: 44, minHeight: 44, fontSize: 26 }}>×</PressButton></div>
      <MatchPointsBracket round={round} nextRound={nextRound} qualifying={qualifying} points={points} loserPoints={loserPoints} />
      <p style={{ margin: '10px 0 0', fontSize: 11, color: '#a2aab6' }}>{t('pointsVisual.shortNote')}</p>
      <details style={{ marginTop: 8, fontSize: 11, color: '#a2aab6' }}><summary style={{ cursor: 'pointer', padding: '6px 0' }}>{t('how')}</summary>
        <p>{t(qualifying ? 'pointsVisual.qualifying' : 'pointsVisual.base')}{qualifying && qualificationBonus > 0 && <> {t('pointsVisual.qualifyingBonus', { points: qualificationBonus })}</>}</p>
        <p>{t('pointsVisual.race')}</p>
      </details>
    </div></div>, document.body)}
  </>
}

/** Editorial-style pair illustrations: celebration versus regrouping. */
export function PairIllustration({ winner }: { winner: boolean }) {
  const shirt = winner ? '#a2eb4d' : '#93b6e0'
  const trim = winner ? '#568d26' : '#506e98'
  return <svg viewBox="0 0 140 90" width="120" height="76" aria-hidden="true" style={{ display: 'block', margin: '0 auto 4px', maxWidth: '100%' }}>
    <ellipse cx="70" cy="46" rx="53" ry="38" fill={shirt} opacity=".07" />
    <path d="M14 77 H126 M33 68 H107 M70 68 V83" stroke={shirt} strokeWidth="1" opacity=".18" />
    <ellipse cx="70" cy="81" rx="44" ry="4" fill="#000" opacity=".22" />
    {[0, 1].map(index => {
      const x = index === 0 ? 46 : 94
      const skin = index === 0 ? '#eab58b' : '#ad7958'
      const inner = index === 0 ? 1 : -1
      return <g key={index}>
        {/* Arms: high five after a win, a supportive fist bump after a loss. */}
        <path d={`M${x + inner*9} 43 L${x + inner*17} ${winner ? 31 : 49} L${x + inner*23} ${winner ? 15 : 44}`} fill="none" stroke={skin} strokeWidth="6" strokeLinecap="round" />
        <path d={`M${x - inner*10} 44 L${x - inner*17} 58 L${x - inner*20} 51`} fill="none" stroke={skin} strokeWidth="6" strokeLinecap="round" />
        <path d={`M${x-8} 64 L${x-9} 77 M${x+8} 64 L${x+10} 77`} stroke={skin} strokeWidth="6" strokeLinecap="round" />
        <path d={`M${x-13} 78 H${x-6} M${x+7} 78 H${x+15}`} stroke="#e2e8f0" strokeWidth="5" strokeLinecap="round" />
        <path d={`M${x-12} 58 H${x+12} L${x+10} 68 H${x+2} L${x} 63 L${x-2} 68 H${x-10} Z`} fill="#283444" />
        <path d={`M${x-7} 35 L${x-16} 40 L${x-12} 49 L${x-10} 46 V59 Q${x} 62 ${x+10} 59 V46 L${x+12} 49 L${x+16} 40 L${x+7} 35 Z`} fill={shirt} />
        <path d={`M${x-8} 52 L${x+10} 44 V49 L${x-8} 57 Z`} fill={trim} opacity=".55" />
        <path d={`M${x-4} 33 V37 Q${x} 42 ${x+4} 37 V33`} fill={skin} />
        <ellipse cx={x} cy="26" rx="9" ry="11" fill={skin} />
        <path d={`M${x-9} 26 V21 Q${x-8} 12 ${x+2} 15 Q${x+11} 16 ${x+9} 25 L${x+5} 20 L${x-4} 21 L${x-7} 27 Z`} fill={index === 0 ? '#3a2c26' : '#24242b'} />
        <circle cx={x-3} cy="27" r=".9" fill="#372e2b" /><circle cx={x+3} cy="27" r=".9" fill="#372e2b" />
        <path d={winner ? `M${x-3} 31 Q${x} 34 ${x+3} 31` : `M${x-2} 32 H${x+2}`} fill="none" stroke="#754c3c" strokeWidth="1.1" strokeLinecap="round" />
        {/* Perforated padel racket, held beside the player. */}
        <g transform={`translate(${x-inner*23} 43) rotate(${index === 0 ? -24 : 24})`}>
          <path d="M0 8 V17" stroke="#e2e8f0" strokeWidth="3" strokeLinecap="round" />
          <rect x="-7" y="-10" width="14" height="19" rx="7" fill="#283444" stroke={shirt} strokeWidth="2" />
          {[-4, 1, 5].map(y => <g key={y}><circle cx="-2.5" cy={y} r="1" fill={shirt} /><circle cx="2.5" cy={y} r="1" fill={shirt} /></g>)}
        </g>
      </g>
    })}
    <circle cx="22" cy="73" r="4" fill="#d5ec6b" /><path d="M19 72 Q22 74 25 72" fill="none" stroke="#8aa641" strokeWidth=".8" />
    {winner && <g fill="none" stroke="#f5c75b" strokeWidth="2" strokeLinecap="round"><path d="M70 4 V8 M59 7 L62 10 M81 7 L78 10 M19 27 L22 23 M117 22 L120 26" /><path d="M16 16 H20 M18 14 V18 M119 35 H123 M121 33 V37" /></g>}
  </svg>
}
