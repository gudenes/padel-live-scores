// src/app/[locale]/(app)/padelgenius/components/PlayMode.tsx
'use client'
import { useState, useCallback } from 'react'
import type { Question, OptionId, TrajectoryStyle } from '@/lib/padelgenius/types'
import { scoreAnswer } from '@/lib/padelgenius/scoring'
import { usePadelgeniusSound } from '@/hooks/usePadelgeniusSound'
import { Scene } from './Scene'
import { TopZone } from './TopZone'
import { ProgressBar } from './ProgressBar'
import { ClearPill } from './ClearPill'
import { RevealSheet } from './RevealSheet'

export interface PlayModeProps {
  questions: Question[]   // typically 5
  onExit: () => void
  onComplete: (results: { questionId: number; picked: OptionId | null; correct: boolean }[]) => void
}

type Phase = 'idle' | 'selecting' | 'revealing' | 'summary'

function swooshFor(style: TrajectoryStyle): 'swoosh-flat' | 'swoosh-lob' | 'swoosh-smash' {
  if (style === 'lob') return 'swoosh-lob'
  if (style === 'smash' || style === 'vibora') return 'swoosh-smash'
  return 'swoosh-flat'
}

export function PlayMode({ questions, onExit, onComplete }: PlayModeProps) {
  const [idx, setIdx] = useState(0)
  const [selected, setSelected] = useState<OptionId | null>(null)
  const [picked, setPicked] = useState<OptionId | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [history, setHistory] = useState<('correct' | 'wrong')[]>([])
  const [results, setResults] = useState<{ questionId: number; picked: OptionId | null; correct: boolean }[]>([])
  const sound = usePadelgeniusSound()

  const q = questions[idx]

  const renderPhase: 'idle' | 'selecting' | 'revealing' = phase === 'summary' || phase === 'idle' ? 'idle' : phase

  const handleSelect = useCallback((id: OptionId) => {
    if (phase === 'revealing' || phase === 'summary') return
    setSelected(id)
    setPhase('selecting')
    sound.play('tap')
  }, [phase, sound])

  const handleClear = useCallback(() => {
    setSelected(null)
    setPhase('idle')
  }, [])

  const handleConfirm = useCallback(() => {
    if (!selected) return
    sound.play('confirm')
    const result = scoreAnswer(q, selected)
    setPicked(selected)
    setHistory(h => [...h, result.correct ? 'correct' : 'wrong'])
    setResults(r => [...r, { questionId: q.id, picked: selected, correct: result.correct }])
    setPhase('revealing')
    // play swoosh + correct/wrong shortly after
    const opt = q.options.find(o => o.id === selected)
    if (opt) sound.play(swooshFor(opt.outcome.trajectory.style))
    setTimeout(() => sound.play(result.correct ? 'correct' : 'wrong'), 250)
  }, [q, selected, sound])

  const handleContinue = useCallback(() => {
    if (idx + 1 >= questions.length) {
      sound.play('complete')
      setPhase('summary')
      onComplete(results)
      return
    }
    sound.play('continue')
    setIdx(idx + 1)
    setSelected(null)
    setPicked(null)
    setPhase('idle')
  }, [idx, questions.length, results, sound, onComplete])

  // Auto-advance unused — user always taps CONTINUE.

  if (phase === 'summary') {
    // Caller (page.tsx) is expected to show its own summary screen; we just unmount.
    return null
  }

  return (
    <div className="pg-no-motion-reduce" style={{ position: 'fixed', inset: 0, background: '#0a0a14', overflow: 'hidden', zIndex: 9999 }}>
      <div key={idx} style={{ position: 'absolute', inset: 0, animation: 'pg-fade-in 250ms ease-out' }}>
        <Scene
          question={q}
          phase={renderPhase}
          selectedId={selected}
          pickedId={picked}
          onSelect={handleSelect}
          onConfirm={handleConfirm}
        />
        <TopZone question={q} onExit={onExit} muted={sound.muted} onToggleMute={sound.toggleMuted} />
        <ProgressBar total={questions.length} current={idx} history={history} />
        {phase === 'selecting' && <ClearPill onClear={handleClear} />}
        {phase === 'revealing' && picked && (
          <RevealSheet
            question={q}
            correct={picked === q.options.find(o => o.isCorrect)?.id}
            picked={picked}
            onContinue={handleContinue}
          />
        )}
        {phase === 'idle' && <HintPill />}
      </div>
    </div>
  )
}

function HintPill() {
  return (
    <div style={{
      position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)',
      padding: '6px 14px', borderRadius: 14, background: 'rgba(10,10,20,0.85)', backdropFilter: 'blur(6px)',
      border: '1.5px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.85)',
      fontSize: 10, fontWeight: 700, letterSpacing: 0.5, whiteSpace: 'nowrap', zIndex: 5,
      animation: 'pg-breathe 1.6s ease-in-out infinite',
    }}>
      Tap a letter on the court
    </div>
  )
}
