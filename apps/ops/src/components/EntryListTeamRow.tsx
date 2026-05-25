'use client'
// apps/ops/src/components/EntryListTeamRow.tsx

import type { EntryPlayer, EntryTeam, ResolutionMethod } from '@/lib/entry-list-aggregator'

function resolutionBadge(method: ResolutionMethod) {
  switch (method) {
    case 'fip_id':
      return { label: 'FIP', bg: '#dcfce7', color: '#166534' }
    case 'name_exact':
      return { label: 'NAME', bg: '#dbeafe', color: '#1e40af' }
    case 'none':
      return { label: 'MISSING', bg: '#fee2e2', color: '#991b1b' }
  }
}

function PlayerCell({ p, onResolveClick }: { p: EntryPlayer; onResolveClick?: (p: EntryPlayer) => void }) {
  if (p.isGhostPartner) {
    return (
      <div>
        <div style={{ fontWeight: 500, color: '#991b1b', display: 'flex', alignItems: 'center', gap: 6 }}>
          {p.name}
          <button
            type="button"
            onClick={() => onResolveClick?.(p)}
            title="Click to link to existing player or create new"
            style={{
              fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
              background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca',
              cursor: 'pointer', letterSpacing: '0.03em',
            }}
          >
            RESOLVE
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--status-neutral)' }}>not in DB / FIP search</div>
      </div>
    )
  }
  return (
    <div>
      <div style={{ fontWeight: 500, color: '#111' }}>{p.name}</div>
      {p.resolvedPlayerId && p.resolvedPlayerName && p.resolvedPlayerName !== p.name && (
        <div style={{ fontSize: 10, color: 'var(--status-neutral)' }}>→ {p.resolvedPlayerName}</div>
      )}
    </div>
  )
}

function ResolutionChip({ p }: { p: EntryPlayer }) {
  const badge = resolutionBadge(p.resolutionMethod)
  return (
    <span
      title={
        p.resolutionMethod === 'fip_id'
          ? `Resolved via FIP id (${p.fipId})`
          : p.resolutionMethod === 'name_exact'
            ? `Resolved via normalized name match (${p.name})`
            : 'Not resolved — not in public.players, or ambiguous match'
      }
      style={{
        fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
        background: badge.bg, color: badge.color, letterSpacing: '0.03em',
      }}
    >
      {badge.label}
    </span>
  )
}

export function EntryListTeamRow({
  team,
  index,
  onResolveClick,
}: {
  team: EntryTeam
  index: number
  onResolveClick?: (p: EntryPlayer) => void
}) {
  return (
    <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: index % 2 === 0 ? 'var(--bg-card)' : '#f9fafb' }}>
      <td style={tdStyle}>
        <span style={{ fontFamily: 'monospace', fontWeight: 600, color: team.seed ? '#111' : 'var(--status-neutral)' }}>
          {team.seed ?? '—'}
        </span>
      </td>
      <td style={tdStyle}><PlayerCell p={team.player1} /></td>
      <td style={tdStyle}>
        {team.player2 ? <PlayerCell p={team.player2} onResolveClick={onResolveClick} /> : <span style={{ color: '#ccc' }}>—</span>}
      </td>
      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, color: '#555' }}>
        {team.player1.country ?? '—'}
        {team.player2 ? ` / ${team.player2.country ?? '—'}` : ''}
      </td>
      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 10, color: '#777' }}>
        {team.player1.fipId ? team.player1.fipId.replace(/^fip-/, '') : '—'}
        {team.player2 ? ` / ${team.player2.fipId ? team.player2.fipId.replace(/^fip-/, '') : '—'}` : ''}
      </td>
      <td style={tdStyle}>
        <div style={{ display: 'flex', gap: 4 }}>
          <ResolutionChip p={team.player1} />
          {team.player2 && <ResolutionChip p={team.player2} />}
        </div>
      </td>
    </tr>
  )
}

const tdStyle: React.CSSProperties = { padding: '6px 10px', color: '#333', verticalAlign: 'top' }
