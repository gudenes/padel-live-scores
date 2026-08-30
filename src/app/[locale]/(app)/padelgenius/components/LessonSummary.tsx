// src/app/[locale]/(app)/padelgenius/components/LessonSummary.tsx
'use client'
import type { Question, OptionId } from '@/lib/padelgenius/types'

export interface LessonSummaryProps {
  questions: Question[]
  results: { questionId: number; picked: OptionId | null; correct: boolean }[]
  onPlayAgain: () => void
  onExit: () => void
}

export function LessonSummary({ questions, results, onPlayAgain, onExit }: LessonSummaryProps) {
  const correctCount = results.filter(r => r.correct).length
  const xp = correctCount * 100

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0a14', color: '#fff', overflow: 'auto', padding: 16, zIndex: 9999 }}>
      <div style={{ maxWidth: 420, margin: '0 auto', textAlign: 'center', paddingTop: 48 }}>
        <div style={{ fontSize: 11, color: '#fde047', fontWeight: 900, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>Lesson complete</div>
        <h1 style={{ fontSize: 40, fontWeight: 900, margin: 0 }}>{correctCount}/{questions.length}</h1>
        <div style={{ color: '#94a3b8', marginTop: 6 }}>{correctCount === questions.length ? 'Perfect run.' : 'Nice work — review the misses below.'}</div>

        <div style={{ background: '#0e0e1a', border: '1px solid #2a2a3e', borderRadius: 16, padding: 16, marginTop: 24 }}>
          <div style={{ fontSize: 28, color: '#fde047', fontWeight: 900 }}>+{xp}</div>
          <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' }}>XP earned</div>
        </div>

        <div style={{ marginTop: 24, textAlign: 'left' }}>
          {results.map((r, i) => {
            const q = questions[i]
            const correctOpt = q.options.find(o => o.isCorrect)
            return (
              <div key={i} style={{
                display: 'flex', gap: 10, padding: '8px 10px', marginBottom: 6, borderRadius: 8,
                background: r.correct ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
                border: `1px solid ${r.correct ? 'rgba(34,197,94,0.30)' : 'rgba(239,68,68,0.30)'}`,
              }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                  background: r.correct ? '#22c55e' : '#ef4444',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width={14} height={14} viewBox="-7 -7 14 14" aria-hidden="true">
                    {r.correct ? (
                      <path d="M -4 0 L -1 3 L 4 -3" stroke="#0a0a14" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    ) : (
                      <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" stroke="#0a0a14" strokeWidth={2.5} fill="none" strokeLinecap="round" />
                    )}
                  </svg>
                </div>
                <div style={{ flex: 1, fontSize: 12, lineHeight: 1.4 }}>
                  <div style={{ color: '#e2e8f0' }}>{q.prompt}</div>
                  <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>Correct: <strong style={{ color: '#86efac' }}>{correctOpt?.label}</strong></div>
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button onClick={onPlayAgain} style={{ background: '#22c55e', color: '#0a0a14', padding: '10px 20px', borderRadius: 12, fontWeight: 900, border: 'none', cursor: 'pointer' }}>Play again</button>
          <button onClick={onExit} style={{ background: '#1e293b', color: '#e2e8f0', padding: '10px 20px', borderRadius: 12, fontWeight: 900, border: 'none', cursor: 'pointer' }}>Exit</button>
        </div>
      </div>
    </div>
  )
}
