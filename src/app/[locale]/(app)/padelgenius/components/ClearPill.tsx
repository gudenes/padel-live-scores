// src/app/[locale]/(app)/padelgenius/components/ClearPill.tsx
'use client'
export interface ClearPillProps {
  onClear: () => void
}

export function ClearPill({ onClear }: ClearPillProps) {
  return (
    <button
      onClick={onClear}
      style={{
        position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%) rotate(-3deg)',
        background: '#475569', border: '3px solid #1A1A2E', borderRadius: 14,
        padding: '6px 14px', color: '#fff', fontSize: 11, fontWeight: 900, letterSpacing: 0.8,
        whiteSpace: 'nowrap', filter: 'drop-shadow(0 4px 0 #1e293b) drop-shadow(0 5px 0 rgba(0,0,0,0.4))',
        zIndex: 5, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}
    >
      <svg width={10} height={10} viewBox="-5 -5 10 10" aria-hidden="true">
        <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" fill="none" />
      </svg>
      CLEAR
    </button>
  )
}
