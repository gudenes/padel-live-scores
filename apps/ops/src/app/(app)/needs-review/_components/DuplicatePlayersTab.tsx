'use client'

import DuplicatePlayersPanel from '@/components/DuplicatePlayersPanel'

export default function DuplicatePlayersTab() {
  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 8 }}>
        Duplicate players
      </h2>
      <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>
        Scan the player database for likely duplicates. Rules-based scan is fast and conservative;
        AI scan is slower but catches harder cases. Merges are immediate.
      </p>
      <DuplicatePlayersPanel />
    </div>
  )
}
