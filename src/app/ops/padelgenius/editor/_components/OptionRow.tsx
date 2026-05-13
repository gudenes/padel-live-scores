// src/app/ops/padelgenius/editor/_components/OptionRow.tsx
'use client'
import type { QuestionOption, OptionId, PlayerRole } from '@/lib/padelgenius/types'
import { TrajectoryStylePicker } from './TrajectoryStylePicker'

export interface OptionRowProps {
  option: QuestionOption
  expanded: boolean
  selected: boolean      // whether this option is currently the "focused" one for trajectory drag
  onToggleExpanded: () => void
  onSelect: () => void   // makes this option the focused one
  onChange: (next: QuestionOption) => void
  onSetCorrect: () => void
  onDelete: () => void
}

const PLAYER_ROLES: PlayerRole[] = ['you', 'partner', 'opponent1', 'opponent2']

export function OptionRow({ option, expanded, selected, onToggleExpanded, onSelect, onChange, onSetCorrect, onDelete }: OptionRowProps) {
  const update = <K extends keyof QuestionOption>(key: K, val: QuestionOption[K]) => onChange({ ...option, [key]: val })

  return (
    <div style={{
      background: '#1a1a2e',
      border: `2px solid ${option.isCorrect ? '#22c55e' : selected ? '#1e88e5' : '#2a2a3e'}`,
      borderRadius: 8, marginBottom: 6,
    }}>
      <div onClick={onSelect} style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', cursor: 'pointer' }}>
        <span style={{
          width: 24, height: 24, borderRadius: '50%',
          background: option.isCorrect ? '#22c55e' : '#475569',
          color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 900, marginRight: 8,
        }}>{option.id.toUpperCase()}</span>
        <span style={{ flex: 1, color: '#fff', fontSize: 12, fontWeight: 700 }}>{option.label || '(no label)'}</span>
        <span style={{ color: '#94a3b8', fontSize: 10, marginRight: 8 }}>{option.outcome.trajectory.style}</span>
        <button onClick={(e) => { e.stopPropagation(); onSetCorrect() }}
          style={{ background: 'transparent', border: `1px solid ${option.isCorrect ? '#22c55e' : '#475569'}`, color: option.isCorrect ? '#22c55e' : '#94a3b8', borderRadius: 4, padding: '2px 6px', fontSize: 9, fontWeight: 800, cursor: 'pointer' }}
        >{option.isCorrect ? 'CORRECT' : 'mark correct'}</button>
        <button onClick={(e) => { e.stopPropagation(); onToggleExpanded() }}
          style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', marginLeft: 4, display: 'inline-flex', alignItems: 'center' }}
          aria-label={expanded ? 'Collapse' : 'Expand'}>
          <svg width={10} height={10} viewBox="-5 -5 10 10" aria-hidden="true"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(90deg)', transition: 'transform 150ms ease-out' }}>
            <path d="M -3 -1 L 0 2 L 3 -1" stroke="currentColor" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {expanded && (
        <div style={{ padding: '4px 10px 10px', display: 'grid', gap: 8 }}>
          <Field label="Label">
            <input value={option.label} onChange={e => update('label', e.target.value)}
              style={inputStyle} />
          </Field>
          <Field label="Direction tag (shown in label pill)">
            <input value={option.direction} onChange={e => update('direction', e.target.value)} placeholder="e.g. Cross-court slice"
              style={inputStyle} />
          </Field>
          <Field label="Trajectory style">
            <TrajectoryStylePicker value={option.outcome.trajectory.style}
              onChange={s => onChange({ ...option, outcome: { ...option.outcome, trajectory: { ...option.outcome.trajectory, style: s } } })} />
          </Field>
          <Field label="Letter position (0–100)">
            <CoordRow x={option.letter.x} y={option.letter.y}
              onChange={(x, y) => onChange({ ...option, letter: { x, y } })} />
          </Field>
          <Field label="Trajectory from (0–100)">
            <CoordRow x={option.outcome.trajectory.from[0]} y={option.outcome.trajectory.from[1]}
              onChange={(x, y) => onChange({ ...option, outcome: { ...option.outcome, trajectory: { ...option.outcome.trajectory, from: [x, y] } } })} />
          </Field>
          <Field label="Trajectory to (ball landing, 0–100)">
            <CoordRow x={option.outcome.trajectory.to[0]} y={option.outcome.trajectory.to[1]}
              onChange={(x, y) => onChange({ ...option, outcome: { ...option.outcome, trajectory: { ...option.outcome.trajectory, to: [x, y] }, ball: { x, y } } })} />
          </Field>
          <Field label="Player overrides (rare — e.g. YOU moves up to take the net)">
            <PlayerOverridesEditor overrides={option.outcome.playerOverrides ?? []}
              onChange={ov => onChange({ ...option, outcome: { ...option.outcome, playerOverrides: ov.length ? ov : undefined } })} />
          </Field>
          <button onClick={onDelete} style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 6, padding: '4px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer', justifySelf: 'flex-start' }}>Delete option</button>
        </div>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = { background: '#0e0e1a', border: '1px solid #2a2a3e', borderRadius: 4, padding: '4px 8px', color: '#fff', fontSize: 12, width: '100%' }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ color: '#94a3b8', fontSize: 9, fontWeight: 700, letterSpacing: 0.5, marginBottom: 3 }}>{label.toUpperCase()}</div>
      {children}
    </div>
  )
}

function CoordRow({ x, y, onChange }: { x: number; y: number; onChange: (x: number, y: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input type="number" min={0} max={100} step={1} value={x.toFixed(0)} onChange={e => onChange(parseFloat(e.target.value) || 0, y)} style={{ ...inputStyle, width: 70 }} />
      <input type="number" min={0} max={100} step={1} value={y.toFixed(0)} onChange={e => onChange(x, parseFloat(e.target.value) || 0)} style={{ ...inputStyle, width: 70 }} />
    </div>
  )
}

function PlayerOverridesEditor({ overrides, onChange }: { overrides: { role: PlayerRole; x: number; y: number }[]; onChange: (ov: { role: PlayerRole; x: number; y: number }[]) => void }) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {PLAYER_ROLES.map(role => {
        const ov = overrides.find(o => o.role === role)
        return (
          <div key={role} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#aaa' }}>
            <label style={{ width: 70, fontFamily: 'ui-monospace,monospace' }}>{role}</label>
            <input type="checkbox" checked={!!ov} onChange={e => {
              if (e.target.checked) onChange([...overrides, { role, x: 50, y: 50 }])
              else onChange(overrides.filter(o => o.role !== role))
            }} />
            {ov && (
              <>
                <input type="number" min={0} max={100} step={1} value={ov.x} onChange={e => onChange(overrides.map(o => o.role === role ? { ...o, x: parseFloat(e.target.value) || 0 } : o))} style={{ ...inputStyle, width: 60 }} />
                <input type="number" min={0} max={100} step={1} value={ov.y} onChange={e => onChange(overrides.map(o => o.role === role ? { ...o, y: parseFloat(e.target.value) || 0 } : o))} style={{ ...inputStyle, width: 60 }} />
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
