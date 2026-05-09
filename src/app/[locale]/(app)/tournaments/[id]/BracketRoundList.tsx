'use client'

import { useEffect, useMemo, useRef } from 'react'
import BracketCell from './BracketCell'
import type { BracketNode, RoundCode, PairPath } from './bracket-builder'
import { ROUND_ORDER, ROUND_SLOTS, pairKeyFor } from './bracket-builder'

// Each column shares the same fixed height. Within a column, cells are
// laid out with `justify-content: space-around` so that:
//   - R32 with 16 cells distributes them evenly top-to-bottom
//   - R16 with 8 cells lands each cell at the vertical midpoint of its
//     two feeding R32 cells (math works out exactly with space-around)
//   - QF with 4 cells, SF with 2, F with 1 — same relationship continues
// The result is the classic bracket-tree pyramid where later rounds
// converge toward the vertical center.
const CELL_SLOT_PX = 70  // approx height of one cell + breathing room
// Width of the SVG connector overlay between columns. Drawn into the
// space between columns to link two source cells to one destination cell.
const CONNECTOR_PX = 14

const GREEN = '#7ED321'
const MUTED = '#6B7280'

type Props = {
  bracket: BracketNode[]
  rounds: RoundCode[]                      // rounds present in this draw, in order
  activeRound: RoundCode
  setActiveRound: (r: RoundCode) => void
  trackedPairKey: string | null
  trackedPath: PairPath
  trackingVariant: 'tracking' | 'defendingChamp' | null
  onTrackPair: (pairKey: string) => void
  markersByPair: Map<string, 'Q' | 'WC' | 'LL'>
}

export default function BracketRoundList({
  bracket, rounds, activeRound, setActiveRound,
  trackedPairKey, trackedPath, trackingVariant, onTrackPair, markersByPair,
}: Props) {
  const trackedRoundSet = new Set(trackedPath.nodes.map(n => n.round))
  const lastTrackedIdx =
    trackedPath.nodes.length > 0
      ? ROUND_ORDER.indexOf(trackedPath.nodes[trackedPath.nodes.length - 1].round)
      : -1

  // Shared height for every column. Driven by the first round (most cells)
  // so all rounds align to the same vertical extent — this is what makes
  // `justify-content: space-around` produce the bracket-tree midpoint
  // alignment.
  const bracketHeight = useMemo(() => {
    const firstRound = rounds[0]
    if (!firstRound) return 0
    return ROUND_SLOTS[firstRound] * CELL_SLOT_PX
  }, [rounds])

  // One ref per round column so chip-clicks can scrollIntoView and the
  // observer can attach. Stable across renders.
  const columnRefs = useRef<Map<RoundCode, HTMLDivElement | null>>(new Map())
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  // Track whether the current scroll was triggered programmatically (chip
  // click) so we don't fight ourselves: the observer still updates
  // activeRound during smooth scroll, but we suppress it until the
  // programmatic scroll finishes by ignoring observer events for ~400ms.
  const programmaticScrollUntil = useRef<number>(0)

  // IntersectionObserver: whichever column is most visible becomes the
  // active round. Threshold 0.55 = column is more-than-half visible.
  useEffect(() => {
    const root = scrollContainerRef.current
    if (!root || rounds.length === 0) return
    const observer = new IntersectionObserver(
      entries => {
        if (Date.now() < programmaticScrollUntil.current) return
        // Pick the entry with the highest intersection ratio that's at
        // least 0.55 visible.
        let best: { round: RoundCode; ratio: number } | null = null
        for (const entry of entries) {
          if (entry.intersectionRatio < 0.55) continue
          const round = (entry.target as HTMLElement).dataset.round as RoundCode | undefined
          if (!round) continue
          if (!best || entry.intersectionRatio > best.ratio) {
            best = { round, ratio: entry.intersectionRatio }
          }
        }
        if (best && best.round !== activeRound) {
          setActiveRound(best.round)
        }
      },
      { root, threshold: [0.55, 0.75, 0.95] },
    )
    for (const r of rounds) {
      const el = columnRefs.current.get(r)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rounds.join(','), activeRound])

  // When activeRound changes (chip click or external trigger), pan the
  // horizontal scroll container to the matching column. Use scrollTo on
  // the container directly so we never affect vertical page scroll —
  // scrollIntoView would also yank the page up to the column's top.
  useEffect(() => {
    const containerEl = scrollContainerRef.current
    const colEl = columnRefs.current.get(activeRound)
    if (!containerEl || !colEl) return
    const containerRect = containerEl.getBoundingClientRect()
    const colRect = colEl.getBoundingClientRect()
    const targetLeft = containerEl.scrollLeft + (colRect.left - containerRect.left)
    if (Math.abs(containerEl.scrollLeft - targetLeft) < 4) return
    programmaticScrollUntil.current = Date.now() + 500
    containerEl.scrollTo({ left: targetLeft, behavior: 'smooth' })
  }, [activeRound])

  return (
    <>
      {/* Round chip strip — sticks to the top of the page scroll
          container so it stays visible while the user scrolls through
          a tall column of cells. */}
      <div style={{
        display: 'flex', gap: 6, padding: '6px 0 10px',
        overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
        position: 'sticky', top: 0, zIndex: 5, background: '#1A1A1A',
      }}>
        {rounds.map(r => {
          const isActive = r === activeRound
          const isPassed = trackedRoundSet.has(r) && r !== activeRound
          const isLast = ROUND_ORDER.indexOf(r) === lastTrackedIdx && !trackedPath.eliminatedAt && trackedPath.nodes.length > 0
          const bg = isActive
            ? '#fff'
            : isPassed
            ? 'rgba(126,211,33,0.18)'
            : 'rgba(255,255,255,0.05)'
          const color = isActive
            ? '#000'
            : isPassed
            ? GREEN
            : MUTED
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

      {/* Horizontal scrollable rounds. Each column snaps to the start of
          the viewport. The next column peeks in (~12% by virtue of the
          88% column width) so the user knows there's more bracket to swipe to. */}
      <div
        ref={scrollContainerRef}
        style={{
          display: 'flex',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          scrollSnapType: 'x mandatory',
          gap: 8,
          // Negative margin so the right edge of the last column can sit
          // under the page padding, instead of clipping the peek of an
          // earlier column.
          marginRight: -12,
          paddingRight: 12,
        }}
      >
        {rounds.map((r, ri) => {
          const cells = bracket
            .filter(n => n.round === r)
            .sort((a, b) => a.positionInRound - b.positionInRound)
          const isLast = ri === rounds.length - 1
          const N = ROUND_SLOTS[r]
          const nextN = isLast ? 0 : ROUND_SLOTS[rounds[ri + 1]]
          // For each pair (2j, 2j+1) feeding cell j in the next round,
          // figure out whether the connector should glow green (the
          // tracked pair walked along that segment) or stay grey.
          const trackedNodeAt = (rr: RoundCode, pos: number) =>
            trackedPath.nodes.find(n => n.round === rr && n.positionInRound === pos) ?? null
          return (
            <div
              key={r}
              ref={el => { columnRefs.current.set(r, el) }}
              data-round={r}
              style={{
                flexShrink: 0,
                width: '88%',
                scrollSnapAlign: 'start',
                height: bracketHeight,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-around',
                position: 'relative',
              }}
            >
              {/* Tiny round label pinned to the top of the column for
                  orientation when scrolling. */}
              <div style={{
                position: 'absolute', top: 0, left: 2,
                fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                color: MUTED, textTransform: 'uppercase',
              }}>
                {r}
              </div>
              {cells.map(node => {
                const isTrackedHere = trackedPairKey != null && trackedPath.nodes.includes(node)
                const isTracking = trackedPairKey != null
                // Dim non-tracked cells whenever the user is following a
                // pair, so the highlighted cell really stands out — not
                // only when the pair is eliminated.
                const dim = isTracking && !isTrackedHere
                const highlight = isTrackedHere
                  ? trackingVariant === 'defendingChamp' ? 'defendingChamp' : 'tracking'
                  : dim ? 'dim' : 'none'
                return (
                  <BracketCell
                    key={node.positionInRound}
                    node={node}
                    highlight={highlight}
                    onTrackPair={onTrackPair}
                    pairKey={pairKeyFor}
                    markersByPair={markersByPair}
                  />
                )
              })}
              {/* Bracket-tree connectors between this column and the next.
                  Each pair (cell 2j, cell 2j+1) of THIS round is linked to
                  cell j of the NEXT round via a stub-vertical-stub line. */}
              {!isLast && (
                <svg
                  style={{
                    position: 'absolute',
                    right: -CONNECTOR_PX, top: 0,
                    width: CONNECTOR_PX, height: bracketHeight,
                    pointerEvents: 'none',
                  }}
                  viewBox={`0 0 ${CONNECTOR_PX} ${bracketHeight}`}
                  preserveAspectRatio="none"
                >
                  {Array.from({ length: nextN }).map((_, j) => {
                    const yTop = ((2 * j + 0.5) / N) * bracketHeight
                    const yBot = ((2 * j + 1.5) / N) * bracketHeight
                    const yMid = ((2 * j + 1) / N) * bracketHeight
                    const xMid = CONNECTOR_PX / 2
                    const topNode = cells.find(c => c.positionInRound === 2 * j) ?? null
                    const botNode = cells.find(c => c.positionInRound === 2 * j + 1) ?? null
                    const dstNode = trackedNodeAt(rounds[ri + 1], j)
                    // Top stub turns green only when both the source cell
                    // and the destination cell are on the tracked path —
                    // i.e. the pair actually walked from 2j → j.
                    const topGlow = topNode != null && dstNode != null &&
                      trackedPath.nodes.includes(topNode) && trackedPath.nodes.includes(dstNode)
                    const botGlow = botNode != null && dstNode != null &&
                      trackedPath.nodes.includes(botNode) && trackedPath.nodes.includes(dstNode)
                    const verticalGlow = topGlow || botGlow
                    const dstGlow = topGlow || botGlow
                    const lineProps = (glow: boolean) => ({
                      stroke: glow ? GREEN : 'rgba(255,255,255,0.18)',
                      strokeWidth: glow ? 2 : 1,
                      fill: 'none',
                    })
                    return (
                      <g key={j}>
                        <line x1={0} y1={yTop} x2={xMid} y2={yTop} {...lineProps(topGlow)} />
                        <line x1={0} y1={yBot} x2={xMid} y2={yBot} {...lineProps(botGlow)} />
                        <line x1={xMid} y1={yTop} x2={xMid} y2={yBot} {...lineProps(verticalGlow)} />
                        <line x1={xMid} y1={yMid} x2={CONNECTOR_PX} y2={yMid} {...lineProps(dstGlow)} />
                      </g>
                    )
                  })}
                </svg>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

