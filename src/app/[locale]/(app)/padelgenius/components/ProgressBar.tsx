'use client'
import { DEFAULT_COURT } from '@/lib/padelgenius/default-court'

export interface ProgressBarProps {
  total: number      // e.g. 5
  current: number    // 0-based index of current question
  history: ('correct' | 'wrong')[]  // results so far, length = current
}

export function ProgressBar({ total, current, history }: ProgressBarProps) {
  const tilt = DEFAULT_COURT.visualSystem.progressBarTilt
  return (
    <div
      aria-label="Lesson progress"
      style={{
        position: 'absolute',
        top: '15%',
        bottom: '12%',
        right: 0,
        width: 46,
        zIndex: 4,
      }}
    >
      <div style={{ position: 'absolute', inset: 0, transformOrigin: 'top right', transform: `rotate(${tilt}deg)` }}>
        <div style={{ position: 'absolute', right: 6, top: 0, bottom: 0, width: 22, display: 'flex', flexDirection: 'column-reverse', gap: 5 }}>
          {Array.from({ length: total }).map((_, i) => {
            const isDone = i < current
            const isCurrent = i === current
            const result = history[i]
            const bg = isDone
              ? result === 'correct' ? '#22c55e' : '#ef4444'
              : isCurrent ? '#fde047' : 'rgba(255,255,255,0.18)'
            const glow = isCurrent ? 'drop-shadow(0 0 10px rgba(253,224,71,0.8))' : ''
            return (
              <div key={i} style={{
                flex: 1,
                background: bg,
                border: '3.5px solid #1A1A2E',
                borderRadius: 5,
                filter: `drop-shadow(0 3px 0 rgba(0,0,0,0.55)) ${glow}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 200ms ease-out',
              }}>
                {isDone && (
                  <svg width={14} height={14} viewBox="-7 -7 14 14" aria-hidden="true">
                    {result === 'correct' ? (
                      <path d="M -4 0 L -1 3 L 4 -3" stroke="#fff" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    ) : (
                      <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" stroke="#fff" strokeWidth={2.5} fill="none" strokeLinecap="round" />
                    )}
                  </svg>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
