'use client'
// apps/ops/src/app/(app)/players/_components/Combobox.tsx
// Generic typeahead picker with optional inline "+ Create X" affordance.
// Used by AssignRacketModal for brand + racket selection.

import { useState, useRef, useEffect } from 'react'

export interface ComboboxOption {
  id: string
  label: string
  sublabel?: string
}

interface Props {
  options: ComboboxOption[]
  value: string | null
  onChange: (id: string | null) => void
  onCreate?: (typedText: string) => void
  createLabel?: (typedText: string) => string
  placeholder: string
  disabled?: boolean
}

export default function Combobox({
  options,
  value,
  onChange,
  onCreate,
  createLabel,
  placeholder,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.id === value) ?? null

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const q = query.trim().toLowerCase()
  const filtered = q
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          (o.sublabel ?? '').toLowerCase().includes(q),
      )
    : options
  const exactMatch = filtered.some((o) => o.label.toLowerCase() === q)
  const showCreate = !!onCreate && q.length > 0 && !exactMatch

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className="w-full px-3 py-2 text-left text-sm border rounded cursor-pointer disabled:cursor-not-allowed"
        style={{
          background: disabled ? 'var(--bg-card-2)' : 'var(--bg-input)',
          color: disabled ? 'var(--text-3)' : 'var(--text-1)',
          borderColor: 'var(--border)',
        }}
      >
        {selected ? selected.label : <span style={{ color: 'var(--text-3)' }}>{placeholder}</span>}
      </button>
      {open && !disabled && (
        <div
          className="absolute left-0 right-0 mt-1 max-h-60 overflow-auto border rounded shadow-lg z-10"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-card)' }}
        >
          <input
            type="text"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to search…"
            className="w-full px-3 py-2 text-sm border-b outline-none"
            style={{ background: 'transparent', color: 'var(--text-1)', borderColor: 'var(--border-inner)' }}
          />
          {filtered.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                onChange(o.id)
                setOpen(false)
                setQuery('')
              }}
              className="w-full px-3 py-2 text-left text-sm cursor-pointer"
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ color: 'var(--text-1)' }}>{o.label}</div>
              {o.sublabel && <div className="text-xs" style={{ color: 'var(--text-3)' }}>{o.sublabel}</div>}
            </button>
          ))}
          {filtered.length === 0 && !showCreate && (
            <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-3)' }}>No matches</div>
          )}
          {showCreate && (
            <button
              type="button"
              onClick={() => {
                onCreate!(query)
                setOpen(false)
                setQuery('')
              }}
              className="w-full px-3 py-2 text-left text-sm border-t cursor-pointer"
              style={{ color: 'var(--lime-text)', borderColor: 'var(--border-inner)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {createLabel ? createLabel(query) : `+ Create "${query}"`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
