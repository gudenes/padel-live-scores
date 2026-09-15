'use client'
import type { CourtBounds } from '@/lib/padelgenius/types'

export function LandmarkOverlay({ bounds }: { bounds: CourtBounds }) {
  // Each landmark renders as a horizontal dashed line + label.
  const lines: { y: number; color: string; label: string }[] = [
    { y: bounds.backGlassY,   color: '#ef4444', label: 'BACK GLASS · y=0' },
    { y: bounds.backServiceY, color: '#38c8ff', label: 'BACK SERVICE · y=33' },
    { y: bounds.netY,         color: '#22c55e', label: 'NET · y=50' },
    { y: bounds.nearServiceY, color: '#38c8ff', label: 'NEAR SERVICE · y=67' },
    { y: bounds.nearGlassY,   color: '#ef4444', label: 'NEAR GLASS · y=100' },
  ]
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      {lines.map((l, i) => (
        <g key={i}>
          <line x1="0" y1={l.y * 100} x2="100" y2={l.y * 100} stroke={l.color} strokeWidth="0.4" strokeDasharray="1.5 1" opacity="0.85" />
          <text x="1" y={l.y * 100 - 0.6} fill={l.color} fontSize="2" fontWeight="900" stroke="#fff" strokeWidth="0.4" paintOrder="stroke">{l.label}</text>
        </g>
      ))}
      {/* Yellow trapezoid */}
      <polygon
        points={`${bounds.farLeftX * 100},${bounds.backGlassY * 100} ${bounds.farRightX * 100},${bounds.backGlassY * 100} ${bounds.nearRightX * 100},${bounds.nearGlassY * 100} ${bounds.nearLeftX * 100},${bounds.nearGlassY * 100}`}
        fill="none" stroke="#fde047" strokeWidth="0.5" strokeDasharray="2 1" opacity="0.9" />
      {([[bounds.farLeftX, bounds.backGlassY], [bounds.farRightX, bounds.backGlassY], [bounds.nearLeftX, bounds.nearGlassY], [bounds.nearRightX, bounds.nearGlassY]] as [number, number][]).map(([x, y], i) => (
        <circle key={i} cx={x * 100} cy={y * 100} r="0.9" fill="#fde047" stroke="#1a1a2e" strokeWidth="0.3" />
      ))}
    </svg>
  )
}
