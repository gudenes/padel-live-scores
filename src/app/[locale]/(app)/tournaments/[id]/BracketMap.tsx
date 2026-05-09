// src/app/[locale]/(app)/tournaments/[id]/BracketMap.tsx
'use client'

import { useTranslations } from 'next-intl'
import type { BracketNode, RoundCode, PairPath } from './bracket-builder'
import { ROUND_SLOTS } from './bracket-builder'

const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const MUTED = '#6B7280'

type Props = {
  rounds: RoundCode[]                  // rounds in this bracket, e.g. ['R32','R16','QF','SF','F']
  bracket: BracketNode[]
  trackedPath: PairPath
  trackedPairLabel: string | null      // header label, null when no tracking
  activeRound: RoundCode
  onJumpToRound: (r: RoundCode) => void
}

const VIEWBOX_W = 320
const VIEWBOX_H = 140
const TOP_Y = 22
const BOTTOM_Y = 120

export default function BracketMap({
  rounds, bracket, trackedPath, trackedPairLabel,
  activeRound, onJumpToRound,
}: Props) {
  const t = useTranslations('draw')

  // Compute X position for each round column (evenly spaced).
  const colX = (idx: number) => {
    if (rounds.length === 1) return VIEWBOX_W / 2
    return 30 + (idx * (VIEWBOX_W - 60)) / (rounds.length - 1)
  }

  // Compute Y position for a node within its round (evenly spaced top→bottom).
  const nodeY = (round: RoundCode, pos: number) => {
    const slots = ROUND_SLOTS[round]
    if (slots === 1) return (TOP_Y + BOTTOM_Y) / 2
    return TOP_Y + (pos * (BOTTOM_Y - TOP_Y)) / (slots - 1)
  }

  const trackedSet = new Set(trackedPath.nodes)

  // Render links — solid green for tracked path, dashed grey otherwise.
  const links: React.ReactNode[] = []
  for (let ri = 1; ri < rounds.length; ri++) {
    const round = rounds[ri]
    const prevRound = rounds[ri - 1]
    const xCurr = colX(ri)
    const xPrev = colX(ri - 1)
    const xMid = (xPrev + xCurr) / 2
    const slots = ROUND_SLOTS[round]
    for (let pos = 0; pos < slots; pos++) {
      const yCurr = nodeY(round, pos)
      const yPrevTop = nodeY(prevRound, pos * 2)
      const yPrevBot = nodeY(prevRound, pos * 2 + 1)
      const currNode = bracket.find(n => n.round === round && n.positionInRound === pos)
      const isTrackedHere = currNode != null && trackedSet.has(currNode)
      // Highlight only the segment that's actually on the tracked path
      const topNode = currNode?.feedFromTop ?? null
      const botNode = currNode?.feedFromBottom ?? null
      const topOnPath = topNode != null && trackedSet.has(topNode)
      const botOnPath = botNode != null && trackedSet.has(botNode)

      links.push(
        <g key={`link-${round}-${pos}`}>
          {/* Top feeder line */}
          <line
            x1={xPrev} y1={yPrevTop} x2={xMid} y2={yPrevTop}
            stroke={topOnPath ? GREEN : 'rgba(255,255,255,0.08)'}
            strokeWidth={topOnPath ? 2.5 : 1.5}
            strokeDasharray={topOnPath || isTrackedHere ? '' : '3,2'}
            fill="none"
          />
          {/* Bottom feeder line */}
          <line
            x1={xPrev} y1={yPrevBot} x2={xMid} y2={yPrevBot}
            stroke={botOnPath ? GREEN : 'rgba(255,255,255,0.08)'}
            strokeWidth={botOnPath ? 2.5 : 1.5}
            strokeDasharray={botOnPath || isTrackedHere ? '' : '3,2'}
            fill="none"
          />
          {/* Vertical connector */}
          <line
            x1={xMid} y1={yPrevTop} x2={xMid} y2={yPrevBot}
            stroke={(topOnPath || botOnPath) ? GREEN : 'rgba(255,255,255,0.08)'}
            strokeWidth={(topOnPath || botOnPath) ? 2.5 : 1.5}
            fill="none"
          />
          {/* Mid → current connector */}
          <line
            x1={xMid} y1={yCurr} x2={xCurr} y2={yCurr}
            stroke={isTrackedHere ? GREEN : 'rgba(255,255,255,0.08)'}
            strokeWidth={isTrackedHere ? 2.5 : 1.5}
            strokeDasharray={isTrackedHere ? '' : '3,2'}
            fill="none"
          />
        </g>,
      )
    }
  }

  return (
    <div style={{
      background: '#0F0F0F', padding: '14px 12px 10px', marginBottom: 14,
      clipPath: 'polygon(0% 2%, 99.5% 0%, 100% 98%, 0.5% 100%)',
    }}>
      <div style={{
        color: trackedPairLabel ? '#9CA3AF' : MUTED, fontSize: 9, letterSpacing: '0.08em',
        textTransform: 'uppercase', marginBottom: 8, textAlign: 'center', fontWeight: 700,
      }}>
        {trackedPairLabel
          ? `${trackedPairLabel} · ${t('roadToTrophy')}`
          : t('roadToTrophy')}
      </div>
      <svg viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`} preserveAspectRatio="xMidYMid meet"
           style={{ width: '100%', height: 140, display: 'block' }}>
        {/* Round labels */}
        {rounds.map((r, i) => (
          <text
            key={r}
            x={colX(i)} y={12}
            fill={r === activeRound ? '#fff' : MUTED}
            fontSize="9" fontFamily="Inter, sans-serif"
            letterSpacing="0.06em" fontWeight="700"
            textAnchor="middle"
          >
            {r}
          </text>
        ))}
        {links}
        {/* Nodes */}
        {bracket.map(node => {
          const ri = rounds.indexOf(node.round)
          if (ri < 0) return null
          const x = colX(ri)
          const y = nodeY(node.round, node.positionInRound)
          const isTracked = trackedSet.has(node)
          const isActiveRound = node.round === activeRound
          const isCurrent = isTracked && isActiveRound
          const r = node.round === 'F' ? 6 : node.round === 'R64' || node.round === 'R32' ? 3 : 4
          let fill = '#2a2a2a'
          let stroke = 'rgba(255,255,255,0.08)'
          if (isCurrent) { fill = GREEN; stroke = GREEN }
          else if (isTracked) { fill = 'rgba(126,211,33,0.55)'; stroke = GREEN }
          if (node.isBye) {
            return (
              <text
                key={`bye-${node.round}-${node.positionInRound}`}
                x={x} y={y + 3}
                fill={MUTED} fontSize="7" textAnchor="middle"
                fontFamily="Inter, sans-serif" fontWeight="700"
              >
                {t('byeLabel')}
              </text>
            )
          }
          return (
            <circle
              key={`${node.round}-${node.positionInRound}`}
              cx={x} cy={y} r={r}
              fill={fill} stroke={stroke} strokeWidth={1}
              style={{ cursor: 'pointer' }}
              onClick={() => onJumpToRound(node.round)}
            />
          )
        })}
        {/* Trophy ★ at the F node */}
        {rounds.includes('F') && (
          <text
            x={colX(rounds.indexOf('F'))} y={nodeY('F', 0) + 22}
            textAnchor="middle" fontSize="11" fill={ORANGE}
          >
            ★
          </text>
        )}
      </svg>
    </div>
  )
}
