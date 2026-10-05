// src/app/[locale]/(app)/padelgenius/components/RevealSheet.tsx
'use client'
import { useState } from 'react'
import type { Question, OptionId } from '@/lib/padelgenius/types'

export interface RevealSheetProps {
  question: Question
  correct: boolean
  picked: OptionId | null
  onContinue: () => void
}

export function RevealSheet({ question, correct, picked: _picked, onContinue }: RevealSheetProps) {
  const [expanded, setExpanded] = useState(false)
  const correctOpt = question.options.find(o => o.isCorrect)
  const accent = correct ? '#22c55e' : '#ef4444'
  const accentDark = correct ? '#15803d' : '#991b1b'

  return (
    <div
      role="status"
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        background: accent, borderTop: `3px solid ${accentDark}`,
        zIndex: 6,
        animation: 'pg-sheet-slide-up 200ms ease-out forwards',
      }}
    >
      {expanded && (
        <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid rgba(0,0,0,0.18)' }}>
          <div style={{ fontSize: 12, color: '#fff', lineHeight: 1.4, fontWeight: 600 }}>
            <strong>{question.explanation.title}</strong> · {question.explanation.body}
          </div>
          {question.explanation.proTip && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.2)', fontSize: 11, color: 'rgba(255,255,255,0.95)', lineHeight: 1.4 }}>
              <strong>Pro tip · </strong>{question.explanation.proTip}
            </div>
          )}
        </div>
      )}
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Status badge — SVG check/cross, no emoji */}
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width={12} height={12} viewBox="-6 -6 12 12" aria-hidden="true">
            {correct ? (
              <path d="M -4 0 L -1 3 L 4 -3" stroke={accent} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" stroke={accent} strokeWidth={2.2} fill="none" strokeLinecap="round" />
            )}
          </svg>
        </div>
        <div style={{ color: correct ? '#0a0a14' : '#fff', fontSize: 11, fontWeight: 900, letterSpacing: 0.3, flex: 1 }}>
          {correct ? `CORRECT · +100 XP · ${correctOpt?.label}` : `NOT QUITE · Answer was ${correctOpt?.id.toUpperCase()} · ${correctOpt?.label}`}
        </div>
        {/* Why?/Hide toggle — SVG chevron, no unicode triangle */}
        <button
          onClick={() => setExpanded(v => !v)}
          style={{ background: 'rgba(10,10,20,0.18)', color: correct ? '#0a0a14' : '#fff', border: '1.5px solid rgba(10,10,20,0.35)', borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          {expanded ? 'Hide' : 'Why?'}
          <svg width={8} height={8} viewBox="-4 -4 8 8" aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease-out' }}>
            <path d="M -3 -1 L 0 2 L 3 -1" stroke={correct ? '#0a0a14' : '#fff'} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {/* Continue button — SVG arrow, no unicode right-arrow */}
        <button
          onClick={onContinue}
          style={{ background: '#0a0a14', color: accent, borderRadius: 8, padding: '6px 12px', fontWeight: 900, fontSize: 11, letterSpacing: 0.5, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          CONTINUE
          <svg width={10} height={10} viewBox="-5 -5 10 10" aria-hidden="true">
            <path d="M -3 0 L 3 0 M 0 -3 L 3 0 L 0 3" stroke={accent} strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
