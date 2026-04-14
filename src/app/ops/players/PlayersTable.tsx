'use client'
import React from 'react'
import { PlayerSummary, computeCompleteness } from './types'

interface PlayersTableProps {
  players: PlayerSummary[]
  selectedIds: Set<string>
  activePlayerId: string | null
  page: number
  totalPages: number
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  onRowClick: (id: string) => void
  onPageChange: (page: number) => void
  loading: boolean
}

const COMPLETENESS_LABELS = ['Avatar', 'Ranking', 'FIP ID', 'Equipment']

function CompletenessDotsCell({ player }: { player: PlayerSummary }) {
  const flags = computeCompleteness(player)
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      {flags.map((ok, i) => (
        <span
          key={i}
          title={COMPLETENESS_LABELS[i]}
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: ok ? '#22c55e' : '#ef4444',
            flexShrink: 0,
            cursor: 'default',
          }}
        />
      ))}
    </div>
  )
}

function AvatarCell({ player }: { player: PlayerSummary }) {
  const initials = (player.display_name || player.name)
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

  return (
    <div style={{ position: 'relative', width: 28, height: 28, flexShrink: 0 }}>
      {player.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={player.avatar_url}
          alt={player.name}
          style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }}
        />
      ) : (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: '#e5e7eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 600,
            color: '#6B7280',
          }}
        >
          {initials}
        </div>
      )}
      {player.country && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://flagcdn.com/w20/${player.country.toLowerCase()}.png`}
          alt={player.country}
          width={14}
          height={10}
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            borderRadius: 2,
            objectFit: 'cover',
            border: '1px solid rgba(255,255,255,0.6)',
          }}
        />
      )}
    </div>
  )
}

function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return <span style={{ color: '#9ca3af' }}>—</span>
  const isMen = category === 'men'
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 6px',
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 600,
        background: isMen ? '#DBEAFE' : '#FCE7F3',
        color: isMen ? '#1E40AF' : '#9D174D',
      }}
    >
      {isMen ? 'M' : 'W'}
    </span>
  )
}

function EquipmentCell({ equipment }: { equipment: PlayerSummary['equipment'] }) {
  if (!equipment) {
    return <span style={{ color: '#9ca3af' }}>—</span>
  }
  return (
    <span style={{ fontSize: 12 }}>
      <span style={{ fontWeight: 600, color: '#111' }}>{equipment.brand}</span>
      {' '}
      <span style={{ color: '#6B7280' }}>{equipment.model}</span>
      {equipment.year != null && (
        <span style={{ color: '#9ca3af', marginLeft: 4 }}>{equipment.year}</span>
      )}
    </span>
  )
}

const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: '#6B7280',
  borderBottom: '1px solid #e5e7eb',
  whiteSpace: 'nowrap',
  background: '#fafafa',
}

export default function PlayersTable({
  players,
  selectedIds,
  activePlayerId,
  page,
  totalPages,
  onToggleSelect,
  onToggleSelectAll,
  onRowClick,
  onPageChange,
  loading,
}: PlayersTableProps) {
  const allSelected = players.length > 0 && players.every((p) => selectedIds.has(p.id))
  const someSelected = players.some((p) => selectedIds.has(p.id)) && !allSelected

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Table */}
      <div
        style={{
          overflowX: 'auto',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          opacity: loading ? 0.6 : 1,
          transition: 'opacity 0.15s',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 32 }} />
            <col style={{ width: 48 }} />
            <col /> {/* flex / name */}
            <col style={{ width: 60 }} />
            <col style={{ width: 50 }} />
            <col style={{ width: 160 }} />
            <col style={{ width: 80 }} />
          </colgroup>
          <thead>
            <tr>
              {/* Checkbox */}
              <th style={{ ...thStyle, padding: '8px 8px 8px 12px' }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected
                  }}
                  onChange={onToggleSelectAll}
                  style={{ cursor: 'pointer', accentColor: '#111' }}
                />
              </th>
              {/* Avatar (no header text) */}
              <th style={thStyle} />
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Rank</th>
              <th style={thStyle}>Cat</th>
              <th style={thStyle}>Equipment</th>
              <th style={thStyle}>Data</th>
            </tr>
          </thead>
          <tbody>
            {players.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    textAlign: 'center',
                    padding: '40px 16px',
                    color: '#9ca3af',
                    fontSize: 13,
                  }}
                >
                  No players found
                </td>
              </tr>
            ) : (
              players.map((player) => {
                const isActive = player.id === activePlayerId
                const isSelected = selectedIds.has(player.id)
                const rowBg = isActive
                  ? '#F0F7FF'
                  : isSelected
                    ? '#f9fafb'
                    : '#fff'

                return (
                  <tr
                    key={player.id}
                    onClick={() => onRowClick(player.id)}
                    style={{
                      background: rowBg,
                      cursor: 'pointer',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive && !isSelected) {
                        ;(e.currentTarget as HTMLTableRowElement).style.background = '#f9fafb'
                      }
                    }}
                    onMouseLeave={(e) => {
                      ;(e.currentTarget as HTMLTableRowElement).style.background = rowBg
                    }}
                  >
                    {/* Checkbox */}
                    <td
                      style={{ padding: '8px 8px 8px 12px', verticalAlign: 'middle' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect(player.id)}
                        style={{ cursor: 'pointer', accentColor: '#111' }}
                      />
                    </td>

                    {/* Avatar + Flag */}
                    <td style={{ padding: '6px 8px', verticalAlign: 'middle' }}>
                      <AvatarCell player={player} />
                    </td>

                    {/* Name */}
                    <td
                      style={{
                        padding: '8px 10px',
                        verticalAlign: 'middle',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 500, color: '#111' }}>
                        {player.display_name || player.name}
                      </span>
                    </td>

                    {/* Rank */}
                    <td style={{ padding: '8px 10px', verticalAlign: 'middle' }}>
                      {player.ranking != null ? (
                        <span style={{ fontSize: 12, color: '#111', fontVariantNumeric: 'tabular-nums' }}>
                          #{player.ranking}
                        </span>
                      ) : (
                        <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>
                      )}
                    </td>

                    {/* Category */}
                    <td style={{ padding: '8px 10px', verticalAlign: 'middle' }}>
                      <CategoryBadge category={player.category} />
                    </td>

                    {/* Equipment */}
                    <td
                      style={{
                        padding: '8px 10px',
                        verticalAlign: 'middle',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <EquipmentCell equipment={player.equipment} />
                    </td>

                    {/* Data (completeness dots) */}
                    <td style={{ padding: '8px 10px', verticalAlign: 'middle' }}>
                      <CompletenessDotsCell player={player} />
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            marginTop: 12,
            fontSize: 13,
            color: '#6B7280',
          }}
        >
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            style={{
              padding: '5px 12px',
              borderRadius: 6,
              border: '1px solid #e5e7eb',
              background: page <= 1 ? '#f9fafb' : '#fff',
              color: page <= 1 ? '#9ca3af' : '#111',
              cursor: page <= 1 ? 'not-allowed' : 'pointer',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            ← Previous
          </button>
          <span style={{ fontSize: 13, color: '#6B7280' }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            style={{
              padding: '5px 12px',
              borderRadius: 6,
              border: '1px solid #e5e7eb',
              background: page >= totalPages ? '#f9fafb' : '#fff',
              color: page >= totalPages ? '#9ca3af' : '#111',
              cursor: page >= totalPages ? 'not-allowed' : 'pointer',
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
