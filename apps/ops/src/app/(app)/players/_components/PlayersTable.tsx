'use client'
import React from 'react'
import Link from 'next/link'
import { DataTable, Pill, Button } from '@/components/ui'
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
            borderRadius: 'var(--r-full)',
            background: ok ? 'var(--lime)' : 'var(--live)',
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
          style={{ width: 28, height: 28, borderRadius: 'var(--r-full)', objectFit: 'cover' }}
        />
      ) : (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 'var(--r-full)',
            background: 'var(--bg-hover)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--text-3)',
          }}
        >
          {initials}
        </div>
      )}
      {player.country && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/flags/${player.country.toLowerCase()}.png`}
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
  if (!category) return <span style={{ color: 'var(--text-3)' }}>—</span>
  const isMen = category === 'men'
  return <Pill tone={isMen ? 'men' : 'women'}>{isMen ? 'M' : 'W'}</Pill>
}

function EquipmentCell({ equipment }: { equipment: PlayerSummary['equipment'] }) {
  if (!equipment) {
    return <span style={{ color: 'var(--text-3)' }}>—</span>
  }
  return (
    <span style={{ fontSize: 12 }}>
      <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{equipment.brand}</span>
      {' '}
      <span style={{ color: 'var(--text-2)' }}>{equipment.model}</span>
      {equipment.year != null && (
        <span style={{ color: 'var(--text-3)', marginLeft: 4 }}>{equipment.year}</span>
      )}
    </span>
  )
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
      <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s' }}>
        <DataTable>
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
              <th>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected
                  }}
                  onChange={onToggleSelectAll}
                  style={{ cursor: 'pointer', accentColor: 'var(--lime)' }}
                />
              </th>
              {/* Avatar (no header text) */}
              <th />
              <th>Name</th>
              <th>Rank</th>
              <th>Cat</th>
              <th>Equipment</th>
              <th>Data</th>
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
                    color: 'var(--text-3)',
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
                  ? 'var(--bg-sel)'
                  : isSelected
                    ? 'var(--bg-hover)'
                    : undefined

                return (
                  <tr
                    key={player.id}
                    onClick={() => onRowClick(player.id)}
                    style={{
                      background: rowBg,
                      cursor: 'pointer',
                    }}
                  >
                    {/* Checkbox */}
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect(player.id)}
                        style={{ cursor: 'pointer', accentColor: 'var(--lime)' }}
                      />
                    </td>

                    {/* Avatar + Flag */}
                    <td>
                      <AvatarCell player={player} />
                    </td>

                    {/* Name */}
                    <td
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)' }}>
                          {player.display_name || player.name}
                        </span>
                        <Link
                          href={`/players/${player.id}`}
                          title="Open full profile"
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontSize: 12,
                            color: 'var(--text-3)',
                            textDecoration: 'none',
                            cursor: 'pointer',
                            lineHeight: 1,
                            padding: '0 2px',
                          }}
                        >
                          ↗
                        </Link>
                      </span>
                    </td>

                    {/* Rank */}
                    <td>
                      {player.ranking != null ? (
                        <span style={{ fontSize: 12, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>
                          #{player.ranking}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-3)', fontSize: 12 }}>—</span>
                      )}
                    </td>

                    {/* Category */}
                    <td>
                      <CategoryBadge category={player.category} />
                    </td>

                    {/* Equipment */}
                    <td
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <EquipmentCell equipment={player.equipment} />
                    </td>

                    {/* Data (completeness dots) */}
                    <td>
                      <CompletenessDotsCell player={player} />
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </DataTable>
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
            color: 'var(--text-2)',
          }}
        >
          <Button size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
            ← Previous
          </Button>
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
            Page {page} of {totalPages}
          </span>
          <Button size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
            Next →
          </Button>
        </div>
      )}
    </div>
  )
}
