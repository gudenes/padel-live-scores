// apps/ops/src/app/(app)/today/_components/MatchRow.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { Match, Pair } from '../_lib/types'
import { OddsBar } from './OddsBar'

function genderTag(gender: Pair['gender']) {
  return gender === 'women'
    ? <span className="sb-gtag sb-g-women">W</span>
    : <span className="sb-gtag sb-g-men">M</span>
}

function ppClass(isFav: boolean, serving: boolean) {
  return `sb-pp ${isFav ? 'sb-lead' : 'sb-trail'}${serving ? ' sb-serving' : ''}`
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

function StatusBadge({ match }: { match: Match }) {
  if (match.status === 'live') return <span className="sb-badge sb-b-live">Live</span>
  if (match.status === 'break') return <span className="sb-badge sb-b-break">Break</span>
  return <span className="sb-schedtime">{formatTime(match.scheduledAt)}</span>
}

// Serialized live-score signature; when it changes we briefly flash the cell.
function scoreSignature(match: Match): string {
  const sets = match.setScores.map((s) => `${s.a}-${s.b}${s.current ? '*' : ''}`).join(',')
  const gp = match.gamePoints ? `${match.gamePoints.a}:${match.gamePoints.b}` : ''
  return `${sets}|${gp}`
}

// Toggles `.sb-flash` for one animation cycle whenever `sig` changes (after mount).
// CSS gates the actual animation behind prefers-reduced-motion: no-preference.
function useScoreFlash(sig: string): boolean {
  const prev = useRef(sig)
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (prev.current === sig) return
    prev.current = sig
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 600)
    return () => clearTimeout(t)
  }, [sig])
  return flash
}

function ScoreCell({ match }: { match: Match }) {
  const flash = useScoreFlash(scoreSignature(match))
  // Scheduled rows: just the time badge.
  if (match.status === 'scheduled') {
    return (
      <div className="sb-score">
        <span className="sb-schedtime">{formatTime(match.scheduledAt)}</span>
        <span className="sb-badge sb-b-sched">Scheduled</span>
      </div>
    )
  }
  const gp = match.gamePoints
  const serveA = gp != null && match.pair1.serving
  const serveB = gp != null && match.pair2.serving
  return (
    <div className={`sb-score${flash ? ' sb-flash' : ''}`}>
      <div className="sb-scols">
        {match.setScores.map((s, i) => (
          <div key={i} className={`sb-col${s.current ? ' sb-cur' : ''}`}>
            <span className="sb-a">{s.a}</span>
            <span className="sb-b">{s.b}</span>
          </div>
        ))}
      </div>
      {gp != null ? (
        <div className={`sb-gpcol${serveA ? ' sb-serveA' : ''}${serveB ? ' sb-serveB' : ''}`}>
          <span className="sb-a">{gp.a}</span>
          <span className="sb-b">{gp.b}</span>
        </div>
      ) : null}
      <StatusBadge match={match} />
    </div>
  )
}

function MovementChip({ movement15m }: { movement15m: number }) {
  if (match_movementUnknown(movement15m)) {
    return <span className="sb-mv sb-mv--flat">—</span>
  }
  const pts = Math.round(movement15m * 100)
  const sign = pts >= 0 ? '+' : ''
  let tone: 'up' | 'dn' | 'flat'
  if (pts < 0) tone = 'dn'
  else if (pts >= 5) tone = 'up'
  else tone = 'flat'
  const arrow = pts > 0 ? '▲' : pts < 0 ? '▼' : '—'
  return (
    <span className={`sb-mv sb-mv--${tone}`}>{arrow} {sign}{pts}</span>
  )
}

// A scheduled match has movement exactly 0 with no history — show a bare dash.
function match_movementUnknown(movement15m: number): boolean {
  return movement15m === 0
}

const CONF_BARS = [6, 9, 13]

function ConfidenceMeter({ confidence }: { confidence: Match['confidence'] }) {
  const lit = confidence === 'full' ? 3 : confidence === 'med' ? 2 : 1
  const label = confidence === 'full' ? 'Full' : confidence === 'med' ? 'Settling' : 'Thin'
  return (
    <span className={`sb-conf sb-conf--${confidence}`}>
      <span className="sb-conf-bars">
        {CONF_BARS.map((h, i) => (
          <i key={i} style={{ height: h, opacity: i < lit ? 1 : 0.35 }} />
        ))}
      </span>
      <span className="sb-conf-t">{label}</span>
    </span>
  )
}

export function MatchRow({ match, selected, onSelect }: { match: Match; selected: boolean; onSelect: (id: string) => void }) {
  const fav1 = match.winProb1 >= 0.5
  function handleKey(e: KeyboardEvent<HTMLTableRowElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(match.id)
    }
  }
  return (
    <tr
      className={'sb-row' + (selected ? ' sb-row--sel' : '')}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(match.id)}
      onKeyDown={handleKey}
    >
      <td className="sb-match">
        <div className={ppClass(fav1, match.pair1.serving)}>
          <span className="sb-srv" />
          <span className="sb-pp-name">{match.pair1.name}</span>
          {genderTag(match.pair1.gender)}
        </div>
        <div className={ppClass(!fav1, match.pair2.serving)}>
          <span className="sb-srv" />
          <span className="sb-pp-name">{match.pair2.name}</span>
        </div>
      </td>
      <td className="sb-tour">
        {match.tournament}
        <small>{[match.court, match.round].filter(Boolean).join(' · ') || ' '}</small>
      </td>
      <td>
        <ScoreCell match={match} />
      </td>
      <td>
        <OddsBar prob1={match.winProb1} fair1={match.fairOdds1} fair2={match.fairOdds2} />
      </td>
      <td className="sb-r">
        <MovementChip movement15m={match.movement15m} />
      </td>
      <td>
        <ConfidenceMeter confidence={match.confidence} />
      </td>
      <td className="sb-r sb-upd">
        {match.lastUpdatedSeconds > 0 ? `${match.lastUpdatedSeconds}s` : ''}
      </td>
    </tr>
  )
}
