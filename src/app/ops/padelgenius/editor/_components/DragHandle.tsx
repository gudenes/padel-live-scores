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
  /** Visual radius in SVG units (default circle render only) */
  radius?: number
  fill?: string
  stroke?: string
  label?: string
  /** Called continuously while dragging, with new normalized coords */
  onChange: (x: number, y: number) => void
  /** SVG element ref of the parent svg (needed to map clientX/Y -> svg coords) */
  svgRef: React.RefObject<SVGSVGElement | null>
  /**
   * Optional custom render. When provided, replaces the default circle+label.
   * Receives the projected SVG-space coords. Wrap returned content in an SVG element
   * (e.g. `<g>`, `<image>`) — it's mounted inside the drag-aware outer group.
   */
  renderHandle?: (px: number, py: number) => React.ReactNode
  /** Hit-area radius in SVG units. Defaults to `radius + 8`. */
  hitRadius?: number
}

export function DragHandle({ x, y, bounds, radius = 6, fill = '#fff', stroke = '#1a1a2e', label, onChange, svgRef, renderHandle, hitRadius }: DragHandleProps) {
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

  const hr = hitRadius ?? radius + 8

  return (
    <g
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      {/* Invisible hit area — keeps the tap target generous regardless of visual size */}
      <circle cx={px} cy={py} r={hr} fill="transparent" />
      {renderHandle ? (
        renderHandle(px, py)
      ) : (
        <>
          <circle cx={px} cy={py} r={radius} fill={fill} stroke={stroke} strokeWidth={2} />
          {label && <text x={px} y={py + 3} textAnchor="middle" fontSize={9} fontWeight={900} fill="#fff" stroke="#000" strokeWidth={0.6} paintOrder="stroke">{label}</text>}
        </>
      )}
    </g>
  )
}
