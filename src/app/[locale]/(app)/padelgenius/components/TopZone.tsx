// src/app/[locale]/(app)/padelgenius/components/TopZone.tsx
'use client'
import type { Question } from '@/lib/padelgenius/types'

export interface TopZoneProps {
  question: Question
  onExit: () => void
  muted: boolean
  onToggleMute: () => void
}

export function TopZone({ question, onExit, muted, onToggleMute }: TopZoneProps) {
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, padding: '32px 14px 14px',
      background: 'linear-gradient(180deg,rgba(10,10,20,0.92) 0%,rgba(10,10,20,0.7) 60%,rgba(10,10,20,0) 100%)',
      zIndex: 5,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <button
          onClick={onExit}
          aria-label="Exit"
          style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none' }}
        >
          <svg width={10} height={10} viewBox="-5 -5 10 10" aria-hidden="true">
            <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" />
          </svg>
        </button>
        <div style={{ fontSize: 9, color: '#fde047', fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' }}>
          {question.theme} · diff {question.difficulty}
        </div>
        <button
          onClick={onToggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
          style={{ marginLeft: 'auto', width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none' }}
        >
          <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden="true">
            <path d="M 3 6 L 6 6 L 9 3 L 9 13 L 6 10 L 3 10 Z" fill="#fff" />
            {muted ? (
              <path d="M 11 5 L 15 9 M 15 5 L 11 9" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" fill="none" />
            ) : (
              <>
                <path d="M 11 6 Q 12.5 8 11 10" stroke="#fff" strokeWidth={1.3} fill="none" strokeLinecap="round" />
                <path d="M 13 4.5 Q 15.5 8 13 11.5" stroke="#fff" strokeWidth={1.3} fill="none" strokeLinecap="round" />
              </>
            )}
          </svg>
        </button>
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.25, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
        {question.prompt}
      </div>
    </div>
  )
}
