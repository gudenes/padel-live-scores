'use client'

import { useTranslations } from 'next-intl'

// Same map as in ChannelGroup.tsx. The 36-entry list is small enough
// to keep duplicated rather than build a shared module yet; if this
// grows, extract to src/lib/where-to-watch/iso2-names.ts.
const COUNTRIES: Array<{ iso2: string; name: string }> = [
  { iso2: 'es', name: 'Spain' },        { iso2: 'it', name: 'Italy' },
  { iso2: 'fr', name: 'France' },       { iso2: 'de', name: 'Germany' },
  { iso2: 'gb', name: 'United Kingdom' }, { iso2: 'us', name: 'United States' },
  { iso2: 'ar', name: 'Argentina' },    { iso2: 'mx', name: 'Mexico' },
  { iso2: 'br', name: 'Brazil' },       { iso2: 'pt', name: 'Portugal' },
  { iso2: 'nl', name: 'Netherlands' },  { iso2: 'be', name: 'Belgium' },
  { iso2: 'se', name: 'Sweden' },       { iso2: 'no', name: 'Norway' },
  { iso2: 'dk', name: 'Denmark' },      { iso2: 'fi', name: 'Finland' },
  { iso2: 'pl', name: 'Poland' },       { iso2: 'ch', name: 'Switzerland' },
  { iso2: 'at', name: 'Austria' },      { iso2: 'ie', name: 'Ireland' },
  { iso2: 'gr', name: 'Greece' },       { iso2: 'tr', name: 'Turkey' },
  { iso2: 'il', name: 'Israel' },       { iso2: 'sa', name: 'Saudi Arabia' },
  { iso2: 'ae', name: 'UAE' },          { iso2: 'qa', name: 'Qatar' },
  { iso2: 'eg', name: 'Egypt' },        { iso2: 'ma', name: 'Morocco' },
  { iso2: 'za', name: 'South Africa' }, { iso2: 'jp', name: 'Japan' },
  { iso2: 'kr', name: 'South Korea' },  { iso2: 'cn', name: 'China' },
  { iso2: 'in', name: 'India' },        { iso2: 'au', name: 'Australia' },
]

export interface RegionPickerProps {
  currentCountry: string | null
  onPick: (iso2: string) => void
  onBack: () => void
}

export function RegionPicker({ currentCountry, onPick, onBack }: RegionPickerProps) {
  const t = useTranslations('whereToWatch')
  return (
    <div data-wtw-anim style={{ animation: 'wtw-fade-in 220ms ease-out both' }}>
      {/* Header with back arrow */}
      <button
        type="button"
        onClick={onBack}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 11, fontWeight: 800, letterSpacing: 1.5,
          color: '#F5A623', textTransform: 'uppercase',
          background: 'transparent', border: 0, padding: 0, marginBottom: 14,
          cursor: 'pointer',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
        {t('pickRegionBack')}
      </button>

      <div style={{
        fontSize: 13, fontWeight: 800, color: '#fff',
        marginBottom: 12, lineHeight: 1.2,
      }}>
        {t('pickRegionTitle')}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {COUNTRIES.map(c => {
          const selected = currentCountry === c.iso2
          return (
            <button
              key={c.iso2}
              type="button"
              onClick={() => onPick(c.iso2)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 12px',
                background: selected ? 'rgba(245,166,35,0.10)' : '#0F0F0F',
                border: 0, cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 12, fontWeight: 600,
                color: selected ? '#F5A623' : '#fff',
                clipPath: 'polygon(0% 4%, 99% 0%, 100% 96%, 1% 100%)',
                textAlign: 'left',
              }}
            >
              <span>{c.name}</span>
              {selected && <span style={{ fontSize: 14 }}>&#x2713;</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
