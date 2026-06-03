'use client'
import type { CSSProperties } from 'react'
import type { CellState, DimensionResult, DimensionKey } from './types'

export const DIM_LABELS: Record<DimensionKey, string> = {
  matches: 'Matches',
  players: 'Players',
  oop: 'OOP',
  results: 'Results',
  entry: 'Entry',
  stats: 'Stats',
  streams: 'Streams',
}
export const DIM_ORDER: DimensionKey[] = ['matches', 'players', 'oop', 'results', 'entry', 'stats', 'streams']

function dotStyle(state: CellState): CSSProperties {
  const base: CSSProperties = { width: 13, height: 13, borderRadius: '50%', display: 'inline-block' }
  switch (state) {
    case 'ok':
      return { ...base, background: 'var(--rd-ok)' }
    case 'partial':
      return { ...base, background: 'var(--rd-gap)' }
    case 'missing':
      return { ...base, background: 'transparent', border: '2px solid var(--rd-bad)' }
    case 'divergent':
      return { ...base, background: 'var(--rd-bad)', boxShadow: '0 0 0 3px var(--rd-bad-bg)' }
    case 'na':
      return { ...base, background: 'var(--rd-na)' }
    default:
      return base
  }
}

export function ReadinessDot({ state, title }: { state: CellState; title?: string }) {
  return <span style={dotStyle(state)} title={title} />
}

export function DimensionDots({ dimensions }: { dimensions: DimensionResult[] }) {
  const byKey = new Map(dimensions.map(d => [d.key, d]))
  return (
    <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
      {DIM_ORDER.map(k => {
        const d = byKey.get(k)
        return (
          <ReadinessDot
            key={k}
            state={d?.state ?? 'na'}
            title={`${DIM_LABELS[k]}: ${d?.detail ?? 'N/A'}`}
          />
        )
      })}
    </span>
  )
}

export function DimensionBreakdown({ dimensions }: { dimensions: DimensionResult[] }) {
  const byKey = new Map(dimensions.map(d => [d.key, d]))
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '5px 16px', padding: '12px 16px', fontSize: 12 }}>
      {DIM_ORDER.map(k => {
        const d = byKey.get(k)
        if (!d) return null
        return <FragmentRow key={k} label={DIM_LABELS[k]} state={d.state} detail={d.detail} />
      })}
    </div>
  )
}

function detailColor(state: CellState): string {
  if (state === 'divergent' || state === 'missing') return 'var(--rd-bad)'
  if (state === 'partial') return 'var(--rd-gap)'
  if (state === 'na') return 'var(--text-3)'
  return 'var(--rd-ok)'
}

function FragmentRow({ label, state, detail }: { label: string; state: CellState; detail: string }) {
  return (
    <>
      <div style={{ color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <ReadinessDot state={state} /> {label}
      </div>
      <div style={{ color: detailColor(state) }}>
        {state === 'divergent' ? `⚠ scraped, not populated — ${detail}` : detail}
      </div>
    </>
  )
}
