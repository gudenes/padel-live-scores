'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import BracketCell from './BracketCell'
import type { BracketNode, RoundCode, PairPath } from './bracket-builder'
import { ROUND_ORDER, ROUND_SLOTS, pairKeyFor } from './bracket-builder'
import {
  SLOT_PX, LABEL_PX, GAP_PX, PEEK_PX, MAX_VIEWPORT_PX,
  cellCenterY, cellHeight,
} from './bracket-layout'

const GREEN = '#7ED321'
const MUTED = '#6B7280'

type Props = {
  bracket: BracketNode[]
  rounds: RoundCode[]
  activeRound: RoundCode
  setActiveRound: (r: RoundCode) => void
  trackedPairKey: string | null
  trackedPath: PairPath
  trackingVariant: 'tracking' | 'defendingChamp' | null
  onTrackPair: (pairKey: string) => void
  markersByPair: Map<string, 'Q' | 'WC' | 'LL'>
  stickyHeader?: React.ReactNode
}

export default function BracketRoundList({
  bracket, rounds, activeRound, setActiveRound,
  trackedPairKey, trackedPath, trackingVariant, onTrackPair, markersByPair,
  stickyHeader,
}: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null)

  // Measure the available width so the focus column fills it (minus the peek).
  const [vw, setVw] = useState(0)
  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => setVw(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Respect reduced-motion: disable the height/position transitions.
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduce(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const ease = reduce ? 'none' : '0.45s cubic-bezier(0.4,0,0.2,1)'

  // Chip styling helpers (unchanged behavior).
  const trackedRoundSet = new Set(trackedPath.nodes.map(n => n.round))
  const lastTrackedIdx =
    trackedPath.nodes.length > 0
      ? ROUND_ORDER.indexOf(trackedPath.nodes[trackedPath.nodes.length - 1].round)
      : -1

  const nodesByRound = useMemo(() => {
    const m = new Map<RoundCode, BracketNode[]>()
    for (const r of rounds) {
      m.set(r, bracket.filter(n => n.round === r).sort((a, b) => a.positionInRound - b.positionInRound))
    }
    return m
  }, [bracket, rounds])

  const selectedIndex = Math.max(0, rounds.indexOf(activeRound))
  const nextRound = rounds[selectedIndex + 1] ?? null
  const nFocus = ROUND_SLOTS[activeRound] ?? 1
  const Hraw = nFocus * SLOT_PX
  const viewportHeight = Math.min(Hraw, MAX_VIEWPORT_PX) + LABEL_PX
  const centerY = (i: number, n: number) => cellCenterY(i, n, Hraw)

  const hasPeek = nextRound != null && vw > 0
  const focusW = hasPeek ? Math.max(0, vw - PEEK_PX - GAP_PX) : vw
  const peekLeft = focusW + GAP_PX

  // Center the tracked cell vertically inside the internal viewport when the
  // focused round (or tracked pair) changes.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const node = trackedPath.nodes.find(n => n.round === activeRound)
    if (!node) return
    const c = cellCenterY(node.positionInRound, ROUND_SLOTS[activeRound] ?? 1, Hraw)
    const target = Math.max(0, c - vp.clientHeight / 2)
    vp.scrollTo({ top: target, behavior: reduce ? 'auto' : 'smooth' })
  }, [activeRound, trackedPairKey, Hraw, reduce, trackedPath])

  const focusCells = nodesByRound.get(activeRound) ?? []
  const peekCells = nextRound ? (nodesByRound.get(nextRound) ?? []) : []
  const nNext = nextRound ? ROUND_SLOTS[nextRound] : 0

  return (
    <>
      <style>{`@keyframes drawConnFade{from{opacity:0}to{opacity:1}}`}</style>

      {/* Header: tracked-pair pill (when present) + round chip strip. */}
      <div style={{ background: '#1A1A1A', paddingTop: 4 }}>
        {stickyHeader}
        <div style={{
          display: 'flex', gap: 6, padding: '6px 0 10px',
          overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
        }}>
          {rounds.map(r => {
            const isActive = r === activeRound
            const isPassed = trackedRoundSet.has(r) && r !== activeRound
            const isLast = ROUND_ORDER.indexOf(r) === lastTrackedIdx && !trackedPath.eliminatedAt && trackedPath.nodes.length > 0
            const bg = isActive ? '#fff' : isPassed ? 'rgba(126,211,33,0.18)' : 'rgba(255,255,255,0.05)'
            const color = isActive ? '#000' : isPassed ? GREEN : MUTED
            return (
              <button
                key={r}
                onClick={() => setActiveRound(r)}
                style={{
                  flexShrink: 0, padding: '6px 14px',
                  clipPath: 'polygon(3% 5%,97% 0%,100% 95%,0% 100%)',
                  background: bg, color, fontSize: 11, fontWeight: 700,
                  letterSpacing: '0.06em', border: 'none', cursor: 'pointer',
                  outline: isLast ? `1.5px solid ${GREEN}` : 'none',
                }}
              >
                {r}
              </button>
            )
          })}
        </div>
      </div>

      {/* Internal scroll viewport — height eases to the selected round. */}
      <div
        ref={viewportRef}
        style={{
          position: 'relative', overflowX: 'hidden', overflowY: 'auto',
          height: viewportHeight, transition: reduce ? 'none' : `height ${ease}`,
          scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch',
        }}
      >
        {vw > 0 && (
          <div style={{ position: 'relative', width: vw, height: Hraw + LABEL_PX }}>
            {/* Focus column — the selected round, full cells. */}
            <div style={{ position: 'absolute', top: 0, left: 0, width: focusW, height: Hraw + LABEL_PX }}>
              <div style={{
                position: 'absolute', top: 4, left: 2,
                fontSize: 10, fontWeight: 800, letterSpacing: '0.08em',
                color: MUTED, textTransform: 'uppercase',
              }}>
                {activeRound}
              </div>
              {focusCells.map(node => {
                const isTrackedHere = trackedPairKey != null && trackedPath.nodes.includes(node)
                const isTracking = trackedPairKey != null
                const dim = isTracking && !isTrackedHere
                const highlight = isTrackedHere
                  ? trackingVariant === 'defendingChamp' ? 'defendingChamp' : 'tracking'
                  : dim ? 'dim' : 'none'
                return (
                  <div
                    key={node.positionInRound}
                    data-pos={node.positionInRound}
                    style={{
                      position: 'absolute', left: 0, width: focusW,
                      top: centerY(node.positionInRound, nFocus),
                      transform: 'translateY(-50%)',
                      transition: reduce ? 'none' : `top ${ease}, width ${ease}`,
                    }}
                  >
                    <BracketCell
                      node={node}
                      tier="full"
                      highlight={highlight}
                      onTrackPair={onTrackPair}
                      pairKey={pairKeyFor}
                      markersByPair={markersByPair}
                      trackedPairKey={trackedPairKey}
                      isFirstRound={activeRound === rounds[0]}
                    />
                  </div>
                )
              })}
            </div>

            {/* Next-round peek — thin sliver on the right edge; tap to advance. */}
            {hasPeek && nextRound && (
              <div
                onClick={() => setActiveRound(nextRound)}
                style={{
                  position: 'absolute', top: 0, left: peekLeft,
                  width: PEEK_PX, height: Hraw + LABEL_PX, cursor: 'pointer',
                }}
              >
                {peekCells.map(node => {
                  const ch = cellHeight('peek', Hraw / nNext)
                  return (
                    <div
                      key={node.positionInRound}
                      style={{
                        position: 'absolute', left: 0, width: PEEK_PX,
                        top: centerY(node.positionInRound, nNext), height: ch,
                        transform: 'translateY(-50%)',
                        transition: reduce ? 'none' : `top ${ease}`,
                      }}
                    >
                      <BracketCell
                        node={node}
                        tier="peek"
                        highlight="none"
                        onTrackPair={onTrackPair}
                        pairKey={pairKeyFor}
                        markersByPair={markersByPair}
                        trackedPairKey={trackedPairKey}
                        isFirstRound={nextRound === rounds[0]}
                      />
                    </div>
                  )
                })}
              </div>
            )}

            {/* Connectors from the focused round into the next-round peek. */}
            {hasPeek && (
              <svg
                key={activeRound}
                width={vw} height={Hraw + LABEL_PX}
                viewBox={`0 0 ${vw} ${Hraw + LABEL_PX}`}
                preserveAspectRatio="none"
                style={{
                  position: 'absolute', top: 0, left: 0, overflow: 'visible',
                  pointerEvents: 'none',
                  animation: reduce ? undefined : 'drawConnFade 0.25s ease 0.3s both',
                }}
              >
                {Array.from({ length: nNext }).map((_, j) => {
                  const x1 = focusW
                  const x2 = peekLeft
                  const xm = (x1 + x2) / 2
                  const yTop = centerY(2 * j, nFocus)
                  const yBot = centerY(2 * j + 1, nFocus)
                  const yMid = centerY(j, nNext)
                  const topNode = focusCells[2 * j]
                  const botNode = focusCells[2 * j + 1]
                  const dstNode = peekCells[j]
                  const topFeeds = topNode != null && (topNode.match != null || topNode.isBye)
                  const botFeeds = botNode != null && (botNode.match != null || botNode.isBye)
                  const onPath = (node: BracketNode | undefined) => node != null && trackedPath.nodes.includes(node)
                  const topGlow = topFeeds && dstNode != null && onPath(topNode) && onPath(dstNode)
                  const botGlow = botFeeds && dstNode != null && onPath(botNode) && onPath(dstNode)
                  const dstGlow = topGlow || botGlow
                  const lineProps = (glow: boolean) => ({
                    stroke: glow ? GREEN : 'rgba(255,255,255,0.16)',
                    strokeWidth: glow ? 2 : 1,
                    fill: 'none',
                  })
                  let vY1: number | null = null
                  let vY2: number | null = null
                  if (topFeeds && botFeeds) { vY1 = yTop; vY2 = yBot }
                  else if (topFeeds) { vY1 = yTop; vY2 = yMid }
                  else if (botFeeds) { vY1 = yMid; vY2 = yBot }
                  return (
                    <g key={j}>
                      {topFeeds && <line x1={x1} y1={yTop} x2={xm} y2={yTop} {...lineProps(topGlow)} />}
                      {botFeeds && <line x1={x1} y1={yBot} x2={xm} y2={yBot} {...lineProps(botGlow)} />}
                      {vY1 != null && vY2 != null && (
                        <line x1={xm} y1={vY1} x2={xm} y2={vY2} {...lineProps(topGlow || botGlow)} />
                      )}
                      {(topFeeds || botFeeds) && (
                        <line x1={xm} y1={yMid} x2={x2} y2={yMid} {...lineProps(dstGlow)} />
                      )}
                    </g>
                  )
                })}
              </svg>
            )}
          </div>
        )}
      </div>
    </>
  )
}
