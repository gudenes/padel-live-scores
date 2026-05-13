// src/app/[locale]/(app)/padelgenius/components/PositionedOptions.tsx
'use client'
import { useEffect, useState } from 'react'
import type { QuestionOption, OptionId } from '@/lib/padelgenius/types'
import { toSvg } from '@/lib/padelgenius/projection'
import { DEFAULT_COURT } from '@/lib/padelgenius/default-court'

export interface PositionedOptionsProps {
  options: QuestionOption[]
  phase: 'idle' | 'selecting' | 'revealing'
  selectedId: OptionId | null
  correctId: OptionId | null
  onSelect: (id: OptionId) => void
  onConfirm: () => void
}

const ROTATIONS: Record<OptionId, number> = { a: -4, b: 6, c: -3, d: 5 }

const PILL_MIN_W_LABEL = 76
const PILL_W_CONFIRM = 70
const PILL_GAP = 4
const PILL_PADDING_X = 8
const PILL_CHAR_WIDTH_EST = 6.6
const PILL_MIN_W_REVEAL = 70
const BADGE_RADIUS = 7

// I3: hook to respect prefers-reduced-motion in JS (inline style overrides CSS media queries)
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return reduced
}

// I2: StatusBadge helper — replaces near-identical check/cross badge blocks
function StatusBadge({ state, offsetY }: { state: 'correct' | 'wrong'; offsetY: number }) {
  const fill = state === 'correct' ? '#22c55e' : '#ef4444'
  return (
    <g transform={`translate(0 ${offsetY})`}>
      <circle r={BADGE_RADIUS} fill={fill} stroke="#fff" strokeWidth={2} />
      {state === 'correct' ? (
        <path d="M -3 0 L -1 2.5 L 3 -2" stroke="#fff" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" stroke="#fff" strokeWidth={2} fill="none" strokeLinecap="round" />
      )}
    </g>
  )
}

export function PositionedOptions({ options, phase, selectedId, correctId, onSelect, onConfirm }: PositionedOptionsProps) {
  const bounds = DEFAULT_COURT.bounds
  const revealed = phase === 'revealing'
  // Pull letter radius from visualSystem — user feedback: default 22 was too large
  const r = DEFAULT_COURT.visualSystem.letterRadius
  const reducedMotion = useReducedMotion() // I3

  return (
    <g>
      {options.map(opt => {
        const [cx, cy] = toSvg(opt.letter.x, opt.letter.y, bounds)
        const isSelected = !revealed && opt.id === selectedId
        const isCorrect = revealed && opt.id === correctId
        // B2: null guard — prevents red badges when correctId=null during 'revealing' phase
        const isPickedWrong = revealed && correctId !== null && opt.id === selectedId && opt.id !== correctId
        const dimmed = revealed && !isCorrect && !isPickedWrong
        const rot = ROTATIONS[opt.id]

        let fill = '#FFFFFF', textColor = '#1A1A2E'
        if (isCorrect)          { fill = '#22C55E'; textColor = '#FFFFFF' }
        else if (isPickedWrong) { fill = '#EF4444'; textColor = '#FFFFFF' }
        else if (isSelected)    { fill = '#1E88E5'; textColor = '#FFFFFF' }

        return (
          // B1: disable pointer events at SVG level when revealed; onClick guard stays as defense-in-depth
          <g
            key={opt.id}
            transform={`translate(${cx} ${cy}) rotate(${rot})`}
            pointerEvents={revealed ? 'none' : 'all'}
            style={{
              cursor: !revealed ? 'pointer' : 'default',
              opacity: dimmed ? 0.3 : 1,
              transition: 'opacity 200ms ease-out',
            }}
            onClick={() => { if (!revealed) onSelect(opt.id) }}
          >
            {/* drop shadow */}
            <ellipse cx="0" cy={r + 4} rx={r * 0.75} ry={3} fill="rgba(20,30,60,0.45)" />
            {/* pulsing halo when idle/selected */}
            {!revealed && (
              <circle
                r={r + 4}
                fill="none"
                stroke={isSelected ? '#1E88E5' : 'rgba(255,255,255,0.6)'}
                strokeWidth={isSelected ? 3 : 2}
                style={{
                  // I3: respect reduced-motion preference; CSS @media block is bypassed by inline style
                  animation: reducedMotion ? 'none' : (isSelected ? 'pg-pulse 1s ease-in-out infinite' : 'pg-pulse 1.6s ease-in-out infinite'),
                  transformOrigin: 'center',
                }}
              />
            )}
            {/* main circle */}
            <circle r={r} fill={fill} stroke="#1A1A2E" strokeWidth={3.5} />
            {/* letter — font size proportional to r */}
            <text
              y={1}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={textColor}
              fontSize={Math.round(r * 1.1)}
              fontWeight={900}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              {opt.id.toUpperCase()}
            </text>
            {/* I2: check/cross badges via StatusBadge — replaces near-identical inline blocks */}
            {isCorrect && <StatusBadge state="correct" offsetY={r + 14} />}
            {isPickedWrong && <StatusBadge state="wrong" offsetY={r + 14} />}
            {/* Inline label + CONFIRM when selected (pre-confirm) */}
            {isSelected && (
              <g transform={`translate(0 ${r + 28})`}>
                {/* B3: parent passes onConfirm directly; stopPropagation moved inside SelectionPillRow */}
                <SelectionPillRow
                  label={opt.label}
                  direction={opt.direction}
                  onConfirm={onConfirm}
                />
              </g>
            )}
            {/* Revealed label below the letter */}
            {(isCorrect || isPickedWrong) && (
              <g transform={`translate(0 ${r + 26})`}>
                <LabelPill label={opt.label} state={isCorrect ? 'correct' : 'wrong'} />
              </g>
            )}
          </g>
        )
      })}
    </g>
  )
}

function SelectionPillRow({
  label,
  direction,
  onConfirm,
}: {
  label: string
  direction?: string
  // B3: typed as () => void — stopPropagation handled inside this component
  onConfirm: () => void
}) {
  // I4: removed no-op `const labelText = label` — use label directly
  // I1: magic numbers replaced with named constants
  const labelW = Math.max(PILL_MIN_W_LABEL, label.length * PILL_CHAR_WIDTH_EST) + PILL_PADDING_X
  const confirmW = PILL_W_CONFIRM
  const gap = PILL_GAP
  const total = labelW + gap + confirmW
  return (
    <g>
      {/* label pill */}
      <g transform={`translate(${-total / 2 + labelW / 2} 0)`} pointerEvents="none">
        <rect x={-labelW / 2} y={-12} width={labelW} height={26} rx={13} fill="#1E88E5" stroke="#1A1A2E" strokeWidth={3} />
        {/* I5: explicit vertical centering with dominantBaseline; direction shifts label up slightly */}
        <text y={direction ? -3 : 0} textAnchor="middle" dominantBaseline="middle" fill="#fff" fontSize={11} fontWeight={900}>{label}</text>
        {direction && (
          <text y={8} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize={8} fontWeight={700}>
            {direction}
          </text>
        )}
      </g>
      {/* confirm pill — plain CONFIRM text, no emoji */}
      {/* B3: stopPropagation lives here; onConfirm called without event arg */}
      <g
        transform={`translate(${total / 2 - confirmW / 2} 0)`}
        style={{ cursor: 'pointer' }}
        onClick={(e) => { e.stopPropagation(); onConfirm() }}
      >
        <rect x={-confirmW / 2} y={-12} width={confirmW} height={26} rx={13} fill="#22C55E" stroke="#1A1A2E" strokeWidth={3} />
        <text y={4} textAnchor="middle" fill="#0a0a14" fontSize={11} fontWeight={900} letterSpacing={0.8}>
          CONFIRM
        </text>
        {/* inline tick glyph positioned to the right of the text */}
        <path
          d="M 20 -1 L 22 2 L 26 -3"
          stroke="#0a0a14"
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </g>
  )
}

function LabelPill({ label, state }: { label: string; state: 'correct' | 'wrong' }) {
  // I1: magic numbers replaced with named constants
  const w = Math.max(PILL_MIN_W_REVEAL, label.length * PILL_CHAR_WIDTH_EST) + PILL_PADDING_X
  const color = state === 'correct' ? '#22c55e' : '#ef4444'
  return (
    <g pointerEvents="none">
      <rect x={-w / 2} y={-10} width={w} height={20} rx={10} fill={color} stroke="#1A1A2E" strokeWidth={2.5} />
      <text y={4} textAnchor="middle" fill="#fff" fontSize={11} fontWeight={900}>{label}</text>
    </g>
  )
}
