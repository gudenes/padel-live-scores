// src/app/ops/padelgenius/editor/_components/QuestionMetaForm.tsx
'use client'
import type { Question, Theme, Difficulty } from '@/lib/padelgenius/types'

const THEMES: Theme[] = ['shots', 'positioning', 'rules', 'communication', 'mixed']
const DIFFICULTIES: Difficulty[] = [1, 2, 3]

export function QuestionMetaForm({ question, onChange }: { question: Question; onChange: (q: Question) => void }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Field label="Prompt">
        <textarea value={question.prompt} onChange={e => onChange({ ...question, prompt: e.target.value })} rows={3} style={textareaStyle} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
        <Field label="Theme">
          <select value={question.theme} onChange={e => onChange({ ...question, theme: e.target.value as Theme })} style={inputStyle}>
            {THEMES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Difficulty">
          <select value={question.difficulty} onChange={e => onChange({ ...question, difficulty: parseInt(e.target.value, 10) as Difficulty })} style={inputStyle}>
            {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Explanation title">
        <input value={question.explanation.title} onChange={e => onChange({ ...question, explanation: { ...question.explanation, title: e.target.value } })} style={inputStyle} />
      </Field>
      <Field label="Explanation body">
        <textarea value={question.explanation.body} onChange={e => onChange({ ...question, explanation: { ...question.explanation, body: e.target.value } })} rows={2} style={textareaStyle} />
      </Field>
      <Field label="Pro tip (optional)">
        <textarea value={question.explanation.proTip ?? ''} onChange={e => onChange({ ...question, explanation: { ...question.explanation, proTip: e.target.value || undefined } })} rows={2} style={textareaStyle} />
      </Field>
    </div>
  )
}

const inputStyle: React.CSSProperties = { background: '#0e0e1a', border: '1px solid #2a2a3e', borderRadius: 4, padding: '4px 8px', color: '#fff', fontSize: 12, width: '100%' }
const textareaStyle: React.CSSProperties = { ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ color: '#94a3b8', fontSize: 9, fontWeight: 700, letterSpacing: 0.5, marginBottom: 3 }}>{label.toUpperCase()}</div>
      {children}
    </div>
  )
}
