// src/app/[locale]/(app)/padelgenius/components/PositionedOptions.tsx
'use client'
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

export function PositionedOptions({ options, phase, selectedId, correctId, onSelect, onConfirm }: PositionedOptionsProps) {
  const bounds = DEFAULT_COURT.bounds
  const revealed = phase === 'revealing'
  // Pull letter radius from visualSystem — user feedback: default 22 was too large
  const r = DEFAULT_COURT.visualSystem.letterRadius

  return (
    <g>
      {options.map(opt => {
        const [cx, cy] = toSvg(opt.letter.x, opt.letter.y, bounds)
        const isSelected = !revealed && opt.id === selectedId
        const isCorrect = revealed && opt.id === correctId
        const isPickedWrong = revealed && opt.id === selectedId && opt.id !== correctId
        const dimmed = revealed && !isCorrect && !isPickedWrong
        const rot = ROTATIONS[opt.id]

        let fill = '#FFFFFF', textColor = '#1A1A2E'
        if (isCorrect)          { fill = '#22C55E'; textColor = '#FFFFFF' }
        else if (isPickedWrong) { fill = '#EF4444'; textColor = '#FFFFFF' }
        else if (isSelected)    { fill = '#1E88E5'; textColor = '#FFFFFF' }

        return (
          <g
            key={opt.id}
            transform={`translate(${cx} ${cy}) rotate(${rot})`}
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
                  animation: isSelected
                    ? 'pg-pulse 1s ease-in-out infinite'
                    : 'pg-pulse 1.6s ease-in-out infinite',
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
            {/* check badge on reveal — inline SVG, no emoji */}
            {isCorrect && (
              <g transform={`translate(0 ${r + 14})`}>
                <circle r={7} fill="#22c55e" stroke="#fff" strokeWidth={2} />
                <path
                  d="M -3 0 L -1 2.5 L 3 -2"
                  stroke="#fff"
                  strokeWidth={2}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            )}
            {/* cross badge on reveal — inline SVG, no emoji */}
            {isPickedWrong && (
              <g transform={`translate(0 ${r + 14})`}>
                <circle r={7} fill="#ef4444" stroke="#fff" strokeWidth={2} />
                <path
                  d="M -3 -3 L 3 3 M 3 -3 L -3 3"
                  stroke="#fff"
                  strokeWidth={2}
                  fill="none"
                  strokeLinecap="round"
                />
              </g>
            )}
            {/* Inline label + CONFIRM when selected (pre-confirm) */}
            {isSelected && (
              <g transform={`translate(0 ${r + 28})`}>
                <SelectionPillRow
                  label={opt.label}
                  direction={opt.direction}
                  onConfirm={(e) => { e.stopPropagation(); onConfirm() }}
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
  onConfirm: (e: React.MouseEvent) => void
}) {
  const labelText = label
  const labelW = Math.max(76, labelText.length * 6.6) + 8
  const confirmW = 70
  const gap = 4
  const total = labelW + gap + confirmW
  return (
    <g>
      {/* label pill */}
      <g transform={`translate(${-total / 2 + labelW / 2} 0)`} pointerEvents="none">
        <rect x={-labelW / 2} y={-12} width={labelW} height={26} rx={13} fill="#1E88E5" stroke="#1A1A2E" strokeWidth={3} />
        <text y={-3} textAnchor="middle" fill="#fff" fontSize={11} fontWeight={900}>{labelText}</text>
        {direction && (
          <text y={9} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize={8} fontWeight={700}>
            {direction}
          </text>
        )}
      </g>
      {/* confirm pill — plain CONFIRM text, no emoji */}
      <g
        transform={`translate(${total / 2 - confirmW / 2} 0)`}
        style={{ cursor: 'pointer' }}
        onClick={onConfirm}
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
  const w = Math.max(70, label.length * 6.6) + 8
  const color = state === 'correct' ? '#22c55e' : '#ef4444'
  return (
    <g pointerEvents="none">
      <rect x={-w / 2} y={-10} width={w} height={20} rx={10} fill={color} stroke="#1A1A2E" strokeWidth={2.5} />
      <text y={4} textAnchor="middle" fill="#fff" fontSize={11} fontWeight={900}>{label}</text>
    </g>
  )
}
