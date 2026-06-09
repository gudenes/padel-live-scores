'use client'
import { useState } from 'react'
import YtChannelsTab from './YtChannelsTab'
import AvailabilityTab from './AvailabilityTab'

export default function YtChannelsShell() {
  const [tab, setTab] = useState<'channels' | 'availability'>('channels')
  return (
    <div>
      <div style={{ display: 'flex', gap: 22, padding: '14px 32px 0', borderBottom: '1px solid var(--border)' }}>
        {([['channels', 'Channels'], ['availability', 'Availability by Country']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '9px 2px', fontSize: 14, fontWeight: 600,
            fontFamily: 'var(--font)',
            color: tab === key ? 'var(--lime-text)' : 'var(--text-3)',
            borderBottom: tab === key ? '2px solid var(--lime)' : '2px solid transparent',
          }}>{label}</button>
        ))}
      </div>
      {tab === 'channels' ? <YtChannelsTab /> : <AvailabilityTab />}
    </div>
  )
}
