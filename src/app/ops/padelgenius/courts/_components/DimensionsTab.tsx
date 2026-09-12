'use client'
import type { CourtConfig } from '@/lib/padelgenius/types'
import type { CourtBounds, VisualSystem } from '@/lib/padelgenius/types'
import { SliderRow } from './SliderRow'
import { LandmarkOverlay } from './LandmarkOverlay'

export function DimensionsTab({ config, onChange }: { config: CourtConfig; onChange: (c: CourtConfig) => void }) {
  const setBound = (key: keyof CourtBounds, v: number) => onChange({ ...config, bounds: { ...config.bounds, [key]: v } })
  const setVis   = (key: keyof VisualSystem, v: number) => onChange({ ...config, visualSystem: { ...config.visualSystem, [key]: v } })

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
      {/* Live preview */}
      <div style={{ flex: '0 0 280px' }}>
        <div style={{ position: 'relative', width: '100%', aspectRatio: '2/3', background: `url("${config.imageUrl}") center/cover`, border: '2px solid #2a2a3e', borderRadius: 8, overflow: 'hidden' }}>
          <LandmarkOverlay bounds={config.bounds} />
        </div>
      </div>

      {/* Sliders */}
      <div style={{ flex: 1, fontSize: 10, color: '#aaa', minWidth: 0 }}>
        <Group title="COURT Y LANDMARKS · 5">
          <SliderRow label="back glass Y"    value={config.bounds.backGlassY}    min={0} max={1} step={0.005} color="#ef4444" onChange={v => setBound('backGlassY', v)} />
          <SliderRow label="back service Y"  value={config.bounds.backServiceY}  min={0} max={1} step={0.005} color="#38c8ff" onChange={v => setBound('backServiceY', v)} />
          <SliderRow label="net Y"           value={config.bounds.netY}          min={0} max={1} step={0.005} color="#22c55e" onChange={v => setBound('netY', v)} />
          <SliderRow label="near service Y"  value={config.bounds.nearServiceY}  min={0} max={1} step={0.005} color="#38c8ff" onChange={v => setBound('nearServiceY', v)} />
          <SliderRow label="near glass Y"    value={config.bounds.nearGlassY}    min={0} max={1} step={0.005} color="#ef4444" onChange={v => setBound('nearGlassY', v)} />
        </Group>
        <Group title="TRAPEZOID X CORNERS · 4">
          <SliderRow label="far left X"   value={config.bounds.farLeftX}   min={0} max={1} step={0.005} color="#fde047" onChange={v => setBound('farLeftX', v)} />
          <SliderRow label="far right X"  value={config.bounds.farRightX}  min={0} max={1} step={0.005} color="#fde047" onChange={v => setBound('farRightX', v)} />
          <SliderRow label="near left X"  value={config.bounds.nearLeftX}  min={0} max={1} step={0.005} color="#fde047" onChange={v => setBound('nearLeftX', v)} />
          <SliderRow label="near right X" value={config.bounds.nearRightX} min={0} max={1} step={0.005} color="#fde047" onChange={v => setBound('nearRightX', v)} />
        </Group>
        <Group title="VISUAL SYSTEM · 5 controls">
          <SliderRow label="player base size"   value={config.visualSystem.playerBaseSize}  min={40} max={160} step={2} color="#7dd3fc" onChange={v => setVis('playerBaseSize', v)} />
          <SliderRow label="scale curve min"    value={config.visualSystem.scaleCurveMin}   min={0.5} max={1.2} step={0.01} color="#7dd3fc" onChange={v => setVis('scaleCurveMin', v)} />
          <SliderRow label="scale curve max"    value={config.visualSystem.scaleCurveMax}   min={0.8} max={2.0} step={0.01} color="#7dd3fc" onChange={v => setVis('scaleCurveMax', v)} />
          <SliderRow label="letter radius"      value={config.visualSystem.letterRadius}    min={6} max={30} step={1} color="#7dd3fc" onChange={v => setVis('letterRadius', v)} />
          <SliderRow label="progress bar tilt°" value={config.visualSystem.progressBarTilt} min={-30} max={30} step={0.5} color="#7dd3fc" onChange={v => setVis('progressBarTilt', v)} />
        </Group>
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ color: '#fde047', fontSize: 10, fontWeight: 800, letterSpacing: 1, marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 5 }}>{children}</div>
    </div>
  )
}
