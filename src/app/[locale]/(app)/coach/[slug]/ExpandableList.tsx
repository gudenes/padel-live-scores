'use client'
import { useState, type ReactNode } from 'react'
import { visibleGroups, type ListGroup } from '@/lib/coach-page-data'

/** Grouped list that collapses by row count; headings never count as rows. */
export function ExpandableList({ groups, initialRows, moreLabel }: {
  groups: ListGroup<ReactNode>[]; initialRows: number; moreLabel: string
}) {
  const [open, setOpen] = useState(false)
  const { groups: shown, hidden } = visibleGroups(groups, open ? Number.MAX_SAFE_INTEGER : initialRows)
  return (
    <>
      {shown.map((g) => (
        <div key={g.key}>
          {g.heading}
          {g.rows}
        </div>
      ))}
      {!open && hidden > 0 && (
        <button type="button" onClick={() => setOpen(true)}
          style={{ display: 'block', width: '100%', marginTop: 4, background: 'none', border: 'none', color: '#6B7280', fontSize: 11, cursor: 'pointer', padding: 6 }}>
          {moreLabel}
        </button>
      )}
    </>
  )
}
