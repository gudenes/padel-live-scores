// src/app/ops/padelgenius/editor/_components/TestPlayPanel.tsx
'use client'
import { ActiveCourtProvider } from '@/app/[locale]/(app)/padelgenius/components/ActiveCourtProvider'
import { PlayMode } from '@/app/[locale]/(app)/padelgenius/components/PlayMode'
import type { Question, CourtConfig } from '@/lib/padelgenius/types'

export function TestPlayPanel({ court, question, onClose }: { court: CourtConfig; question: Question; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 360, height: 720, position: 'relative', borderRadius: 24, overflow: 'hidden', boxShadow: '0 30px 60px rgba(0,0,0,0.8)' }}>
        <ActiveCourtProvider court={court}>
          <PlayMode questions={[question]} onExit={onClose} onComplete={() => onClose()} />
        </ActiveCourtProvider>
      </div>
      <button onClick={onClose}
        style={{ position: 'absolute', top: 20, right: 20, background: '#fff', color: '#0a0a14', borderRadius: '50%', width: 36, height: 36, fontWeight: 900, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
        aria-label="Close test panel">
        <svg width={14} height={14} viewBox="-7 -7 14 14" aria-hidden="true">
          <path d="M -4 -4 L 4 4 M 4 -4 L -4 4" stroke="currentColor" strokeWidth={2} fill="none" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
