'use client'
// apps/ops/src/components/EntryListSection.tsx

import { useState } from 'react'
import type { CategoryBlock, EntryPlayer, EntryListPayload, EntryTeam } from '@/lib/entry-list-aggregator'
import { EntryListTeamRow } from './EntryListTeamRow'

export function EntryListSection({
  payload,
  onResolveClick,
}: {
  payload: EntryListPayload
  onResolveClick?: (p: EntryPlayer, category: 'men' | 'women') => void
}) {
  const initialCat = payload.categories.find((c) => c.teams.length > 0)?.category ?? 'men'
  const [activeCategory, setActiveCategory] = useState<'men' | 'women'>(initialCat)
  const block = payload.categories.find((c) => c.category === activeCategory)

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {(['men', 'women'] as const).map((cat) => {
          const b = payload.categories.find((c) => c.category === cat)
          const count = b?.stats.teamsTotal ?? 0
          const isActive = activeCategory === cat
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 600,
                border: '1px solid', borderColor: isActive ? '#3b82f6' : 'var(--border-subtle)',
                background: isActive ? '#eff6ff' : 'var(--bg-card)',
                color: isActive ? '#1e40af' : '#555',
                borderRadius: 4, cursor: 'pointer', textTransform: 'capitalize',
              }}
            >
              {cat} <span style={{ opacity: 0.7, fontWeight: 500 }}>({count})</span>
            </button>
          )
        })}
      </div>
      {block && (
        <CategoryTable block={block} onResolveClick={(p) => onResolveClick?.(p, block.category)} />
      )}
    </div>
  )
}

function CategoryTable({ block, onResolveClick }: { block: CategoryBlock; onResolveClick?: (p: EntryPlayer) => void }) {
  if (block.teams.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--status-neutral)' }}>No {block.category} entries in this snapshot.</div>
  }
  const mainDraw = block.teams.filter((t) => t.drawType === 'main_draw')
  const qualifying = block.teams.filter((t) => t.drawType === 'qualifying')
  const s = block.stats
  const resolvedPct = s.playersTotal > 0 ? Math.round((s.playersResolved / s.playersTotal) * 100) : 0
  const fipIdPct = s.playersTotal > 0 ? Math.round((s.playersWithFipId / s.playersTotal) * 100) : 0

  return (
    <div>
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', marginBottom: 12, padding: 12, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
        <StatTile label="Teams" value={`${s.teamsTotal}`} />
        {qualifying.length > 0 && <StatTile label="MD / Q" value={`${mainDraw.length} / ${qualifying.length}`} />}
        <StatTile label="Fully Resolved" value={`${s.teamsFullyResolved} / ${s.teamsTotal}`} color={s.teamsFullyResolved === s.teamsTotal ? '#166534' : '#92400e'} />
        <StatTile label="Players" value={`${s.playersTotal}`} />
        <StatTile label="Resolved" value={`${s.playersResolved} (${resolvedPct}%)`} color={resolvedPct === 100 ? '#166534' : resolvedPct > 80 ? '#1e40af' : '#92400e'} />
        <StatTile label="Have FIP ID" value={`${s.playersWithFipId} (${fipIdPct}%)`} color={fipIdPct === 100 ? '#166534' : '#92400e'} />
        <StatTile label="Missing From DB" value={`${s.playersMissingFromDb}`} color={s.playersMissingFromDb === 0 ? 'var(--status-neutral)' : '#991b1b'} />
      </div>
      {mainDraw.length > 0 && <DrawSection label="Main Draw" teams={mainDraw} onResolveClick={onResolveClick} />}
      {qualifying.length > 0 && <DrawSection label="Qualifying" teams={qualifying} onResolveClick={onResolveClick} />}
    </div>
  )
}

function DrawSection({ label, teams, onResolveClick }: { label: string; teams: EntryTeam[]; onResolveClick?: (p: EntryPlayer) => void }) {
  const isMain = label === 'Main Draw'
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        display: 'inline-block', marginBottom: 6, padding: '3px 10px',
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
        background: isMain ? '#d1fae5' : '#fef3c7',
        color: isMain ? '#065f46' : '#92400e',
        borderRadius: 4,
      }}>
        {label} · {teams.length} {teams.length === 1 ? 'team' : 'teams'}
      </div>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'auto' }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border-subtle)', background: '#f9fafb' }}>
              <th style={thStyle}>Seed</th>
              <th style={thStyle}>Player 1</th>
              <th style={thStyle}>Player 2</th>
              <th style={thStyle}>Country</th>
              <th style={thStyle}>FIP IDs</th>
              <th style={thStyle}>Resolution</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t, i) => (
              <EntryListTeamRow key={i} team={t} index={i} onResolveClick={onResolveClick} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatTile({ label, value, color = '#111' }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--status-neutral)', fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '6px 10px', textAlign: 'left', color: 'var(--status-neutral)',
  fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em',
}
