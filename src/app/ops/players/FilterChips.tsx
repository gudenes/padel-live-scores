'use client'
import React from 'react'

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

export default function FilterChips({
  counts, activeFilter, activeCategory, onFilterChange, onCategoryChange,
}: FilterChipsProps) {
  const chipBase: React.CSSProperties = {
    fontSize: 11, fontWeight: 500, padding: '4px 10px', borderRadius: 6,
    border: '1px solid #e5e7eb', cursor: 'pointer', background: '#fff', color: '#111',
    transition: 'all 0.15s',
  }
  const chipActive: React.CSSProperties = {
    ...chipBase, background: '#111', color: '#fff', borderColor: '#111',
  }

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
          onClick={() => onFilterChange(f.key)}
          style={activeFilter === f.key ? chipActive : chipBase}
        >
          {f.label}
          {f.count != null && (
            <span style={{ marginLeft: 4, opacity: 0.7, fontSize: 10 }}>({f.count.toLocaleString()})</span>
          )}
        </button>
      ))}
      <span style={{ width: 1, height: 20, background: '#e5e7eb', margin: '0 4px' }} />
      {categoryFilters.map(f => (
        <button
          key={f.key}
          onClick={() => onCategoryChange(f.key)}
          style={activeCategory === f.key ? chipActive : chipBase}
        >
          {f.label}
        </button>
      ))}
    </div>
  )
}
