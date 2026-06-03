'use client'
import React from 'react'
import { Pill } from '@/components/ui'

export type DataFilter = 'all' | 'missing_equipment' | 'missing_avatar' | 'missing_ranking'
export type CategoryFilter = 'all' | 'men' | 'women'

interface FilterCounts {
  total: number
  missing_equipment: number
  missing_avatar: number
  missing_ranking: number
}

interface FilterChipsProps {
  counts: FilterCounts | null
  activeFilter: DataFilter
  activeCategory: CategoryFilter
  onFilterChange: (filter: DataFilter) => void
  onCategoryChange: (category: CategoryFilter) => void
}

// Transparent button wrapper so <Pill> stays purely visual but the chip is
// clickable + keyboard-focusable. Active chips use the lime tone, inactive use
// neutral.
const chipBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  borderRadius: 'var(--r-full)',
}

export default function FilterChips({
  counts, activeFilter, activeCategory, onFilterChange, onCategoryChange,
}: FilterChipsProps) {
  const dataFilters: { key: DataFilter; label: string; count: number | null }[] = [
    { key: 'all', label: 'All', count: counts?.total ?? null },
    { key: 'missing_equipment', label: 'Missing Equipment', count: counts?.missing_equipment ?? null },
    { key: 'missing_avatar', label: 'Missing Avatar', count: counts?.missing_avatar ?? null },
    { key: 'missing_ranking', label: 'Missing Ranking', count: counts?.missing_ranking ?? null },
  ]

  const categoryFilters: { key: CategoryFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'men', label: 'Men' },
    { key: 'women', label: 'Women' },
  ]

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
      {dataFilters.map(f => (
        <button
          key={f.key}
          type="button"
          onClick={() => onFilterChange(f.key)}
          style={chipBtn}
          aria-pressed={activeFilter === f.key}
        >
          <Pill tone={activeFilter === f.key ? 'lime' : 'neutral'}>
            {f.label}
            {f.count != null && (
              <span style={{ marginLeft: 4, opacity: 0.7, fontSize: 10 }}>({f.count.toLocaleString()})</span>
            )}
          </Pill>
        </button>
      ))}
      <span style={{ width: 1, height: 20, background: 'var(--border-card)', margin: '0 4px' }} />
      {categoryFilters.map(f => (
        <button
          key={f.key}
          type="button"
          onClick={() => onCategoryChange(f.key)}
          style={chipBtn}
          aria-pressed={activeCategory === f.key}
        >
          <Pill tone={activeCategory === f.key ? (f.key === 'men' ? 'men' : f.key === 'women' ? 'women' : 'lime') : 'neutral'}>
            {f.label}
          </Pill>
        </button>
      ))}
    </div>
  )
}
