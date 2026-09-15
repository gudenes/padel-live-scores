// src/app/ops/padelgenius/editor/Editor.tsx
'use client'
import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { Question, CourtConfig, OptionId, TrajectoryStyle, Trajectory } from '@/lib/padelgenius/types'
import { introSegments } from '@/lib/padelgenius/trajectories'
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
  // Mutually exclusive with selectedOption — when true, the bottom toolbar +
  // CourtPreview drag handles edit the question's intro animation.
  const [editingIntro, setEditingIntro] = useState(false)
  const [testing, setTesting] = useState(false)
  const [busy, setBusy] = useState(false)
  // Layout state — collapsible side panels so the court takes the main area
  const [listCollapsed, setListCollapsed] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const router = useRouter()

  const current = questions.find(q => q.id === currentId) ?? null
  const validation = useMemo(() => current ? validateQuestion(current) : null, [current])

  // Auto-expand the form drawer whenever the user expands an option row
  // (so the inline editor is visible without an extra click)
  useEffect(() => {
    if (expandedOption !== null) setFormOpen(true)
  }, [expandedOption])

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

  const handleSelectQuestion = (id: number) => {
    setCurrentId(id)
    setExpandedOption(null)
    setSelectedOption(null)
    setEditingIntro(false)
  }

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0a0a14', color: '#e2e8f0', overflow: 'hidden' }}>
      <QuestionList
        questions={questions}
        currentId={currentId}
        collapsed={listCollapsed}
        onToggleCollapsed={() => setListCollapsed(c => !c)}
        onSelect={handleSelectQuestion}
        onCreate={createNew}
        onDelete={remove}
      />

      {/* Main area — court takes most of the screen */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!current ? (
          <div style={{ margin: 'auto', color: '#475569' }}>Pick a question on the left, or click + NEW.</div>
        ) : (
          <>
            {/* Top toolbar — question id, validation status, action buttons */}
            <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid #2a2a3e', background: '#0e0e1a' }}>
              <div>
                <div style={{ fontSize: 9, color: '#fde047', fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase' }}>Question</div>
                <h2 style={{ fontSize: 16, fontWeight: 900, margin: 0 }}>Q{current.id}</h2>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#cbd5e1', fontSize: 12, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {current.prompt}
                </div>
              </div>
              {validation && (
                <div style={{ flexShrink: 0 }}>
                  <ValidationBanner validation={validation} />
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => setFormOpen(o => !o)}
                  style={{ background: formOpen ? '#1e88e5' : '#1a1a2e', border: '1px solid #2a2a3e', color: formOpen ? '#fff' : '#94a3b8', borderRadius: 6, padding: '6px 12px', fontSize: 10, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  {formOpen ? 'CLOSE EDIT' : 'EDIT DETAILS'}
                </button>
                <button onClick={() => setTesting(true)} style={{ background: '#1a1a2e', border: '1px solid #2a2a3e', color: '#fde047', borderRadius: 6, padding: '6px 12px', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}>TEST PLAY</button>
                <button onClick={save} disabled={busy || !validation?.ok} style={{ background: validation?.ok ? '#22c55e' : '#1a1a2e', border: '1px solid #15803d', color: validation?.ok ? '#0a0a14' : '#475569', borderRadius: 6, padding: '6px 12px', fontSize: 10, fontWeight: 900, cursor: validation?.ok ? 'pointer' : 'not-allowed' }}>
                  {busy ? 'SAVING...' : 'SAVE'}
                </button>
              </div>
            </header>

            {/* Court + drawer row */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              {/* Large court preview */}
              <div style={{ flex: 1, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                <div style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                  <CourtPreview court={court} question={current} selectedOptionId={selectedOption} editingIntro={editingIntro} onChange={updateCurrent} />
                </div>
              </div>

              {/* Right drawer — meta form + option rows */}
              {formOpen && (
                <aside style={{ width: 400, borderLeft: '1px solid #2a2a3e', background: '#0e0e1a', overflowY: 'auto', padding: 14, flexShrink: 0 }}>
                  <div style={{ display: 'grid', gap: 14 }}>
                    <QuestionMetaForm question={current} onChange={updateCurrent} />
                    <div>
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
                        }} style={{ background: '#1a1a2e', border: '1px dashed #2a2a3e', color: '#94a3b8', borderRadius: 6, padding: '6px 12px', fontSize: 10, fontWeight: 700, cursor: 'pointer', width: '100%', marginTop: 4 }}>+ Add option</button>
                      )}
                    </div>
                  </div>
                </aside>
              )}
            </div>

            {/* Floating toolbar at the bottom of the court */}
            {!formOpen && (
              <CourtToolbar
                question={current}
                selectedOption={selectedOption}
                editingIntro={editingIntro}
                onSelectOption={(id) => { setEditingIntro(false); setSelectedOption(selectedOption === id ? null : id) }}
                onSelectBase={() => { setEditingIntro(false); setSelectedOption(null) }}
                onSelectIntro={() => { setSelectedOption(null); setEditingIntro(e => !e) }}
                onChangeQuestion={updateCurrent}
              />
            )}
          </>
        )}
      </div>

      {testing && current && <TestPlayPanel court={court} question={current} onClose={() => setTesting(false)} />}
    </div>
  )
}

// -------------------------------------------------------------------
// CourtToolbar: floating panel on the play surface.
// - Always: A/B/C/D chips to pick which option's trajectory + overrides are active
// - When an option is selected: trajectory style picker + "reset overrides" button
// -------------------------------------------------------------------

const TRAJECTORY_STYLES: TrajectoryStyle[] = ['flat', 'lob', 'bandeja', 'vibora', 'smash', 'chiquita', 'wall-bounce', 'cross']

// Palette for visually distinguishing intro segments in toolbar + court handles.
// Cycles if more segments than colors (rare — usually ≤ 3).
const SEGMENT_COLORS = ['#22d3ee', '#f97316', '#ec4899', '#a3e635', '#a78bfa']

function CourtToolbar({
  question, selectedOption, editingIntro, onSelectOption, onSelectBase, onSelectIntro, onChangeQuestion,
}: {
  question: Question
  selectedOption: OptionId | null
  editingIntro: boolean
  onSelectOption: (id: OptionId) => void
  onSelectBase: () => void
  onSelectIntro: () => void
  onChangeQuestion: (q: Question) => void
}) {
  const sel = question.options.find(o => o.id === selectedOption) ?? null
  const hasIntro = !!question.court.intro
  const inBaseMode = !sel && !editingIntro

  // Always read the segment list through the helper so legacy intros
  // (`trajectory + bounce`) appear here as a 1- or 2-segment array.
  const segments = introSegments(question.court.intro)

  /** Write a fresh `intro` object with the given segments (drops legacy fields). */
  const writeSegments = (next: Trajectory[]) => {
    if (next.length === 0) {
      const { intro: _drop, ...rest } = question.court
      onChangeQuestion({ ...question, court: rest })
      return
    }
    onChangeQuestion({
      ...question,
      court: {
        ...question.court,
        intro: {
          segments: next,
          durationMs: question.court.intro?.durationMs ?? 1500,
        },
      },
    })
  }

  const toggleIntro = () => {
    if (hasIntro) {
      writeSegments([])
    } else {
      writeSegments([{ from: [50, 25], to: [50, 55], style: 'flat' }])
    }
  }

  const addSegment = () => {
    if (!hasIntro || segments.length === 0) return
    const last = segments[segments.length - 1]
    // New segment starts where the previous one ended; defaults to a short
    // forward shot the author can drag wherever they want.
    const newSeg: Trajectory = {
      from: [...last.to] as [number, number],
      to: [Math.min(100, last.to[0] + 15), Math.min(100, last.to[1] + 15)] as [number, number],
      style: 'flat',
    }
    writeSegments([...segments, newSeg])
  }

  const removeSegment = (index: number) => {
    if (segments.length <= 1) return  // always keep at least one segment when intro is on
    const next = segments.filter((_, i) => i !== index)
    // Re-align: every segment's `from` must equal previous segment's `to`
    for (let i = 1; i < next.length; i++) {
      next[i] = { ...next[i], from: [...next[i - 1].to] as [number, number] }
    }
    writeSegments(next)
  }

  const cycleSegmentStyle = (index: number) => {
    const seg = segments[index]
    if (!seg) return
    const i = TRAJECTORY_STYLES.indexOf(seg.style)
    const nextStyle = TRAJECTORY_STYLES[(i + 1) % TRAJECTORY_STYLES.length]
    const next = segments.map((s, idx) => idx === index ? { ...s, style: nextStyle } : s)
    writeSegments(next)
  }

  const cycleStyle = () => {
    if (!sel?.outcome.trajectory) return
    const traj = sel.outcome.trajectory
    const i = TRAJECTORY_STYLES.indexOf(traj.style)
    const next = TRAJECTORY_STYLES[(i + 1) % TRAJECTORY_STYLES.length]
    onChangeQuestion({
      ...question,
      options: question.options.map(o => o.id === sel.id
        ? { ...o, outcome: { ...o.outcome, trajectory: { ...traj, style: next } } }
        : o),
    })
  }

  const resetCurve = () => {
    if (!sel?.outcome.trajectory) return
    const traj = sel.outcome.trajectory
    onChangeQuestion({
      ...question,
      options: question.options.map(o => {
        if (o.id !== sel.id) return o
        const { controlPoint: _drop, ...rest } = traj
        return { ...o, outcome: { ...o.outcome, trajectory: rest } }
      }),
    })
  }

  const toggleTrajectory = () => {
    if (!sel) return
    onChangeQuestion({
      ...question,
      options: question.options.map(o => {
        if (o.id !== sel.id) return o
        if (o.outcome.trajectory) {
          // Remove trajectory entirely
          const { trajectory: _t, ...rest } = o.outcome
          return { ...o, outcome: rest }
        }
        // Seed a default trajectory along the question's existing geometry
        const fallbackFrom: [number, number] = [50, 65]
        const fallbackTo: [number, number] = [o.letter.x, o.letter.y]
        return {
          ...o,
          outcome: {
            ...o.outcome,
            trajectory: { from: fallbackFrom, to: fallbackTo, style: 'flat' },
          },
        }
      }),
    })
  }

  const resetOverrides = () => {
    if (!sel) return
    onChangeQuestion({
      ...question,
      options: question.options.map(o => o.id === sel.id
        ? { ...o, outcome: { ...o.outcome, playerOverrides: undefined } }
        : o),
    })
  }

  const overrideCount = sel?.outcome.playerOverrides?.length ?? 0

  // Per-option setup ball state — present, absent, or falling through to base.
  const hasSetupBallOverride = !!sel?.outcome.setupBall
  const hasFallbackBall = !!question.court.ball
  const toggleSetupBall = () => {
    if (!sel) return
    if (hasSetupBallOverride) {
      // Clear the override (fall back to question-level ball if any)
      onChangeQuestion({
        ...question,
        options: question.options.map(o => o.id === sel.id
          ? { ...o, outcome: { ...o.outcome, setupBall: undefined } }
          : o),
      })
    } else {
      // Seed a new override at the current visible position or court center
      const seed = sel.outcome.setupBall ?? question.court.ball ?? { x: 50, y: 50 }
      onChangeQuestion({
        ...question,
        options: question.options.map(o => o.id === sel.id
          ? { ...o, outcome: { ...o.outcome, setupBall: { ...seed } } }
          : o),
      })
    }
  }

  return (
    <div style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, zIndex: 5 }}>
      {/* Per-option controls bar (trajectory toggle + style picker + reset overrides) */}
      {sel && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'rgba(10,10,20,0.9)', backdropFilter: 'blur(6px)', border: '1px solid #2a2a3e', borderRadius: 999, color: '#cbd5e1', fontSize: 10, fontWeight: 700 }}>
          <span style={{ color: '#fde047', letterSpacing: 0.5, textTransform: 'uppercase' }}>{sel.id.toUpperCase()}</span>
          <span style={{ color: '#475569' }}>·</span>
          <button
            onClick={toggleTrajectory}
            title={sel.outcome.trajectory ? 'Remove trajectory — option will reveal without a flight line' : 'Add a trajectory to this option'}
            style={{
              background: sel.outcome.trajectory ? '#1a1a2e' : '#fde047',
              border: `1px solid ${sel.outcome.trajectory ? '#2a2a3e' : '#ca8a04'}`,
              color: sel.outcome.trajectory ? '#94a3b8' : '#0a0a14',
              borderRadius: 999, padding: '3px 10px', fontSize: 10, fontWeight: 800, cursor: 'pointer',
            }}
          >{sel.outcome.trajectory ? 'TRAJECTORY ON' : '+ ADD TRAJECTORY'}</button>
          {sel.outcome.trajectory && (
            <>
              <span style={{ color: '#475569' }}>·</span>
              <button
                onClick={cycleStyle}
                title="Click to cycle through trajectory styles"
                style={{ background: '#1a1a2e', border: '1px solid #2a2a3e', color: '#7dd3fc', borderRadius: 999, padding: '3px 10px', fontSize: 10, fontWeight: 800, cursor: 'pointer', textTransform: 'capitalize' }}
              >{sel.outcome.trajectory.style}</button>
              <span style={{ color: '#475569' }}>·</span>
              <button
                onClick={resetCurve}
                disabled={!sel.outcome.trajectory.controlPoint}
                title={sel.outcome.trajectory.controlPoint ? 'Clear custom apex — curve returns to the style preset' : 'No custom apex set — drag the purple APEX handle to shape the curve'}
                style={{
                  background: sel.outcome.trajectory.controlPoint ? '#1a1a2e' : 'transparent',
                  border: '1px solid #2a2a3e',
                  color: sel.outcome.trajectory.controlPoint ? '#a78bfa' : '#475569',
                  borderRadius: 999, padding: '3px 10px', fontSize: 10, fontWeight: 800,
                  cursor: sel.outcome.trajectory.controlPoint ? 'pointer' : 'not-allowed',
                }}
              >{sel.outcome.trajectory.controlPoint ? 'RESET CURVE' : 'CURVE: PRESET'}</button>
            </>
          )}
          <span style={{ color: '#475569' }}>·</span>
          <button
            onClick={resetOverrides}
            disabled={overrideCount === 0}
            title="Clear per-option player position overrides"
            style={{ background: overrideCount > 0 ? '#1a1a2e' : 'transparent', border: '1px solid #2a2a3e', color: overrideCount > 0 ? '#fde047' : '#475569', borderRadius: 999, padding: '3px 10px', fontSize: 10, fontWeight: 800, cursor: overrideCount > 0 ? 'pointer' : 'not-allowed' }}
          >
            {overrideCount > 0 ? `RESET (${overrideCount})` : 'NO OVERRIDES'}
          </button>
          <span style={{ color: '#475569' }}>·</span>
          <button
            onClick={toggleSetupBall}
            title={hasSetupBallOverride
              ? 'Remove per-option ball override (fall back to base setup ball)'
              : (hasFallbackBall ? 'Override the ball position for this option' : 'Add a setup ball for this option')}
            style={{
              background: hasSetupBallOverride ? '#fde047' : '#1a1a2e',
              border: `1px solid ${hasSetupBallOverride ? '#ca8a04' : '#2a2a3e'}`,
              color: hasSetupBallOverride ? '#0a0a14' : '#fde047',
              borderRadius: 999, padding: '3px 10px', fontSize: 10, fontWeight: 800, cursor: 'pointer',
            }}
          >
            {hasSetupBallOverride ? 'BALL OVERRIDDEN' : (hasFallbackBall ? 'OVERRIDE BALL' : '+ ADD BALL')}
          </button>
        </div>
      )}

      {/* Intro controls bar — shown only when INTRO mode is active */}
      {editingIntro && (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'rgba(10,10,20,0.9)', backdropFilter: 'blur(6px)', border: '1px solid #2a2a3e', borderRadius: 999, color: '#cbd5e1', fontSize: 10, fontWeight: 700 }}>
          <span style={{ color: '#22d3ee', letterSpacing: 0.5, textTransform: 'uppercase' }}>INTRO</span>
          <span style={{ color: '#475569' }}>·</span>
          <button
            onClick={toggleIntro}
            style={{
              background: hasIntro ? '#1a1a2e' : '#22d3ee',
              border: `1px solid ${hasIntro ? '#2a2a3e' : '#0891b2'}`,
              color: hasIntro ? '#94a3b8' : '#0a0a14',
              borderRadius: 999, padding: '3px 10px', fontSize: 10, fontWeight: 800, cursor: 'pointer',
            }}
          >{hasIntro ? 'INTRO ON' : '+ ADD INTRO ANIMATION'}</button>
          {hasIntro && segments.map((seg, idx) => (
            <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: '#475569' }}>·</span>
              <span style={{ color: SEGMENT_COLORS[idx % SEGMENT_COLORS.length], fontSize: 9, fontWeight: 900, letterSpacing: 0.4 }}>
                {idx + 1}
              </span>
              <button
                onClick={() => cycleSegmentStyle(idx)}
                title={`Segment ${idx + 1} — click to cycle trajectory style`}
                style={{
                  background: '#1a1a2e',
                  border: `1px solid ${SEGMENT_COLORS[idx % SEGMENT_COLORS.length]}`,
                  color: SEGMENT_COLORS[idx % SEGMENT_COLORS.length],
                  borderRadius: 999, padding: '3px 10px', fontSize: 10, fontWeight: 800, cursor: 'pointer', textTransform: 'capitalize',
                }}
              >{seg.style}</button>
              {segments.length > 1 && (
                <button
                  onClick={() => removeSegment(idx)}
                  title={`Remove segment ${idx + 1}`}
                  style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center' }}
                >
                  <svg width={10} height={10} viewBox="-5 -5 10 10" aria-hidden="true">
                    <path d="M -3 -3 L 3 3 M 3 -3 L -3 3" stroke="currentColor" strokeWidth={1.5} fill="none" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </span>
          ))}
          {hasIntro && (
            <>
              <span style={{ color: '#475569' }}>·</span>
              <button
                onClick={addSegment}
                title="Add another segment — ball continues after the last endpoint"
                style={{
                  background: '#f97316',
                  border: '1px solid #c2410c',
                  color: '#0a0a14',
                  borderRadius: 999, padding: '3px 10px', fontSize: 10, fontWeight: 800, cursor: 'pointer',
                }}
              >+ SEGMENT</button>
            </>
          )}
        </div>
      )}

      {/* Mode hint — always visible so the user knows what dragging does right now */}
      <div style={{
        fontSize: 9,
        color: editingIntro ? '#22d3ee' : inBaseMode ? '#7dd3fc' : '#fde047',
        background: 'rgba(10,10,20,0.85)',
        padding: '2px 8px', borderRadius: 4,
        letterSpacing: 0.5, textTransform: 'uppercase', fontWeight: 700,
      }}>
        {editingIntro
          ? (hasIntro
            ? 'Editing intro animation — drag FROM / TO / APEX to shape the ball flight'
            : 'Click + ADD INTRO ANIMATION above to enable the question-load play')
          : inBaseMode
            ? 'Editing base setup — drag players to set their starting positions'
            : 'Editing option reveal — drag a player to override their position on reveal'}
      </div>

      {/* BASE + INTRO + A/B/C/D chip row */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: 4, background: 'rgba(10,10,20,0.85)', backdropFilter: 'blur(6px)', border: '1px solid #2a2a3e', borderRadius: 999 }}>
        <button
          onClick={onSelectBase}
          title="Edit base player positions (no option selected)"
          style={{
            height: 28, padding: '0 12px', borderRadius: 999,
            background: inBaseMode ? '#7dd3fc' : '#1a1a2e',
            border: `2px solid ${inBaseMode ? '#0a0a14' : '#2a2a3e'}`,
            color: inBaseMode ? '#0a0a14' : '#7dd3fc',
            fontSize: 10, fontWeight: 900, cursor: 'pointer', letterSpacing: 0.5,
          }}
        >BASE</button>
        <button
          onClick={onSelectIntro}
          title="Edit the intro animation that plays once on question load"
          style={{
            height: 28, padding: '0 12px', borderRadius: 999,
            background: editingIntro ? '#22d3ee' : '#1a1a2e',
            border: `2px solid ${editingIntro ? '#0a0a14' : '#2a2a3e'}`,
            color: editingIntro ? '#0a0a14' : '#22d3ee',
            fontSize: 10, fontWeight: 900, cursor: 'pointer', letterSpacing: 0.5,
          }}
        >INTRO{hasIntro ? '' : ' +'}</button>
        <span style={{ width: 1, height: 18, background: '#2a2a3e' }} />
        {question.options.map(opt => (
          <button
            key={opt.id}
            onClick={() => onSelectOption(opt.id)}
            title={opt.label || `Option ${opt.id.toUpperCase()}`}
            style={{
              width: 28, height: 28, borderRadius: '50%',
              background: selectedOption === opt.id ? '#1e88e5' : opt.isCorrect ? '#22c55e' : '#1a1a2e',
              border: `2px solid ${selectedOption === opt.id ? '#0a0a14' : '#2a2a3e'}`,
              color: '#fff',
              fontSize: 11, fontWeight: 900, cursor: 'pointer',
            }}
          >{opt.id.toUpperCase()}</button>
        ))}
      </div>
    </div>
  )
}
