'use client'

import BracketCell from './BracketCell'
import type { BracketNode, RoundCode, PairPath } from './bracket-builder'
import { ROUND_ORDER, pairKeyFor } from './bracket-builder'

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

  const cellsForActive = bracket
    .filter(n => n.round === activeRound)
    .sort((a, b) => a.positionInRound - b.positionInRound)

  return (
    <>
      {/* Round chip strip */}
      <div style={{
        display: 'flex', gap: 6, padding: '4px 0 12px',
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

      {/* Cell list — paired with bracket-stub between every two cells */}
      <div>
        {chunkPairs(cellsForActive).map((pair, i) => (
          <div key={i} style={{ position: 'relative', marginBottom: 10 }}>
            {pair.map((node, j) => {
              const isTrackedHere = trackedPairKey != null && trackedPath.nodes.includes(node)
              const dim = trackedPath.eliminatedAt != null && !isTrackedHere && trackedPairKey != null
              const highlight = isTrackedHere
                ? trackingVariant === 'defendingChamp' ? 'defendingChamp' : 'tracking'
                : dim ? 'dim' : 'none'
              return (
                <div key={node.positionInRound} style={{ marginTop: j === 0 ? 0 : 4 }}>
                  <BracketCell
                    node={node}
                    highlight={highlight}
                    onTrackPair={onTrackPair}
                    pairKey={pairKeyFor}
                    markersByPair={markersByPair}
                  />
                </div>
              )
            })}
            {/* Bracket-stub on the right edge — shows pair feeding into next round */}
            {pair.length === 2 && (
              <div style={{
                position: 'absolute', right: -12, top: 0, bottom: 0, width: 12,
                pointerEvents: 'none',
              }}>
                <svg viewBox="0 0 12 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
                  <path d="M 0 25 H 6 V 75 H 0" stroke="rgba(255,255,255,0.18)" fill="none" strokeWidth="1" />
                  <path d="M 6 50 H 12" stroke="rgba(255,255,255,0.18)" fill="none" strokeWidth="1" />
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

function chunkPairs<T>(arr: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += 2) {
    out.push(arr.slice(i, i + 2))
  }
  return out
}
