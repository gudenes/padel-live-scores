'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import PressButton, { PRESS_PRESETS } from './PressButton'

export default function MatchPointsBadge({ points, loserPoints, qualifying = false, qualificationBonus = 0 }: { points: number; loserPoints: number; qualifying?: boolean; qualificationBonus?: number }) {
  const t = useTranslations('raceStandings')
  const id = useId()
  const trigger = useRef<HTMLButtonElement | null>(null)
  const popup = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!position || !popup.current) return
    const rect = popup.current.getBoundingClientRect()
    const top = Math.max(12, Math.min(position.top, window.innerHeight - rect.height - 12))
    if (top !== position.top) setPosition({ ...position, top })
  }, [position])
  useEffect(() => {
    if (!position) return
    const dismiss = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setPosition(null)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setPosition(null); trigger.current?.focus() }
    }
    const close = (event: Event) => { if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) setPosition(null) }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [position])
  return <>
    <PressButton {...PRESS_PRESETS.chunkyInline} type="button" data-match-points={points}
      aria-expanded={!!position} aria-describedby={position ? id : undefined}
      aria-label={`${qualifying ? t('pointsVisual.winBadge', { points }) : `${points} pts`} — ${t('how')}`}
      style={{ padding: '2px 5px', fontSize: 9, lineHeight: '12px', fontWeight: 800, whiteSpace: 'nowrap', flexShrink: 0 }}
      onClick={event => {
        event.preventDefault(); event.stopPropagation()
        trigger.current = event.currentTarget
        const rect = event.currentTarget.getBoundingClientRect()
        const width = Math.min(320, window.innerWidth - 24)
        setPosition(position ? null : { left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 180)) })
      }}
    >{qualifying ? t('pointsVisual.winBadge', { points }) : `${points} pts`} ⓘ</PressButton>
    {position && createPortal(<div ref={popup} id={id} role="tooltip"
      onClick={event => { event.preventDefault(); event.stopPropagation() }}
      style={{ position: 'fixed', ...position, zIndex: 10000, width: 'min(320px, calc(100vw - 24px))', maxHeight: 'calc(100dvh - 24px)', overflowY: 'auto', boxSizing: 'border-box', padding: 14, borderRadius: 8, border: '1px solid #7ed32155', background: '#1a1a1d', color: '#e2e8f0', boxShadow: '0 8px 24px #0008', fontSize: 12, lineHeight: 1.5 }}
    >
      <strong style={{ fontSize: 14 }}>{t('pointsVisual.title')}</strong>
      {qualifying && <div style={{ marginTop: 8, padding: '8px 10px', background: '#ffffff08', borderRadius: 6 }}><strong>{t('pointsVisual.roundExit', { points: loserPoints })}</strong><p style={{ margin: '4px 0 0', color: '#a2aab6', fontSize: 11 }}>{t('pointsVisual.advance')}</p></div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        {([{ winner: true, amount: points }, { winner: false, amount: loserPoints }]).map(({ winner, amount }) => <div key={String(winner)} style={{ textAlign: 'center', padding: '10px 6px', borderRadius: 8, background: winner ? '#7ed32114' : '#ffffff08', border: `1px solid ${winner ? '#7ed32144' : '#ffffff16'}` }}>
          <PairIllustration winner={winner} />
          <div style={{ fontWeight: 800, color: winner ? '#a2eb4d' : '#cbd5e1' }}>{t(winner ? 'pointsVisual.winner' : 'pointsVisual.loser')}</div>
          <div style={{ fontSize: 26, lineHeight: 1.2, fontWeight: 900, marginTop: 4 }}>{amount}<span style={{ fontSize: 11, marginLeft: 3 }}>pts</span></div>
          <div style={{ fontSize: 10, color: '#a2aab6' }}>{t('pointsVisual.perPlayer')}</div>
          <div style={{ fontSize: 10, marginTop: 6, padding: '4px 5px', borderRadius: 4, fontWeight: winner ? 900 : 500, background: winner ? '#7ed32125' : 'transparent', color: winner ? '#b8f46d' : '#a2aab6' }}>{winner && '✓ '}{t(winner ? 'pointsVisual.secured' : 'pointsVisual.finish')}</div>
        </div>)}
      </div>
      <p style={{ margin: '12px 0 6px', color: '#cbd5e1', fontSize: 11 }}>{t(qualifying ? 'pointsVisual.qualifying' : 'pointsVisual.base')}{qualifying && qualificationBonus > 0 && <> {t('pointsVisual.qualifyingBonus', { points: qualificationBonus })}</>}</p>
      <div style={{ borderTop: '1px dotted #ffffff33', paddingTop: 8, color: '#a2aab6', fontSize: 11 }}>{t('pointsVisual.race')}</div>
    </div>, document.body)}
  </>
}

/** Editorial-style pair illustrations: celebration versus regrouping. */
function PairIllustration({ winner }: { winner: boolean }) {
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
