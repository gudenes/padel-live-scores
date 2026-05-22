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
        className="w-full px-3 py-2 text-left text-sm border border-gray-200 rounded bg-white text-gray-900 cursor-pointer disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
      >
        {selected ? selected.label : <span className="text-gray-400">{placeholder}</span>}
      </button>
      {open && !disabled && (
        <div className="absolute left-0 right-0 mt-1 max-h-60 overflow-auto bg-white border border-gray-200 rounded shadow-lg z-10">
          <input
            type="text"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to search…"
            className="w-full px-3 py-2 text-sm border-b border-gray-100 outline-none"
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
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 cursor-pointer"
            >
              <div className="text-gray-900">{o.label}</div>
              {o.sublabel && <div className="text-xs text-gray-500">{o.sublabel}</div>}
            </button>
          ))}
          {filtered.length === 0 && !showCreate && (
            <div className="px-3 py-2 text-xs text-gray-400">No matches</div>
          )}
          {showCreate && (
            <button
              type="button"
              onClick={() => {
                onCreate!(query)
                setOpen(false)
                setQuery('')
              }}
              className="w-full px-3 py-2 text-left text-sm text-blue-600 border-t border-gray-100 hover:bg-blue-50 cursor-pointer"
            >
              {createLabel ? createLabel(query) : `+ Create "${query}"`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
