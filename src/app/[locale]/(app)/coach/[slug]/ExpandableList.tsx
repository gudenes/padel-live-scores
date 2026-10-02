'use client'
import { useState, type ReactNode } from 'react'

export function ExpandableList({ items, initial, moreLabel }: { items: ReactNode[]; initial: number; moreLabel: string }) {
  const [open, setOpen] = useState(false)
  const shown = open ? items : items.slice(0, initial)
  return (
    <>
      {shown}
      {!open && items.length > initial && (
        <button type="button" onClick={() => setOpen(true)}
          style={{ display: 'block', width: '100%', marginTop: 4, background: 'none', border: 'none', color: '#6B7280', fontSize: 11, cursor: 'pointer', padding: 6 }}>
          {moreLabel}
        </button>
      )}
    </>
  )
}
