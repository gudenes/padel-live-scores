'use client'

import DuplicatePlayersPanel from '@/components/DuplicatePlayersPanel'

export default function DuplicatePlayersTab() {
  return (
    <div>
      <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', marginBottom: 8 }}>
        Duplicate players
      </h2>
      <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
        Scan the player database for likely duplicates. Rules-based scan is fast and conservative;
        AI scan is slower but catches harder cases. Merges are immediate.
      </p>
      <DuplicatePlayersPanel />
    </div>
  )
}
