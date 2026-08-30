// src/app/ops/padelgenius/courts/_components/TrajectoriesTab.tsx
'use client'
import { useRef, useState } from 'react'
import type {
  CourtConfig,
  TrajectoryStyle,
  SlotConfig,
  TrajectoryAssets,
  TrajectoryStyleOverride,
  TrajectoryOverrides,
} from '@/lib/padelgenius/types'
import { trajectoryPath, TRAJECTORY_DECOR } from '@/lib/padelgenius/trajectories'

const STYLE_META: { style: TrajectoryStyle; label: string; hint: string }[] = [
  { style: 'flat',         label: 'FLAT',         hint: 'Drive straight across' },
  { style: 'lob',          label: 'LOB',          hint: 'High arc over opponents' },
  { style: 'bandeja',      label: 'BANDEJA',      hint: 'Defensive overhead' },
  { style: 'vibora',       label: 'VIBORA',       hint: 'Slicing overhead' },
  { style: 'smash',        label: 'SMASH',        hint: 'Power overhead winner' },
  { style: 'chiquita',     label: 'CHIQUITA',     hint: 'Low slow shot at feet' },
  { style: 'wall-bounce',  label: 'WALL BOUNCE',  hint: 'Off the back wall' },
  { style: 'cross',        label: 'CROSS',        hint: 'Cross-court angle' },
]

export function TrajectoriesTab({ slug, config, onChange }: { slug: string; config: CourtConfig; onChange: (c: CourtConfig) => void }) {
  const setSlot = (style: TrajectoryStyle, value: SlotConfig | null) => {
    const next: TrajectoryAssets = { ...(config.trajectoryAssets ?? {}) }
    if (value) next[style] = value
    else delete next[style]
    onChange({ ...config, trajectoryAssets: next })
  }
  const setOverride = (style: TrajectoryStyle, value: TrajectoryStyleOverride | null) => {
    const next: TrajectoryOverrides = { ...(config.trajectoryOverrides ?? {}) }
    if (value && Object.values(value).some(v => v !== undefined)) next[style] = value
    else delete next[style]
    onChange({ ...config, trajectoryOverrides: next })
  }

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
      <div style={{ flex: '0 0 280px' }}>
        <div style={{ position: 'relative', width: '100%', aspectRatio: '2/3', background: `url("${config.imageUrl}") center/cover`, border: '2px solid #2a2a3e', borderRadius: 8, overflow: 'hidden' }} />
        <div style={{ marginTop: 10, fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
          Upload a custom asset for any style — or use the inline controls below to tune the procedural line (color, thickness, dash, decorations).
          Assets always win when uploaded; inline overrides apply only when no asset is set.
        </div>
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
        {STYLE_META.map(m => (
          <TrajectorySlotCard
            key={m.style}
            slug={slug}
            style={m.style}
            label={m.label}
            hint={m.hint}
            value={config.trajectoryAssets?.[m.style] ?? null}
            override={config.trajectoryOverrides?.[m.style] ?? null}
            onChangeValue={v => setSlot(m.style, v)}
            onChangeOverride={v => setOverride(m.style, v)}
          />
        ))}
      </div>
    </div>
  )
}

function TrajectorySlotCard({
  slug, style, label, hint, value, override, onChangeValue, onChangeOverride,
}: {
  slug: string
  style: TrajectoryStyle
  label: string
  hint: string
  value: SlotConfig | null
  override: TrajectoryStyleOverride | null
  onChangeValue: (next: SlotConfig | null) => void
  onChangeOverride: (next: TrajectoryStyleOverride | null) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)

  const upload = async (file: File) => {
    setBusy(true)
    const fd = new FormData()
    fd.append('style', style)
    fd.append('asset', file)
    fd.append('scale', String(value?.scale ?? 1.0))
    const r = await fetch(`/api/ops/padelgenius/courts/${slug}/trajectory`, { method: 'POST', body: fd })
    setBusy(false)
    if (!r.ok) { alert('Upload failed'); return }
    const j = await r.json()
    onChangeValue({ logoUrl: j.logoUrl, scale: j.scale })
  }
  const remove = async () => {
    setBusy(true)
    await fetch(`/api/ops/padelgenius/courts/${slug}/trajectory`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ style }),
    })
    setBusy(false)
    onChangeValue(null)
  }

  const on = !!value
  const decor = TRAJECTORY_DECOR[style]
  const effective: TrajectoryStyleOverride = override ?? {}
  const setField = <K extends keyof TrajectoryStyleOverride>(key: K, val: TrajectoryStyleOverride[K]) => {
    const next: TrajectoryStyleOverride = { ...effective }
    if (val === undefined) delete next[key]
    else next[key] = val
    onChangeOverride(Object.keys(next).length ? next : null)
  }
  const hasOverride = !!override && Object.values(override).some(v => v !== undefined)

  return (
    <div style={{ background: '#1a1a2e', border: `2px solid ${on ? '#7dd3fc' : hasOverride ? '#a78bfa' : '#2a2a3e'}`, borderRadius: 8, padding: 10 }}>
      <input ref={ref} type="file" accept="image/png,image/svg+xml" hidden onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ color: '#fde047', fontSize: 10, fontWeight: 800, letterSpacing: 0.5 }}>{label}</div>
        <div style={{ background: on ? '#7dd3fc' : hasOverride ? '#a78bfa' : '#475569', color: '#0a0a14', fontSize: 8, fontWeight: 900, padding: '2px 6px', borderRadius: 8 }}>
          {on ? 'ASSET' : hasOverride ? 'TUNED' : 'DEFAULT'}
        </div>
      </div>

      {/* Preview swatch — shows either the asset or the procedural line preview */}
      {on ? (
        <div style={{ width: '100%', height: 48, background: `url("${value!.logoUrl}") center/contain no-repeat #0e0e1a`, border: '1px dashed #2a2a3e', borderRadius: 4, marginBottom: 6 }} />
      ) : (
        <ProceduralLinePreview style={style} override={effective} />
      )}

      <div style={{ color: '#94a3b8', fontSize: 9, marginBottom: 6 }}>{hint}</div>

      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={() => ref.current?.click()} disabled={busy} style={{ flex: 1, background: '#0e0e1a', border: '1px solid #2a2a3e', borderRadius: 4, padding: '4px 0', color: '#aaa', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>{on ? 'REPLACE' : 'UPLOAD'}</button>
        {on && <button onClick={remove} disabled={busy} style={{ flex: 1, background: '#0e0e1a', border: '1px solid #2a2a3e', borderRadius: 4, padding: '4px 0', color: '#ef4444', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>REMOVE</button>}
        {!on && (
          <button
            onClick={() => setEditing(e => !e)}
            style={{ flex: 1, background: editing ? '#a78bfa' : '#0e0e1a', border: '1px solid #2a2a3e', borderRadius: 4, padding: '4px 0', color: editing ? '#0a0a14' : '#a78bfa', fontSize: 9, fontWeight: 800, cursor: 'pointer' }}
          >{editing ? 'CLOSE' : hasOverride ? 'EDIT LINE' : 'TUNE LINE'}</button>
        )}
      </div>

      {/* Inline scale slider when an asset is uploaded */}
      {on && (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888', fontSize: 9, marginBottom: 1 }}><span>scale</span><span style={{ color: '#fff' }}>{value!.scale.toFixed(2)}x</span></div>
          <input type="range" min={0.5} max={2.0} step={0.05} value={value!.scale} onChange={e => onChangeValue({ ...value!, scale: parseFloat(e.target.value) })} style={{ width: '100%', accentColor: '#7dd3fc' }} />
        </div>
      )}

      {/* Inline line-customization panel (only when no asset is uploaded and TUNE LINE is open) */}
      {!on && editing && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #2a2a3e', display: 'grid', gap: 6, fontSize: 10, color: '#94a3b8' }}>
          {/* Color */}
          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
            <span>Color</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input
                type="color"
                value={effective.color ?? '#1e88e5'}
                onChange={e => setField('color', e.target.value)}
                style={{ width: 28, height: 22, background: 'transparent', border: '1px solid #2a2a3e', borderRadius: 3, padding: 0, cursor: 'pointer' }}
              />
              {effective.color && (
                <button onClick={() => setField('color', undefined)} title="Reset to default" style={{ background: 'transparent', border: 'none', color: '#475569', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>RESET</button>
              )}
            </span>
          </label>
          {/* Stroke width */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 1 }}>
              <span>Thickness</span>
              <span style={{ color: effective.strokeWidth !== undefined ? '#a78bfa' : '#94a3b8', fontFamily: 'ui-monospace,monospace' }}>
                {effective.strokeWidth ?? `${decor.strokeWidth} (default)`}
              </span>
            </div>
            <input
              type="range"
              min={1} max={14} step={0.5}
              value={effective.strokeWidth ?? decor.strokeWidth}
              onChange={e => setField('strokeWidth', parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: '#a78bfa' }}
            />
            {effective.strokeWidth !== undefined && (
              <button onClick={() => setField('strokeWidth', undefined)} style={{ background: 'transparent', border: 'none', color: '#475569', fontSize: 9, fontWeight: 700, cursor: 'pointer', padding: 0 }}>reset</button>
            )}
          </div>
          {/* Dashed */}
          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
            <span>Dashed line</span>
            <select
              value={effective.dashed === undefined ? 'default' : effective.dashed ? 'yes' : 'no'}
              onChange={e => {
                const v = e.target.value
                setField('dashed', v === 'default' ? undefined : v === 'yes')
              }}
              style={{ background: '#0e0e1a', border: '1px solid #2a2a3e', color: '#fff', borderRadius: 3, padding: '2px 6px', fontSize: 10 }}
            >
              <option value="default">Style default ({decor.dashed ? 'dashed' : 'solid'})</option>
              <option value="yes">Dashed</option>
              <option value="no">Solid</option>
            </select>
          </label>
          {/* Decorations toggle */}
          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
            <span>Decorations (spin / bolt / star / rays)</span>
            <select
              value={effective.showDecorations === undefined ? 'default' : effective.showDecorations ? 'on' : 'off'}
              onChange={e => {
                const v = e.target.value
                setField('showDecorations', v === 'default' ? undefined : v === 'on')
              }}
              style={{ background: '#0e0e1a', border: '1px solid #2a2a3e', color: '#fff', borderRadius: 3, padding: '2px 6px', fontSize: 10 }}
            >
              <option value="default">Style default</option>
              <option value="on">Show</option>
              <option value="off">Hide</option>
            </select>
          </label>
          {hasOverride && (
            <button
              onClick={() => onChangeOverride(null)}
              style={{ marginTop: 4, background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 4, padding: '3px 6px', fontSize: 9, fontWeight: 800, cursor: 'pointer' }}
            >RESET ALL FOR {label}</button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Small SVG swatch rendering the procedural line + style decorations so the
 * admin can see the effect of their overrides live without leaving the card.
 */
function ProceduralLinePreview({ style, override }: { style: TrajectoryStyle; override: TrajectoryStyleOverride }) {
  const decor = TRAJECTORY_DECOR[style]
  // Build a representative chord across the swatch
  const from: [number, number] = [16, 36]
  const to:   [number, number] = [184, 18]
  const d = trajectoryPath(style, from, to)
  const color = override.color ?? '#1e88e5'
  const strokeWidth = override.strokeWidth ?? decor.strokeWidth
  const dashedFinal = override.dashed ?? decor.dashed
  const showDecorations = override.showDecorations ?? true
  return (
    <div style={{ width: '100%', height: 48, background: '#0e0e1a', border: '1px dashed #2a2a3e', borderRadius: 4, marginBottom: 6, overflow: 'hidden' }}>
      <svg viewBox="0 0 200 48" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        <path d={d} stroke="#1A1A2E" strokeWidth={strokeWidth + 2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d={d} stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dashedFinal ? '6 4' : undefined} />
        {showDecorations && decor.spinMarkers >= 1 && (
          <circle cx={(from[0] + to[0]) / 2} cy={(from[1] + to[1]) / 2} r={3} fill="none" stroke={color} strokeWidth={1} strokeDasharray="2 1" />
        )}
      </svg>
    </div>
  )
}
