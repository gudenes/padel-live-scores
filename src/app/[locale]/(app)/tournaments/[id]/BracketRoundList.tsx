'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
// Per-cell vertical slot. MUST be >= the actual rendered cell height
// or `justify-content: space-around` can't distribute cells evenly —
// they overflow and stack tight at the top, while R16/QF/SF/F columns
// (with fewer cells, no overflow) keep the spread layout. The mismatch
// makes connector lines from low-R32 cells point ~180px above where
// R16 cells actually land.
//
// Cells render ~68px tall (two pair rows + scheduled time + padding).
// 72 gives 4px breathing room per slot — enough that space-around
// produces stable, even distribution across all rounds, so the
// midpoint of two R32 cells lines up exactly with their R16 destination.
const CELL_SLOT_PX = 72
// Width of the SVG connector overlay between columns. Drawn into the
// space between columns to link two source cells to one destination cell.
const CONNECTOR_PX = 14
// Height of the per-column sticky round label that pins below the
// chip strip while the user scrolls through a tall column.
const LABEL_PX = 26

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
  /** Optional content rendered above the round chip strip inside the
   *  sticky header — typically the FollowingPill, so the tracked-pair
   *  context bar travels with the chips during page scroll. */
  stickyHeader?: React.ReactNode
}

export default function BracketRoundList({
  bracket, rounds, activeRound, setActiveRound,
  trackedPairKey, trackedPath, trackingVariant, onTrackPair, markersByPair,
  stickyHeader,
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

  // Measured cell centers, keyed by round → array indexed by
  // positionInRound. We can't use the (2k+0.5)/N percentage math for
  // connector endpoints because cells are intrinsically taller than
  // the per-cell slot we allocate (CELL_SLOT_PX is chosen for a dense
  // visual, but actual cells render ~68-69px tall with two pair rows
  // + scheduled time + padding). When cells overflow their slots,
  // `space-around` can't distribute them evenly and they stack tightly
  // — leaving the percentage-based connector endpoints pointing at
  // empty space. Measuring after layout fixes this without forcing
  // cells into a slot they don't fit in.
  const [cellCenters, setCellCenters] = useState<Map<RoundCode, number[]>>(new Map())
  // Use bracket.length as a dep proxy — the bracket object identity
  // changes every render but the structure (cell count per round) only
  // changes when the underlying tournament data changes. Measuring on
  // mount and on data changes is enough; we don't need to re-measure
  // on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const next = new Map<RoundCode, number[]>()
    let changed = false
    for (const r of rounds) {
      const col = columnRefs.current.get(r)
      if (!col) continue
      const colTop = col.getBoundingClientRect().top
      const arr: number[] = []
      for (const c of col.querySelectorAll('[data-pos]')) {
        const pos = parseInt((c as HTMLElement).dataset.pos ?? '', 10)
        if (Number.isNaN(pos)) continue
        const cr = (c as HTMLElement).getBoundingClientRect()
        arr[pos] = cr.top - colTop + cr.height / 2
      }
      next.set(r, arr)
      const prev = cellCenters.get(r)
      if (!prev || prev.length !== arr.length || prev.some((v, i) => v !== arr[i])) {
        changed = true
      }
    }
    if (changed || next.size !== cellCenters.size) setCellCenters(next)
  }, [bracket.length, rounds.join(',')])

  // One ref per round column so chip-clicks can scrollIntoView and the
  // observer can attach. Stable across renders.
  const columnRefs = useRef<Map<RoundCode, HTMLDivElement | null>>(new Map())
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const stickyHeaderRef = useRef<HTMLDivElement | null>(null)

  // Stack our sticky header below any preceding sticky element (the
  // tournament page's own sticky header carrying Tournament Detail +
  // banner + page tabs). We can't know its height at build time and
  // it can vary per viewport, so we measure once on mount and on
  // viewport resize.
  const [stickyTop, setStickyTop] = useState(0)
  useEffect(() => {
    const measure = () => {
      const ours = stickyHeaderRef.current
      if (!ours) return
      let total = 0
      for (const el of document.querySelectorAll('*')) {
        if (el === ours) continue
        const cs = getComputedStyle(el)
        if (cs.position !== 'sticky' || cs.top !== '0px') continue
        // Only count sticky elements that come BEFORE ours in the
        // document — otherwise we'd pick up sticky footers etc.
        const order = ours.compareDocumentPosition(el)
        if (!(order & Node.DOCUMENT_POSITION_PRECEDING)) continue
        total += el.getBoundingClientRect().height
      }
      setStickyTop(total)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(document.body)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [])
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
  // horizontal scroll container to the matching column AND, if a pair
  // is tracked, scroll vertically so the tracked cell in the new round
  // sits in the middle of the viewport. Otherwise the user lands on
  // the column but might have to hunt for the matchup — especially in
  // QF/SF/F where the tracked cell can be hundreds of pixels down.
  useEffect(() => {
    const containerEl = scrollContainerRef.current
    const colEl = columnRefs.current.get(activeRound)
    if (!containerEl || !colEl) return
    const containerRect = containerEl.getBoundingClientRect()
    const colRect = colEl.getBoundingClientRect()
    const targetLeft = containerEl.scrollLeft + (colRect.left - containerRect.left)
    const needsHScroll = Math.abs(containerEl.scrollLeft - targetLeft) >= 4
    if (needsHScroll) {
      programmaticScrollUntil.current = Date.now() + 500
      containerEl.scrollTo({ left: targetLeft, behavior: 'smooth' })
    }
    // Auto-focus the tracked pair's cell in this round, if any.
    const trackedNode = trackedPath.nodes.find(n => n.round === activeRound)
    if (!trackedNode) return
    const cellEl = colEl.querySelector(`[data-pos="${trackedNode.positionInRound}"]`)
    if (!(cellEl instanceof HTMLElement)) return
    // Defer a tick so the horizontal smooth-scroll has settled and the
    // sticky header is in its final position; otherwise the centering
    // computes against an in-flight viewport.
    const t = window.setTimeout(() => {
      const scrollAncestor = findScrollAncestor(cellEl)
      if (!scrollAncestor) return
      const myHeaderHeight = stickyHeaderRef.current?.getBoundingClientRect().height ?? 0
      const totalSticky = stickyTop + myHeaderHeight
      const containerRect = scrollAncestor.getBoundingClientRect()
      const cellRect = cellEl.getBoundingClientRect()
      const availableHeight = scrollAncestor.clientHeight - totalSticky
      const desiredCellTop = containerRect.top + totalSticky + (availableHeight - cellRect.height) / 2
      const delta = cellRect.top - desiredCellTop
      const newTop = Math.max(0, scrollAncestor.scrollTop + delta)
      scrollAncestor.scrollTo({ top: newTop, behavior: 'smooth' })
    }, needsHScroll ? 350 : 0)
    return () => window.clearTimeout(t)
  }, [activeRound, trackedPairKey, stickyTop])

  return (
    <>
      {/* Sticky header — the FollowingPill (when present) and the round
          chip strip travel together as one block during page scroll, so
          the user never loses sight of which pair they're tracking or
          which round is active.
          Top offset = ref'd at runtime against the tournament page's
          existing sticky header (Tournament Detail + banner + page tabs)
          so this sticky stacks below it instead of overlapping. */}
      <div ref={stickyHeaderRef} style={{
        position: 'sticky', top: stickyTop, zIndex: 5, background: '#1A1A1A',
        paddingTop: 4,
      }}>
        {stickyHeader}
        <div style={{
          display: 'flex', gap: 6, padding: '6px 0 10px',
          overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
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
                // Total column height = bracket cells height + label
                // band, so the label gets its own breathing room above
                // the first cell instead of overlapping it.
                height: bracketHeight + LABEL_PX,
                paddingTop: LABEL_PX,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-around',
                position: 'relative',
              }}
            >
              {/* Round label pinned to the top of the column. Lives in
                  the column's padding-top band so it doesn't squeeze
                  the first cell. */}
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
                // Dim non-tracked cells whenever the user is following a
                // pair, so the highlighted cell really stands out — not
                // only when the pair is eliminated.
                const dim = isTracking && !isTrackedHere
                const highlight = isTrackedHere
                  ? trackingVariant === 'defendingChamp' ? 'defendingChamp' : 'tracking'
                  : dim ? 'dim' : 'none'
                return (
                  <div key={node.positionInRound} data-pos={node.positionInRound}>
                    <BracketCell
                      node={node}
                      highlight={highlight}
                      onTrackPair={onTrackPair}
                      pairKey={pairKeyFor}
                      markersByPair={markersByPair}
                      trackedPairKey={trackedPairKey}
                    />
                  </div>
                )
              })}
              {/* Bracket-tree connectors between this column and the next.
                  Each pair (cell 2j, cell 2j+1) of THIS round is linked to
                  cell j of the NEXT round via a stub-vertical-stub line. */}
              {!isLast && (
                <svg
                  style={{
                    position: 'absolute',
                    right: -CONNECTOR_PX,
                    // Span the FULL column (label band included) so the
                    // SVG coordinate system matches the column's own
                    // coordinate system. Connector y values come from
                    // measured cell centers in column-local coords.
                    top: 0,
                    width: CONNECTOR_PX,
                    height: bracketHeight + LABEL_PX,
                    overflow: 'visible',
                    pointerEvents: 'none',
                  }}
                  viewBox={`0 0 ${CONNECTOR_PX} ${bracketHeight + LABEL_PX}`}
                  preserveAspectRatio="none"
                >
                  {Array.from({ length: nextN }).map((_, j) => {
                    const sourcePositions = cellCenters.get(r)
                    const dstPositions = cellCenters.get(rounds[ri + 1])
                    // Prefer measured positions; fall back to even
                    // distribution if the measurement hasn't run yet
                    // (first paint before useLayoutEffect commits).
                    const fallbackTop = ((2 * j + 0.5) / N) * bracketHeight + LABEL_PX
                    const fallbackBot = ((2 * j + 1.5) / N) * bracketHeight + LABEL_PX
                    const fallbackMid = ((2 * j + 1) / N) * bracketHeight + LABEL_PX
                    const yTop = sourcePositions?.[2 * j] ?? fallbackTop
                    const yBot = sourcePositions?.[2 * j + 1] ?? fallbackBot
                    const yMid = dstPositions?.[j] ?? fallbackMid
                    const xMid = CONNECTOR_PX / 2
                    const topNode = cells.find(c => c.positionInRound === 2 * j) ?? null
                    const botNode = cells.find(c => c.positionInRound === 2 * j + 1) ?? null
                    const dstNode = trackedNodeAt(rounds[ri + 1], j)
                    // A position "feeds" the next round when there's
                    // SOMETHING in it — either a real match (winner
                    // advances) or a bye (the seed walks through). The
                    // earlier "skip byes" check was wrong: it left the
                    // seeded pair's bye cell visually disconnected from
                    // their R16 cell, which broke the bracket-tree
                    // illusion. Empty placeholder slots (no match, no
                    // bye) still skip — those are TBD upcoming rounds.
                    const topFeeds = topNode != null && (topNode.match != null || topNode.isBye)
                    const botFeeds = botNode != null && (botNode.match != null || botNode.isBye)
                    const topGlow = topFeeds && dstNode != null &&
                      trackedPath.nodes.includes(topNode!) && trackedPath.nodes.includes(dstNode)
                    const botGlow = botFeeds && dstNode != null &&
                      trackedPath.nodes.includes(botNode!) && trackedPath.nodes.includes(dstNode)
                    const dstGlow = topGlow || botGlow
                    const lineProps = (glow: boolean) => ({
                      stroke: glow ? GREEN : 'rgba(255,255,255,0.18)',
                      strokeWidth: glow ? 2 : 1,
                      fill: 'none',
                    })
                    // Vertical bar geometry depends on which sides feed:
                    // - both feed: full bar from yTop to yBot
                    // - only top feeds: half bar from yTop down to yMid
                    // - only bot feeds: half bar from yMid down to yBot
                    // - neither feeds: skip entirely (rare — both byes)
                    let vY1: number | null = null
                    let vY2: number | null = null
                    if (topFeeds && botFeeds) { vY1 = yTop; vY2 = yBot }
                    else if (topFeeds) { vY1 = yTop; vY2 = yMid }
                    else if (botFeeds) { vY1 = yMid; vY2 = yBot }
                    return (
                      <g key={j}>
                        {topFeeds && (
                          <line x1={0} y1={yTop} x2={xMid} y2={yTop} {...lineProps(topGlow)} />
                        )}
                        {botFeeds && (
                          <line x1={0} y1={yBot} x2={xMid} y2={yBot} {...lineProps(botGlow)} />
                        )}
                        {vY1 != null && vY2 != null && (
                          <line x1={xMid} y1={vY1} x2={xMid} y2={vY2} {...lineProps(topGlow || botGlow)} />
                        )}
                        {(topFeeds || botFeeds) && (
                          <line x1={xMid} y1={yMid} x2={CONNECTOR_PX} y2={yMid} {...lineProps(dstGlow)} />
                        )}
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

/**
 * Find the page-level vertical scroll container that the user actually
 * sees scroll when they swipe. In this layout it's `.app-screen` (the
 * mobile-frame wrapper). We can't naively walk up looking for the first
 * ancestor with `overflow-y: auto` because:
 *   1. The horizontal-scroll container has `overflow-x: auto` and CSS
 *      implicitly resolves `overflow-y` to `auto`, even though the
 *      author meant for it to stay `visible` vertically.
 *   2. Cells in a flex column with explicit height can overflow the
 *      box by a few pixels (rounding / line-height quirks), giving
 *      that container a tiny scrollHeight > clientHeight gap that's
 *      not the scroll the user is doing.
 *
 * Querying `.app-screen` directly is the most reliable resolution for
 * this app. Fallback walks up if the layout ever changes.
 */
function findScrollAncestor(el: Element): HTMLElement | null {
  const appScreen = el.closest('.app-screen')
  if (appScreen instanceof HTMLElement) return appScreen
  let cur: HTMLElement | null = el.parentElement
  while (cur) {
    const cs = getComputedStyle(cur)
    const yScrollable = cs.overflowY === 'auto' || cs.overflowY === 'scroll'
    const xScrollable = cs.overflowX === 'auto' || cs.overflowX === 'scroll'
    // Skip horizontal-only scroll containers (CSS spec quirk implicitly
    // sets overflow-y: auto when overflow-x is set).
    if (yScrollable && !xScrollable && cur.scrollHeight > cur.clientHeight) return cur
    cur = cur.parentElement
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement
}

