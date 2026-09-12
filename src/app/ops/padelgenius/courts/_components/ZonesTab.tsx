'use client'
import type { CourtConfig, CourtZones } from '@/lib/padelgenius/types'
import { SliderRow } from './SliderRow'
import { toSvg, W, H } from '@/lib/padelgenius/projection'

export function ZonesTab({ config, onChange }: { config: CourtConfig; onChange: (c: CourtConfig) => void }) {
  const setZ = (key: keyof CourtZones, v: number) => onChange({ ...config, zones: { ...config.zones, [key]: v } })
  const z = config.zones
  const bounds = config.bounds

  // Zone y boundaries in court coords (0 = back glass, 50 = net, 100 = near glass)
  const farDefEnd    = Math.max(0,   50 - z.transitionDepth)
  const farTransEnd  = Math.max(0,   50 - z.attackDepth)
  const nearAttEnd   = Math.min(100, 50 + z.attackDepth)
  const nearTransEnd = Math.min(100, 50 + z.transitionDepth)

  // Trapezoid extent at a given court y (0-100). Returns percentages of the container.
  const trapAt = (y: number) => {
    const [leftPx,  yPx] = toSvg(0,   y, bounds)
    const [rightPx, _ ]  = toSvg(100, y, bounds)
    return {
      leftPct:  (leftPx  / W) * 100,
      rightPct: (rightPx / W) * 100,
      yPct:     (yPx     / H) * 100,
    }
  }

  // Build a polygon's "points" string for a zone band between two court y values.
  // Vertices: top-left, top-right, bottom-right, bottom-left.
  const polygonPoints = (yTop: number, yBot: number) => {
    const top = trapAt(yTop)
    const bot = trapAt(yBot)
    return `${top.leftPct},${top.yPct} ${top.rightPct},${top.yPct} ${bot.rightPct},${bot.yPct} ${bot.leftPct},${bot.yPct}`
  }

  const labelPos = (yTop: number, yBot: number) => {
    const mid = trapAt((yTop + yBot) / 2)
    return { x: (mid.leftPct + mid.rightPct) / 2, y: mid.yPct }
  }

  const ZONES = [
    { yTop: 0,            yBot: farDefEnd,    color: 'rgba(52,152,219,0.30)',  label: 'DEFENSE' },
    { yTop: farDefEnd,    yBot: farTransEnd,  color: 'rgba(243,156,18,0.28)',  label: 'TRANSITION' },
    { yTop: farTransEnd,  yBot: 50,           color: 'rgba(231,76,60,0.30)',   label: 'ATTACK' },
    { yTop: 50,           yBot: nearAttEnd,   color: 'rgba(231,76,60,0.30)',   label: 'ATTACK' },
    { yTop: nearAttEnd,   yBot: nearTransEnd, color: 'rgba(243,156,18,0.28)',  label: 'TRANSITION' },
    { yTop: nearTransEnd, yBot: 100,          color: 'rgba(52,152,219,0.30)',  label: 'DEFENSE' },
  ]

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
      <div style={{ flex: '0 0 280px' }}>
        <div style={{ position: 'relative', width: '100%', aspectRatio: '2/3', background: `url("${config.imageUrl}") center/cover`, border: '2px solid #2a2a3e', borderRadius: 8, overflow: 'hidden' }}>
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          >
            {ZONES.map((zone, i) => {
              if (zone.yBot - zone.yTop < 0.5) return null
              const lbl = labelPos(zone.yTop, zone.yBot)
              return (
                <g key={i}>
                  <polygon points={polygonPoints(zone.yTop, zone.yBot)} fill={zone.color} />
                  <text
                    x={lbl.x} y={lbl.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#fff"
                    fontSize={2.4}
                    fontWeight={900}
                    letterSpacing={0.3}
                    stroke="rgba(0,0,0,0.6)"
                    strokeWidth={0.3}
                    paintOrder="stroke"
                  >
                    {zone.label}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>
      </div>
      <div style={{ flex: 1, color: '#aaa' }}>
        <SliderRow label="attack depth (from net)"      value={z.attackDepth}     min={2} max={45} step={1} color="#ef4444" onChange={v => setZ('attackDepth', v)} />
        <div style={{ height: 8 }} />
        <SliderRow label="transition depth (from net)"  value={z.transitionDepth} min={z.attackDepth + 1} max={49} step={1} color="#f97316" onChange={v => setZ('transitionDepth', v)} />
        <div style={{ marginTop: 14, fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
          Defense — behind the service line (in real padel, this is where you defend lobs and back-wall shots).<br/>
          Transition — between service line and the attack zone.<br/>
          Attack — adjacent to the net.
        </div>
      </div>
    </div>
  )
}
