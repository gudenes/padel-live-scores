// src/app/ops/padelgenius/editor/_components/DragHandle.tsx
'use client'
import { useRef } from 'react'
import { fromSvg, toSvg, W, H } from '@/lib/padelgenius/projection'
import type { CourtBounds } from '@/lib/padelgenius/types'

export interface DragHandleProps {
  /** Current normalized court coords (0–100) */
  x: number
  y: number
  bounds: CourtBounds
  /** Visual radius in SVG units */
  radius?: number
  fill: string
  stroke?: string
  label?: string
  /** Called continuously while dragging, with new normalized coords */
  onChange: (x: number, y: number) => void
  /** SVG element ref of the parent svg (needed to map clientX/Y -> svg coords) */
  svgRef: React.RefObject<SVGSVGElement | null>
}

export function DragHandle({ x, y, bounds, radius = 6, fill, stroke = '#1a1a2e', label, onChange, svgRef }: DragHandleProps) {
  const draggingRef = useRef(false)
  const [px, py] = toSvg(x, y, bounds)

  const start = (e: React.PointerEvent<SVGGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingRef.current = true
  }
  const move = (e: React.PointerEvent<SVGGElement>) => {
    if (!draggingRef.current || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const scaleX = W / rect.width
    const scaleY = H / rect.height
    const svgX = (e.clientX - rect.left) * scaleX
    const svgY = (e.clientY - rect.top) * scaleY
    const [nx, ny] = fromSvg(svgX, svgY, bounds)
    // Clamp to 0–100 even if pointer leaves the trapezoid
    const cx = Math.max(0, Math.min(100, nx === -1 ? x : nx))
    const cy = Math.max(0, Math.min(100, ny === -1 ? y : ny))
    onChange(cx, cy)
  }
  const end = (e: React.PointerEvent<SVGGElement>) => {
    draggingRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
  }

  return (
    <g
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <circle cx={px} cy={py} r={radius + 8} fill="transparent" /> {/* hit area */}
      <circle cx={px} cy={py} r={radius} fill={fill} stroke={stroke} strokeWidth={2} />
      {label && <text x={px} y={py + 3} textAnchor="middle" fontSize={9} fontWeight={900} fill="#fff" stroke="#000" strokeWidth={0.6} paintOrder="stroke">{label}</text>}
    </g>
  )
}
