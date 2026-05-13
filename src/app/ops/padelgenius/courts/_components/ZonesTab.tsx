'use client'
import type { CourtConfig, CourtZones } from '@/lib/padelgenius/types'
import { SliderRow } from './SliderRow'

export function ZonesTab({ config, onChange }: { config: CourtConfig; onChange: (c: CourtConfig) => void }) {
  const setZ = (key: keyof CourtZones, v: number) => onChange({ ...config, zones: { ...config.zones, [key]: v } })
  const z = config.zones
  const farDefEnd     = Math.max(0, 50 - z.transitionDepth)
  const farTransEnd   = Math.max(0, 50 - z.attackDepth)
  const nearAttEnd    = Math.min(100, 50 + z.attackDepth)
  const nearTransEnd  = Math.min(100, 50 + z.transitionDepth)

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
      <div style={{ flex: '0 0 280px' }}>
        <div style={{ position: 'relative', width: '100%', aspectRatio: '2/3', background: `url("${config.imageUrl}") center/cover`, border: '2px solid #2a2a3e', borderRadius: 8, overflow: 'hidden' }}>
          {/* Zone bands */}
          <Band yTop={0}            yBot={farDefEnd}   color="rgba(52,152,219,0.30)" label="DEFENSE" />
          <Band yTop={farDefEnd}    yBot={farTransEnd} color="rgba(243,156,18,0.28)" label="TRANSITION" />
          <Band yTop={farTransEnd}  yBot={50}          color="rgba(231,76,60,0.30)"  label="ATTACK" />
          <Band yTop={50}           yBot={nearAttEnd}  color="rgba(231,76,60,0.30)"  label="ATTACK" />
          <Band yTop={nearAttEnd}   yBot={nearTransEnd} color="rgba(243,156,18,0.28)" label="TRANSITION" />
          <Band yTop={nearTransEnd} yBot={100}         color="rgba(52,152,219,0.30)" label="DEFENSE" />
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

function Band({ yTop, yBot, color, label }: { yTop: number; yBot: number; color: string; label: string }) {
  if (yBot - yTop < 1) return null
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0,
      top: `${yTop}%`, height: `${yBot - yTop}%`,
      background: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontSize: 10, fontWeight: 900, letterSpacing: 1.2, textShadow: '0 1px 2px rgba(0,0,0,0.6)',
      pointerEvents: 'none',
    }}>{label}</div>
  )
}
