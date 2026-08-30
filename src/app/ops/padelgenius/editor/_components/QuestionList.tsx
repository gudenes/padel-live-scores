// src/app/ops/padelgenius/editor/_components/QuestionList.tsx
'use client'
import { useState } from 'react'
import type { Question } from '@/lib/padelgenius/types'

export interface QuestionListProps {
  questions: Question[]
  currentId: number | null
  collapsed: boolean
  onToggleCollapsed: () => void
  onSelect: (id: number) => void
  onCreate: () => void
  onDelete: (id: number) => void
}

export function QuestionList({ questions, currentId, collapsed, onToggleCollapsed, onSelect, onCreate, onDelete }: QuestionListProps) {
  const [filter, setFilter] = useState('')
  const filtered = questions.filter(q => !filter || q.prompt.toLowerCase().includes(filter.toLowerCase()) || String(q.id).includes(filter))

  if (collapsed) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: 44, borderRight: '1px solid #2a2a3e', background: '#0e0e1a', flexShrink: 0 }}>
        <button
          onClick={onToggleCollapsed}
          aria-label="Expand question list"
          style={{ background: 'transparent', border: 'none', borderBottom: '1px solid #2a2a3e', padding: '10px 0', cursor: 'pointer', display: 'flex', justifyContent: 'center', color: '#94a3b8' }}
        >
          <svg width={12} height={12} viewBox="-6 -6 12 12" aria-hidden="true">
            <path d="M -3 -3 L 3 0 L -3 3" stroke="currentColor" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          onClick={onCreate}
          aria-label="New question"
          style={{ background: '#22c55e', color: '#0a0a14', border: 'none', borderBottom: '1px solid #15803d', padding: '8px 0', cursor: 'pointer', fontSize: 14, fontWeight: 900 }}
        >+</button>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {questions.map(q => (
            <button
              key={q.id}
              onClick={() => onSelect(q.id)}
              title={`Q${q.id} · ${q.prompt}`}
              style={{
                width: '100%', background: q.id === currentId ? '#1e293b' : 'transparent',
                border: 'none', borderBottom: '1px solid #1a1a2e',
                color: q.id === currentId ? '#fde047' : '#94a3b8',
                padding: '8px 0', fontSize: 10, fontWeight: 800, cursor: 'pointer',
              }}
            >Q{q.id}</button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: 240, borderRight: '1px solid #2a2a3e', background: '#0e0e1a', flexShrink: 0 }}>
      <div style={{ padding: 10, borderBottom: '1px solid #2a2a3e', display: 'flex', gap: 6, alignItems: 'center' }}>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search..." style={{ flex: 1, minWidth: 0, background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 4, padding: '4px 8px', color: '#fff', fontSize: 11 }} />
        <button onClick={onCreate} style={{ background: '#22c55e', color: '#0a0a14', border: '1px solid #15803d', borderRadius: 4, padding: '4px 10px', fontSize: 11, fontWeight: 900, cursor: 'pointer' }}>+ NEW</button>
        <button
          onClick={onToggleCollapsed}
          aria-label="Collapse question list"
          style={{ background: 'transparent', border: '1px solid #2a2a3e', borderRadius: 4, padding: '4px 6px', cursor: 'pointer', color: '#94a3b8', display: 'inline-flex' }}
        >
          <svg width={10} height={10} viewBox="-5 -5 10 10" aria-hidden="true">
            <path d="M 3 -3 L -3 0 L 3 3" stroke="currentColor" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.map(q => (
          <div key={q.id} onClick={() => onSelect(q.id)}
               style={{
                 padding: '8px 10px', borderBottom: '1px solid #1a1a2e', cursor: 'pointer',
                 background: q.id === currentId ? '#1e293b' : 'transparent',
               }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9, color: '#fde047', fontWeight: 800, letterSpacing: 0.5 }}>Q{q.id}</span>
              <span style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase' }}>{q.theme} · {q.difficulty}</span>
              <button onClick={(e) => { e.stopPropagation(); if (confirm(`Delete Q${q.id}?`)) onDelete(q.id) }}
                style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#475569', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', padding: 0 }}
                aria-label="Delete question">
                <svg width={10} height={10} viewBox="-5 -5 10 10" aria-hidden="true">
                  <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" stroke="currentColor" strokeWidth={1.5} fill="none" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 2, lineHeight: 1.3, maxHeight: 30, overflow: 'hidden' }}>{q.prompt}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
