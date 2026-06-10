'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import BracketCell from './BracketCell'
import type { BracketNode, RoundCode, PairPath } from './bracket-builder'
import { ROUND_ORDER, ROUND_SLOTS, pairKeyFor } from './bracket-builder'
import {
  SLOT_PX, LABEL_PX, MAX_VIEWPORT_PX,
  cellCenterY, computeColumns, trackWidth, panOffset, cellHeight,
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

  // Respect reduced-motion: disable the width/height/transform transitions.
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduce(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const ease = reduce ? 'none' : '0.55s cubic-bezier(0.4,0,0.2,1)'

  // Chip styling helpers (unchanged behavior).
  const trackedRoundSet = new Set(trackedPath.nodes.map(n => n.round))
  const lastTrackedIdx =
    trackedPath.nodes.length > 0
      ? ROUND_ORDER.indexOf(trackedPath.nodes[trackedPath.nodes.length - 1].round)
      : -1

  // Nodes per round, sorted by position.
  const nodesByRound = useMemo(() => {
    const m = new Map<RoundCode, BracketNode[]>()
    for (const r of rounds) {
      m.set(r, bracket.filter(n => n.round === r).sort((a, b) => a.positionInRound - b.positionInRound))
    }
    return m
  }, [bracket, rounds])

  const selectedIndex = Math.max(0, rounds.indexOf(activeRound))
  const cols = useMemo(() => computeColumns(rounds.length, selectedIndex), [rounds.length, selectedIndex])
  const Hraw = (ROUND_SLOTS[activeRound] ?? 1) * SLOT_PX
  const tw = trackWidth(cols)
  const pan = panOffset(cols, selectedIndex)
  const viewportHeight = Math.min(Hraw, MAX_VIEWPORT_PX) + LABEL_PX
  const centerY = (i: number, n: number) => cellCenterY(i, n, Hraw)

  // When the focused round changes (or the tracked pair changes), center the
  // tracked cell vertically inside the internal viewport.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const node = trackedPath.nodes.find(n => n.round === activeRound)
    if (!node) return
    const n = ROUND_SLOTS[activeRound] ?? 1
    const c = cellCenterY(node.positionInRound, n, Hraw)
    const target = Math.max(0, c - vp.clientHeight / 2)
    vp.scrollTo({ top: target, behavior: reduce ? 'auto' : 'smooth' })
  }, [activeRound, trackedPairKey, Hraw, reduce, trackedPath])

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
        <div style={{
          position: 'relative', width: tw, height: Hraw + LABEL_PX,
          transform: `translateX(${-pan}px)`, transition: reduce ? 'none' : `transform ${ease}`,
        }}>
          {/* Columns */}
          {rounds.map((r, ci) => {
            const col = cols[ci]
            const n = ROUND_SLOTS[r]
            const spacing = Hraw / n
            const ch = cellHeight(col.tier, spacing)
            const cells = nodesByRound.get(r) ?? []
            const isFocus = col.tier === 'full'
            return (
              <div
                key={r}
                onClick={isFocus ? undefined : () => setActiveRound(r)}
                style={{
                  position: 'absolute', top: 0, left: col.left,
                  width: col.width, height: Hraw + LABEL_PX,
                  cursor: isFocus ? 'default' : 'pointer',
                  transition: reduce ? 'none' : `left ${ease}, width ${ease}`,
                }}
              >
                <div style={{
                  position: 'absolute', top: 4, left: 2,
                  fontSize: 10, fontWeight: 800, letterSpacing: '0.08em',
                  color: MUTED, textTransform: 'uppercase',
                }}>
                  {r}
                </div>
                {cells.map(node => {
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
                        position: 'absolute', left: 0, width: col.width,
                        top: centerY(node.positionInRound, n), height: ch,
                        transform: 'translateY(-50%)',
                        transition: reduce ? 'none' : `top ${ease}, width ${ease}, height ${ease}`,
                      }}
                    >
                      <BracketCell
                        node={node}
                        tier={col.tier}
                        highlight={highlight}
                        onTrackPair={onTrackPair}
                        pairKey={pairKeyFor}
                        markersByPair={markersByPair}
                        trackedPairKey={trackedPairKey}
                        isFirstRound={r === rounds[0]}
                      />
                    </div>
                  )
                })}
              </div>
            )
          })}

          {/* Connectors — keyed on activeRound so they fade in after the
              column/cell transitions settle. */}
          <svg
            key={activeRound}
            width={tw} height={Hraw + LABEL_PX}
            viewBox={`0 0 ${tw} ${Hraw + LABEL_PX}`}
            preserveAspectRatio="none"
            style={{
              position: 'absolute', top: 0, left: 0, overflow: 'visible',
              pointerEvents: 'none',
              animation: reduce ? undefined : 'drawConnFade 0.25s ease 0.35s both',
            }}
          >
            {rounds.map((r, ci) => {
              if (ci === rounds.length - 1) return null
              const nr = rounds[ci + 1]
              const n = ROUND_SLOTS[r]
              const nn = ROUND_SLOTS[nr]
              const x1 = cols[ci].left + cols[ci].width
              const x2 = cols[ci + 1].left
              const xm = (x1 + x2) / 2
              const curNodes = nodesByRound.get(r) ?? []
              const nextNodes = nodesByRound.get(nr) ?? []
              const onPath = (node: BracketNode | undefined) => node != null && trackedPath.nodes.includes(node)
              return Array.from({ length: nn }).map((_, j) => {
                const yTop = centerY(2 * j, n)
                const yBot = centerY(2 * j + 1, n)
                const yMid = centerY(j, nn)
                const topNode = curNodes[2 * j]
                const botNode = curNodes[2 * j + 1]
                const dstNode = nextNodes[j]
                const topFeeds = topNode != null && (topNode.match != null || topNode.isBye)
                const botFeeds = botNode != null && (botNode.match != null || botNode.isBye)
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
              })
            })}
          </svg>
        </div>
      </div>
    </>
  )
}
