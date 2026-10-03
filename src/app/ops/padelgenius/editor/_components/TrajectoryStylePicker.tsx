// src/app/ops/padelgenius/editor/_components/TrajectoryStylePicker.tsx
'use client'
import type { TrajectoryStyle } from '@/lib/padelgenius/types'

const STYLES: { value: TrajectoryStyle; label: string }[] = [
  { value: 'flat',         label: 'Flat' },
  { value: 'lob',          label: 'Lob' },
  { value: 'bandeja',      label: 'Bandeja' },
  { value: 'vibora',       label: 'Vibora' },
  { value: 'smash',        label: 'Smash' },
  { value: 'chiquita',     label: 'Chiquita' },
  { value: 'wall-bounce',  label: 'Wall bounce' },
  { value: 'cross',        label: 'Cross' },
]

export function TrajectoryStylePicker({ value, onChange }: { value: TrajectoryStyle; onChange: (v: TrajectoryStyle) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {STYLES.map(s => (
        <button key={s.value} onClick={() => onChange(s.value)} style={{
          background: value === s.value ? '#fde047' : '#1a1a2e',
          color: value === s.value ? '#0a0a14' : '#aaa',
          border: `1px solid ${value === s.value ? '#ca8a04' : '#2a2a3e'}`,
          borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
        }}>{s.label}</button>
      ))}
    </div>
  )
}
