'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'

type TabId = 'mine' | 'season' | 'tournaments'

const GREEN = '#7ED321'
const MUTED = '#6B7280'
const CHUNKY = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

export function PicksTabs({
  myPicks,
  season,
  tournaments,
  initial = 'mine',
}: {
  myPicks: ReactNode
  season: ReactNode
  tournaments: ReactNode
  initial?: TabId
}) {
  const t = useTranslations('prediction.myPicks.tabs')
  const [tab, setTab] = useState<TabId>(initial)
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'mine',        label: t('mine') },
    { id: 'season',      label: t('season') },
    { id: 'tournaments', label: t('tournaments') },
  ]
  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto' }}>
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            style={{
              fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
              background: tab === id ? GREEN : '#1A1A1A',
              color: tab === id ? '#0a0a0a' : MUTED,
              padding: '8px 14px', cursor: 'pointer', border: 0, flexShrink: 0,
              clipPath: CHUNKY,
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div>
        {tab === 'mine' && myPicks}
        {tab === 'season' && season}
        {tab === 'tournaments' && tournaments}
      </div>
    </>
  )
}
