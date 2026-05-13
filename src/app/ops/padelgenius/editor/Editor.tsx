// src/app/ops/padelgenius/editor/Editor.tsx
'use client'
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { Question, CourtConfig, OptionId } from '@/lib/padelgenius/types'
import { validateQuestion } from '@/lib/padelgenius/question-validation'
import { QuestionList } from './_components/QuestionList'
import { QuestionMetaForm } from './_components/QuestionMetaForm'
import { CourtPreview } from './_components/CourtPreview'
import { OptionRow } from './_components/OptionRow'
import { ValidationBanner } from './_components/ValidationBanner'
import { TestPlayPanel } from './_components/TestPlayPanel'

export function Editor({ initialQuestions, court }: { initialQuestions: Question[]; court: CourtConfig }) {
  const [questions, setQuestions] = useState<Question[]>(initialQuestions)
  const [currentId, setCurrentId] = useState<number | null>(initialQuestions[0]?.id ?? null)
  const [expandedOption, setExpandedOption] = useState<OptionId | null>(null)
  const [selectedOption, setSelectedOption] = useState<OptionId | null>(null)
  const [testing, setTesting] = useState(false)
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  const current = questions.find(q => q.id === currentId) ?? null
  const validation = useMemo(() => current ? validateQuestion(current) : null, [current])

  const updateCurrent = (next: Question) => {
    setQuestions(qs => qs.map(q => q.id === next.id ? next : q))
  }

  const createNew = async () => {
    setBusy(true)
    const r = await fetch('/api/ops/padelgenius/questions', { method: 'POST' })
    setBusy(false)
    if (!r.ok) { alert('Create failed'); return }
    const { question } = await r.json()
    setQuestions(qs => [...qs, question])
    setCurrentId(question.id)
  }

  const remove = async (id: number) => {
    setBusy(true)
    await fetch(`/api/ops/padelgenius/questions/${id}`, { method: 'DELETE' })
    setBusy(false)
    setQuestions(qs => qs.filter(q => q.id !== id))
    if (currentId === id) setCurrentId(questions[0]?.id ?? null)
  }

  const save = async () => {
    if (!current) return
    if (!validation?.ok) { alert('Fix validation errors first'); return }
    setBusy(true)
    const r = await fetch(`/api/ops/padelgenius/questions/${current.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(current),
    })
    setBusy(false)
    if (!r.ok) { alert('Save failed'); return }
    router.refresh()
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0a0a14', color: '#e2e8f0' }}>
      <QuestionList
        questions={questions}
        currentId={currentId}
        onSelect={(id) => { setCurrentId(id); setExpandedOption(null); setSelectedOption(null) }}
        onCreate={createNew}
        onDelete={remove}
      />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {!current && <div style={{ margin: 'auto', color: '#475569' }}>Pick a question on the left, or click + NEW.</div>}
        {current && (
          <>
            <div style={{ flex: 1, padding: 12, overflowY: 'auto', borderRight: '1px solid #2a2a3e' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <h2 style={{ fontSize: 14, fontWeight: 900, margin: 0 }}>Q{current.id}</h2>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setTesting(true)} style={{ background: '#1a1a2e', border: '1px solid #2a2a3e', color: '#fde047', borderRadius: 6, padding: '5px 10px', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}>TEST PLAY</button>
                  <button onClick={save} disabled={busy || !validation?.ok} style={{ background: validation?.ok ? '#22c55e' : '#1a1a2e', border: '1px solid #15803d', color: validation?.ok ? '#0a0a14' : '#475569', borderRadius: 6, padding: '5px 10px', fontSize: 10, fontWeight: 900, cursor: validation?.ok ? 'pointer' : 'not-allowed' }}>{busy ? 'SAVING...' : 'SAVE'}</button>
                </div>
              </div>
              {validation && <ValidationBanner validation={validation} />}
              <div style={{ marginTop: 12 }}>
                <QuestionMetaForm question={current} onChange={updateCurrent} />
              </div>
              <div style={{ marginTop: 16 }}>
                <div style={{ color: '#fde047', fontSize: 10, fontWeight: 800, letterSpacing: 1, marginBottom: 6 }}>OPTIONS</div>
                {current.options.map(opt => (
                  <OptionRow
                    key={opt.id}
                    option={opt}
                    expanded={expandedOption === opt.id}
                    selected={selectedOption === opt.id}
                    onToggleExpanded={() => setExpandedOption(expandedOption === opt.id ? null : opt.id)}
                    onSelect={() => setSelectedOption(opt.id)}
                    onChange={(next) => updateCurrent({ ...current, options: current.options.map(o => o.id === next.id ? next : o) })}
                    onSetCorrect={() => updateCurrent({ ...current, options: current.options.map(o => ({ ...o, isCorrect: o.id === opt.id })) })}
                    onDelete={() => updateCurrent({ ...current, options: current.options.filter(o => o.id !== opt.id) })}
                  />
                ))}
                {current.options.length < 4 && (
                  <button onClick={() => {
                    const nextId: OptionId = (['a', 'b', 'c', 'd'] as OptionId[]).find(c => !current.options.some(o => o.id === c))!
                    updateCurrent({
                      ...current,
                      options: [...current.options, {
                        id: nextId, label: `Option ${nextId.toUpperCase()}`, direction: '', letter: { x: 50, y: 50 }, isCorrect: false,
                        outcome: { ball: { x: 50, y: 50 }, trajectory: { from: [50, 50], to: [50, 50], style: 'flat' } },
                      }],
                    })
                  }} style={{ background: '#1a1a2e', border: '1px dashed #2a2a3e', color: '#94a3b8', borderRadius: 6, padding: '6px 12px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>+ Add option</button>
                )}
              </div>
            </div>
            <div style={{ flex: 1, padding: 12, overflowY: 'auto', display: 'flex', justifyContent: 'center' }}>
              <CourtPreview court={court} question={current} selectedOptionId={selectedOption} onChange={updateCurrent} />
            </div>
          </>
        )}
      </div>
      {testing && current && <TestPlayPanel court={court} question={current} onClose={() => setTesting(false)} />}
    </div>
  )
}
