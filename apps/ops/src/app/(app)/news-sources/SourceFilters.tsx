'use client'

export interface Filters {
  type: 'all' | 'rss' | 'wp-api' | 'google-news-search'
  lang: 'all' | 'en' | 'es' | 'pt' | 'it' | 'fr'
  health: 'all' | 'healthy' | 'errors' | 'auto-disabled'
  kind: 'all' | 'static' | 'player' | 'tournament' | 'brand' | 'user-suggested' | 'ai-discovered'
}

interface ChipGroup<K extends keyof Filters> {
  field: K
  label: string
  options: { value: Filters[K]; label: string }[]
}

const GROUPS: ChipGroup<keyof Filters>[] = [
  { field: 'type', label: 'Type', options: [
    { value: 'all', label: 'All' }, { value: 'rss', label: 'RSS' },
    { value: 'wp-api', label: 'WP-API' }, { value: 'google-news-search', label: 'Google News' },
  ]},
  { field: 'lang', label: 'Lang', options: [
    { value: 'all', label: 'All' }, { value: 'en', label: 'EN' }, { value: 'es', label: 'ES' },
    { value: 'pt', label: 'PT' }, { value: 'it', label: 'IT' }, { value: 'fr', label: 'FR' },
  ]},
  { field: 'health', label: 'Health', options: [
    { value: 'all', label: 'All' }, { value: 'healthy', label: 'Healthy ≥80' },
    { value: 'errors', label: 'Errors <80' }, { value: 'auto-disabled', label: 'Auto-disabled' },
  ]},
  { field: 'kind', label: 'Source', options: [
    { value: 'all', label: 'All' }, { value: 'static', label: 'Static' },
    { value: 'player', label: 'Player' }, { value: 'tournament', label: 'Tournament' },
    { value: 'brand', label: 'Brand' }, { value: 'user-suggested', label: 'User' },
    { value: 'ai-discovered', label: 'AI' },
  ]},
]

export function SourceFilters({ value, onChange, total, matched }: { value: Filters; onChange: (f: Filters) => void; total: number; matched: number }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '12px 8px', borderBottom: '1px solid #2a2a2a', alignItems: 'center' }}>
      {GROUPS.map(g => (
        <div key={g.field} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#888', fontWeight: 700, textTransform: 'uppercase' }}>{g.label}</span>
          {g.options.map(opt => {
            const active = value[g.field] === opt.value
            return (
              <button
                key={String(opt.value)}
                onClick={() => onChange({ ...value, [g.field]: opt.value })}
                style={{
                  background: active ? '#7ED321' : '#1a1a1a',
                  color: active ? '#0a0a0a' : '#ccc',
                  border: 0, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  clipPath: 'polygon(4% 0%, 100% 0%, 96% 100%, 0% 100%)',
                }}
              >{opt.label}</button>
            )
          })}
        </div>
      ))}
      <div style={{ marginLeft: 'auto', fontSize: 11, color: '#888' }}>
        {matched} / {total}
      </div>
    </div>
  )
}
