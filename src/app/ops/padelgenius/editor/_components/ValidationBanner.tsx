// src/app/ops/padelgenius/editor/_components/ValidationBanner.tsx
'use client'
import type { ValidationResult } from '@/lib/padelgenius/question-validation'

export function ValidationBanner({ validation }: { validation: ValidationResult }) {
  if (validation.ok && validation.warnings.length === 0) {
    return (
      <div style={{ padding: '6px 10px', background: 'rgba(34,197,94,0.10)', color: '#86efac', fontSize: 11, fontWeight: 700, borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <svg width={10} height={10} viewBox="-5 -5 10 10" aria-hidden="true">
          <path d="M -3 0 L -1 2 L 3 -2" stroke="currentColor" strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Valid
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {validation.errors.map((e, i) => (
        <div key={`e${i}`} style={{ padding: '6px 10px', background: 'rgba(239,68,68,0.12)', color: '#fca5a5', fontSize: 11, fontWeight: 600, borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width={10} height={10} viewBox="-5 -5 10 10" aria-hidden="true" style={{ flexShrink: 0 }}>
            <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" stroke="currentColor" strokeWidth={1.8} fill="none" strokeLinecap="round" />
          </svg>
          <span>{e}</span>
        </div>
      ))}
      {validation.warnings.map((w, i) => (
        <div key={`w${i}`} style={{ padding: '6px 10px', background: 'rgba(253,224,71,0.12)', color: '#fde68a', fontSize: 11, fontWeight: 600, borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width={10} height={10} viewBox="-5 -5 10 10" aria-hidden="true" style={{ flexShrink: 0 }}>
            <path d="M 0 -3.5 L 4 3 L -4 3 Z" stroke="currentColor" strokeWidth={1.4} fill="none" strokeLinejoin="round" />
            <path d="M 0 -1 L 0 1.5" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
            <circle cx={0} cy={2.3} r={0.5} fill="currentColor" />
          </svg>
          <span>{w}</span>
        </div>
      ))}
    </div>
  )
}
