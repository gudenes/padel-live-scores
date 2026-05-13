# PadelGenius v2 · Phase 3 — Question Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship `/ops/padelgenius/editor` — a click-to-place question authoring tool. Pick or create a question, drag handles to place players, letters, ball, and trajectory endpoints, set per-option metadata + outcomes, validate, test-play, save. Replaces hand-editing of `genius-questions.json`.

**Architecture:** New admin page consuming the same `Question` schema from Phase 1. Questions persist as a JSON file at `src/data/genius-questions.json` for v1 (DB migration is a separate future task). Save goes through a small admin API route. The editor uses the **active court** from Phase 2 for the preview, so the same court that ships in production is what authors see.

**Tech Stack:** Next.js 16 App Router, React 19, native `pointerdown/pointermove/pointerup` for dragging (no DnD library), Vitest for unit tests.

**Spec reference:** §8.3 of `docs/superpowers/specs/2026-05-13-padelgenius-v2-design.md`.

**Depends on:** Phase 1 (types, projection, trajectory rendering), Phase 2 (`useActiveCourt`).

---

## File Structure

### New files

```
src/lib/padelgenius/
  question-store.ts                       ← server: read/write src/data/genius-questions.json
  question-validation.ts                  ← pure: validates a Question (one isCorrect, no overlap, valid coords)
  __tests__/question-validation.test.ts

src/app/api/ops/padelgenius/
  questions/route.ts                      ← GET list, POST create new
  questions/[id]/route.ts                 ← GET one, PATCH update, DELETE

src/app/ops/padelgenius/editor/
  page.tsx                                 ← entry: server-loads questions + active court
  Editor.tsx                               ← top-level client component (two-pane layout)
  _components/
    QuestionList.tsx                       ← left sidebar: list + filters + new question button
    QuestionMetaForm.tsx                   ← right panel: prompt, theme, difficulty, explanation
    CourtPreview.tsx                       ← center: SVG with draggable handles for players/letters/ball/trajectory
    OptionRow.tsx                          ← collapsed/expanded mini-editor per option (label, direction, style, isCorrect, override, etc.)
    DragHandle.tsx                         ← reusable SVG circle handle that emits coord-space drags
    TrajectoryStylePicker.tsx              ← chip-select for 8 styles with mini icons
    PlayerOverrideEditor.tsx               ← optional player position overrides per option
    TestPlayPanel.tsx                      ← side panel mounting <PlayMode> with the current draft question
    ValidationBanner.tsx                   ← banner showing current validation issues
```

### Modified files

```
src/data/genius-questions.json           ← writable from the editor (server-side via API)
```

(Phase 3 doesn't touch the play screen at all — it consumes Phase 1's `PlayMode` for the Test Play preview.)

---

## Task 1: Worktree

- [ ] **Step 1:** Create worktree

```bash
git worktree add .worktrees/padelgenius-v2-phase-3 -b feature/padelgenius-v2-phase-3 main
cd .worktrees/padelgenius-v2-phase-3
ln -s /Users/GuDenes/Projects/padel-live-scores/node_modules node_modules
```

- [ ] **Step 2:** Verify Phase 1 + 2 baseline are green

```bash
npx vitest run src/lib/padelgenius/__tests__/
```

Expected: all pass.

---

## Task 2: Question validation module + tests

**Files:**
- Create: `src/lib/padelgenius/question-validation.ts`
- Create: `src/lib/padelgenius/__tests__/question-validation.test.ts`

- [ ] **Step 1:** Write failing tests

```ts
// src/lib/padelgenius/__tests__/question-validation.test.ts
import { describe, it, expect } from 'vitest'
import { validateQuestion } from '../question-validation'
import type { Question } from '../types'

function makeQ(overrides: Partial<Question> = {}): Question {
  return {
    id: 1, prompt: 'Test', theme: 'shots', difficulty: 1,
    court: { players: [
      { role: 'you', x: 40, y: 80 }, { role: 'partner', x: 60, y: 80 },
      { role: 'opponent1', x: 40, y: 20 }, { role: 'opponent2', x: 60, y: 20 },
    ] },
    options: [
      { id: 'a', label: 'A', direction: '', letter: { x: 30, y: 30 }, isCorrect: true,
        outcome: { ball: { x: 30, y: 30 }, trajectory: { from: [50, 50], to: [30, 30], style: 'flat' } } },
      { id: 'b', label: 'B', direction: '', letter: { x: 70, y: 30 }, isCorrect: false,
        outcome: { ball: { x: 70, y: 30 }, trajectory: { from: [50, 50], to: [70, 30], style: 'flat' } } },
    ],
    explanation: { title: 'T', body: 'B' },
    ...overrides,
  }
}

describe('validateQuestion', () => {
  it('passes a valid question', () => {
    const r = validateQuestion(makeQ())
    expect(r.ok).toBe(true)
  })

  it('rejects when no option is correct', () => {
    const q = makeQ()
    q.options.forEach(o => o.isCorrect = false)
    const r = validateQuestion(q)
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('Exactly one option must be marked correct (found 0)')
  })

  it('rejects when multiple options are correct', () => {
    const q = makeQ()
    q.options[1].isCorrect = true
    const r = validateQuestion(q)
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('Exactly one option must be marked correct (found 2)')
  })

  it('rejects coords outside 0–100', () => {
    const q = makeQ()
    q.options[0].letter.x = 150
    const r = validateQuestion(q)
    expect(r.ok).toBe(false)
    expect(r.errors.some(e => /letter|coords|range/i.test(e))).toBe(true)
  })

  it('warns when two letters are very close (overlap)', () => {
    const q = makeQ()
    q.options[1].letter = { x: 31, y: 31 } // ~1.4 units from option a
    const r = validateQuestion(q)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('rejects empty prompt', () => {
    const q = makeQ({ prompt: '' })
    const r = validateQuestion(q)
    expect(r.ok).toBe(false)
    expect(r.errors.some(e => /prompt/i.test(e))).toBe(true)
  })

  it('rejects fewer than 3 options', () => {
    const q = makeQ()
    q.options = q.options.slice(0, 1)
    const r = validateQuestion(q)
    expect(r.ok).toBe(false)
    expect(r.errors.some(e => /3.*options|at least/i.test(e))).toBe(true)
  })
})
```

- [ ] **Step 2:** Run — should fail

```bash
npx vitest run src/lib/padelgenius/__tests__/question-validation.test.ts
```

- [ ] **Step 3:** Implement

```ts
// src/lib/padelgenius/question-validation.ts
import type { Question } from './types'

export interface ValidationResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

function inRange(v: number): boolean { return v >= 0 && v <= 100 }
function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function validateQuestion(q: Question): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!q.prompt || q.prompt.trim().length === 0) errors.push('Prompt is required')
  if (q.options.length < 3) errors.push(`At least 3 options required (got ${q.options.length})`)
  if (q.options.length > 4) errors.push(`At most 4 options (got ${q.options.length})`)

  const correctCount = q.options.filter(o => o.isCorrect).length
  if (correctCount !== 1) errors.push(`Exactly one option must be marked correct (found ${correctCount})`)

  for (const opt of q.options) {
    if (!inRange(opt.letter.x) || !inRange(opt.letter.y)) errors.push(`Option ${opt.id.toUpperCase()}: letter coords out of range 0–100`)
    if (!inRange(opt.outcome.ball.x) || !inRange(opt.outcome.ball.y)) errors.push(`Option ${opt.id.toUpperCase()}: outcome ball out of range`)
    const [tfx, tfy] = opt.outcome.trajectory.from
    const [ttx, tty] = opt.outcome.trajectory.to
    if (!inRange(tfx) || !inRange(tfy) || !inRange(ttx) || !inRange(tty)) errors.push(`Option ${opt.id.toUpperCase()}: trajectory endpoints out of range`)
  }

  // Overlap warnings — letters within 5 normalized units of each other
  for (let i = 0; i < q.options.length; i++) {
    for (let j = i + 1; j < q.options.length; j++) {
      if (dist(q.options[i].letter, q.options[j].letter) < 5) {
        warnings.push(`Options ${q.options[i].id.toUpperCase()} and ${q.options[j].id.toUpperCase()} are very close — they may visually overlap`)
      }
    }
  }

  // Player positions
  for (const p of q.court.players) {
    if (!inRange(p.x) || !inRange(p.y)) errors.push(`Player ${p.role}: coords out of range`)
  }

  return { ok: errors.length === 0, errors, warnings }
}
```

- [ ] **Step 4:** Run — should pass

```bash
npx vitest run src/lib/padelgenius/__tests__/question-validation.test.ts
```

- [ ] **Step 5:** Commit

```bash
git add src/lib/padelgenius/question-validation.ts src/lib/padelgenius/__tests__/question-validation.test.ts
git commit -m "feat(padelgenius): validateQuestion + tests"
```

---

## Task 3: Question store (server)

**Files:**
- Create: `src/lib/padelgenius/question-store.ts`

- [ ] **Step 1:** Write the store

```ts
// src/lib/padelgenius/question-store.ts
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Question } from './types'

const FILE = path.join(process.cwd(), 'src', 'data', 'genius-questions.json')

export async function loadAllQuestions(): Promise<Question[]> {
  const raw = await fs.readFile(FILE, 'utf-8')
  return JSON.parse(raw) as Question[]
}

export async function loadQuestion(id: number): Promise<Question | null> {
  const all = await loadAllQuestions()
  return all.find(q => q.id === id) ?? null
}

export async function saveQuestion(q: Question): Promise<void> {
  const all = await loadAllQuestions()
  const idx = all.findIndex(x => x.id === q.id)
  if (idx === -1) all.push(q)
  else all[idx] = q
  await fs.writeFile(FILE, JSON.stringify(all, null, 2) + '\n')
}

export async function createQuestion(): Promise<Question> {
  const all = await loadAllQuestions()
  const nextId = (all.reduce((m, q) => Math.max(m, q.id), 0)) + 1
  const newQ: Question = {
    id: nextId,
    prompt: 'New question — edit me',
    theme: 'shots',
    difficulty: 1,
    court: {
      players: [
        { role: 'you',       x: 40, y: 85 },
        { role: 'partner',   x: 60, y: 85 },
        { role: 'opponent1', x: 40, y: 15 },
        { role: 'opponent2', x: 60, y: 15 },
      ],
    },
    options: [
      { id: 'a', label: 'Option A', direction: '', letter: { x: 30, y: 30 }, isCorrect: true,
        outcome: { ball: { x: 30, y: 30 }, trajectory: { from: [50, 50], to: [30, 30], style: 'flat' } } },
      { id: 'b', label: 'Option B', direction: '', letter: { x: 50, y: 30 }, isCorrect: false,
        outcome: { ball: { x: 50, y: 30 }, trajectory: { from: [50, 50], to: [50, 30], style: 'flat' } } },
      { id: 'c', label: 'Option C', direction: '', letter: { x: 70, y: 30 }, isCorrect: false,
        outcome: { ball: { x: 70, y: 30 }, trajectory: { from: [50, 50], to: [70, 30], style: 'flat' } } },
    ],
    explanation: { title: 'Explanation', body: 'Why the correct option works.' },
  }
  all.push(newQ)
  await fs.writeFile(FILE, JSON.stringify(all, null, 2) + '\n')
  return newQ
}

export async function deleteQuestion(id: number): Promise<void> {
  const all = await loadAllQuestions()
  const next = all.filter(q => q.id !== id)
  await fs.writeFile(FILE, JSON.stringify(next, null, 2) + '\n')
}
```

- [ ] **Step 2:** Commit

```bash
git add src/lib/padelgenius/question-store.ts
git commit -m "feat(padelgenius): question store (read/save/create/delete)"
```

---

## Task 4: API routes for questions

**Files:**
- Create: `src/app/api/ops/padelgenius/questions/route.ts`
- Create: `src/app/api/ops/padelgenius/questions/[id]/route.ts`

- [ ] **Step 1:** List + create route

```ts
// src/app/api/ops/padelgenius/questions/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { loadAllQuestions, createQuestion } from '@/lib/padelgenius/question-store'

function authed() {
  const t = cookies().get('ops_token')?.value
  return !!t && t === process.env.CRON_SECRET
}

export async function GET() {
  if (!authed()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const questions = await loadAllQuestions()
  return NextResponse.json({ questions })
}

export async function POST() {
  if (!authed()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const q = await createQuestion()
  return NextResponse.json({ question: q })
}
```

- [ ] **Step 2:** Single question route

```ts
// src/app/api/ops/padelgenius/questions/[id]/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { loadQuestion, saveQuestion, deleteQuestion } from '@/lib/padelgenius/question-store'
import { validateQuestion } from '@/lib/padelgenius/question-validation'
import type { Question } from '@/lib/padelgenius/types'

function authed() {
  const t = cookies().get('ops_token')?.value
  return !!t && t === process.env.CRON_SECRET
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!authed()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const q = await loadQuestion(parseInt(params.id, 10))
  if (!q) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ question: q })
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!authed()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json() as Question
  if (body.id !== parseInt(params.id, 10)) return NextResponse.json({ error: 'id mismatch' }, { status: 400 })
  const v = validateQuestion(body)
  if (!v.ok) return NextResponse.json({ error: 'invalid', validation: v }, { status: 400 })
  await saveQuestion(body)
  return NextResponse.json({ ok: true, validation: v })
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!authed()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  await deleteQuestion(parseInt(params.id, 10))
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3:** Commit

```bash
git add src/app/api/ops/padelgenius/questions/
git commit -m "feat(padelgenius/ops): questions API (list/get/create/update/delete)"
```

---

## Task 5: DragHandle reusable

**Files:**
- Create: `src/app/ops/padelgenius/editor/_components/DragHandle.tsx`

This is the foundation for every draggable on the preview. Emits drag events in normalized 0–100 court coords (using the active court's `fromSvg`).

- [ ] **Step 1:** Write the component

```tsx
// src/app/ops/padelgenius/editor/_components/DragHandle.tsx
'use client'
import { useRef } from 'react'
import { fromSvg, toSvg, W, H } from '@/lib/padelgenius/projection'
import type { CourtBounds } from '@/lib/padelgenius/types'

export interface DragHandleProps {
  /** Current normalized court coords (0–100) */
  x: number
  y: number
  bounds: CourtBounds
  /** Visual radius in SVG units */
  radius?: number
  fill: string
  stroke?: string
  label?: string
  /** Called continuously while dragging, with new normalized coords */
  onChange: (x: number, y: number) => void
  /** SVG element ref of the parent svg (needed to map clientX/Y → svg coords) */
  svgRef: React.RefObject<SVGSVGElement>
}

export function DragHandle({ x, y, bounds, radius = 6, fill, stroke = '#1a1a2e', label, onChange, svgRef }: DragHandleProps) {
  const draggingRef = useRef(false)
  const [px, py] = toSvg(x, y, bounds)

  const start = (e: React.PointerEvent<SVGGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingRef.current = true
  }
  const move = (e: React.PointerEvent<SVGGElement>) => {
    if (!draggingRef.current || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const scaleX = W / rect.width
    const scaleY = H / rect.height
    const svgX = (e.clientX - rect.left) * scaleX
    const svgY = (e.clientY - rect.top) * scaleY
    const [nx, ny] = fromSvg(svgX, svgY, bounds)
    // Clamp to 0–100 even if pointer leaves the trapezoid
    const cx = Math.max(0, Math.min(100, nx === -1 ? x : nx))
    const cy = Math.max(0, Math.min(100, ny === -1 ? y : ny))
    onChange(cx, cy)
  }
  const end = (e: React.PointerEvent<SVGGElement>) => {
    draggingRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
  }

  return (
    <g
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      style={{ cursor: 'grab', touchAction: 'none' }}
    >
      <circle cx={px} cy={py} r={radius + 8} fill="transparent" /> {/* hit area */}
      <circle cx={px} cy={py} r={radius} fill={fill} stroke={stroke} strokeWidth={2} />
      {label && <text x={px} y={py + 3} textAnchor="middle" fontSize={9} fontWeight={900} fill="#fff" stroke="#000" strokeWidth={0.6} paintOrder="stroke">{label}</text>}
    </g>
  )
}
```

- [ ] **Step 2:** Commit

```bash
git add src/app/ops/padelgenius/editor/_components/DragHandle.tsx
git commit -m "feat(padelgenius/editor): reusable DragHandle"
```

---

## Task 6: CourtPreview with all draggable handles

**Files:**
- Create: `src/app/ops/padelgenius/editor/_components/CourtPreview.tsx`

This is the right-side preview of the editor. Renders the active court image, all 4 players, 3-4 letters, the optional initial ball, and (per-selected-option) trajectory endpoints. Each is a `DragHandle`.

- [ ] **Step 1:** Write the component

```tsx
// src/app/ops/padelgenius/editor/_components/CourtPreview.tsx
'use client'
import { useRef } from 'react'
import { W, H, toSvg } from '@/lib/padelgenius/projection'
import { trajectoryPath } from '@/lib/padelgenius/trajectories'
import type { Question, CourtConfig, PlayerRole, OptionId } from '@/lib/padelgenius/types'
import { DragHandle } from './DragHandle'

export interface CourtPreviewProps {
  court: CourtConfig
  question: Question
  selectedOptionId: OptionId | null
  onChange: (next: Question) => void
}

const PLAYER_COLORS: Record<PlayerRole, string> = {
  you: '#ef4444', partner: '#3b82f6', opponent1: '#f97316', opponent2: '#22c55e',
}

export function CourtPreview({ court, question, selectedOptionId, onChange }: CourtPreviewProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const bounds = court.bounds
  const sel = question.options.find(o => o.id === selectedOptionId) ?? null

  const updatePlayer = (role: PlayerRole, x: number, y: number) => {
    onChange({
      ...question,
      court: { ...question.court, players: question.court.players.map(p => p.role === role ? { ...p, x, y } : p) },
    })
  }
  const updateLetter = (id: OptionId, x: number, y: number) => {
    onChange({
      ...question,
      options: question.options.map(o => o.id === id ? { ...o, letter: { x, y } } : o),
    })
  }
  const updateTrajectoryFrom = (id: OptionId, x: number, y: number) => {
    onChange({
      ...question,
      options: question.options.map(o => o.id === id
        ? { ...o, outcome: { ...o.outcome, trajectory: { ...o.outcome.trajectory, from: [x, y] } } }
        : o),
    })
  }
  const updateTrajectoryTo = (id: OptionId, x: number, y: number) => {
    onChange({
      ...question,
      options: question.options.map(o => o.id === id
        ? { ...o, outcome: { ...o.outcome, trajectory: { ...o.outcome.trajectory, to: [x, y] }, ball: { x, y } } }
        : o),
    })
  }
  const updateBall = (x: number, y: number) => {
    onChange({ ...question, court: { ...question.court, ball: { x, y } } })
  }

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 480, aspectRatio: '2/3', display: 'block', background: '#0a0a14', borderRadius: 8 }}>
      {/* Court image */}
      <image href={court.imageUrl} x={0} y={0} width={W} height={H} preserveAspectRatio="xMidYMid slice" />

      {/* Selected option's trajectory preview */}
      {sel && (() => {
        const from = toSvg(sel.outcome.trajectory.from[0], sel.outcome.trajectory.from[1], bounds)
        const to = toSvg(sel.outcome.trajectory.to[0], sel.outcome.trajectory.to[1], bounds)
        return (
          <g>
            <path d={trajectoryPath(sel.outcome.trajectory.style, from, to)}
                  stroke="#1a1a2e" strokeWidth={7} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <path d={trajectoryPath(sel.outcome.trajectory.style, from, to)}
                  stroke={sel.isCorrect ? '#22c55e' : '#1e88e5'} strokeWidth={4} fill="none"
                  strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 5" />
          </g>
        )
      })()}

      {/* Player handles */}
      {question.court.players.map(p => (
        <DragHandle key={p.role}
          x={p.x} y={p.y} bounds={bounds} radius={7}
          fill={PLAYER_COLORS[p.role]} label={p.role[0].toUpperCase()}
          svgRef={svgRef}
          onChange={(x, y) => updatePlayer(p.role, x, y)} />
      ))}

      {/* Letter handles */}
      {question.options.map(opt => (
        <DragHandle key={`letter-${opt.id}`}
          x={opt.letter.x} y={opt.letter.y} bounds={bounds}
          radius={9}
          fill={opt.isCorrect ? '#22c55e' : '#fff'}
          label={opt.id.toUpperCase()}
          svgRef={svgRef}
          onChange={(x, y) => updateLetter(opt.id, x, y)} />
      ))}

      {/* Trajectory endpoint handles for the selected option only */}
      {sel && (
        <>
          <DragHandle x={sel.outcome.trajectory.from[0]} y={sel.outcome.trajectory.from[1]} bounds={bounds}
            radius={6} fill="#1e88e5" label="◉" svgRef={svgRef}
            onChange={(x, y) => updateTrajectoryFrom(sel.id, x, y)} />
          <DragHandle x={sel.outcome.trajectory.to[0]} y={sel.outcome.trajectory.to[1]} bounds={bounds}
            radius={6} fill="#fde047" label="✕" svgRef={svgRef}
            onChange={(x, y) => updateTrajectoryTo(sel.id, x, y)} />
        </>
      )}

      {/* Initial ball */}
      {question.court.ball && (
        <DragHandle x={question.court.ball.x} y={question.court.ball.y} bounds={bounds}
          radius={6} fill="#FFE600" label="●" svgRef={svgRef}
          onChange={(x, y) => updateBall(x, y)} />
      )}
    </svg>
  )
}
```

- [ ] **Step 2:** Commit

```bash
git add src/app/ops/padelgenius/editor/_components/CourtPreview.tsx
git commit -m "feat(padelgenius/editor): CourtPreview with draggable handles"
```

---

## Task 7: TrajectoryStylePicker

**Files:**
- Create: `src/app/ops/padelgenius/editor/_components/TrajectoryStylePicker.tsx`

- [ ] **Step 1:** Write the picker

```tsx
// src/app/ops/padelgenius/editor/_components/TrajectoryStylePicker.tsx
'use client'
import type { TrajectoryStyle } from '@/lib/padelgenius/types'

const STYLES: { value: TrajectoryStyle; label: string }[] = [
  { value: 'flat',         label: 'Flat' },
  { value: 'lob',          label: 'Lob' },
  { value: 'bandeja',      label: 'Bandeja' },
  { value: 'vibora',       label: 'Vibora' },
  { value: 'smash',        label: 'Smash' },
  { value: 'chiquita',     label: 'Chiquita' },
  { value: 'wall-bounce',  label: 'Wall bounce' },
  { value: 'cross',        label: 'Cross' },
]

export function TrajectoryStylePicker({ value, onChange }: { value: TrajectoryStyle; onChange: (v: TrajectoryStyle) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {STYLES.map(s => (
        <button key={s.value} onClick={() => onChange(s.value)} style={{
          background: value === s.value ? '#fde047' : '#1a1a2e',
          color: value === s.value ? '#0a0a14' : '#aaa',
          border: `1px solid ${value === s.value ? '#ca8a04' : '#2a2a3e'}`,
          borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
        }}>{s.label}</button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2:** Commit

```bash
git add src/app/ops/padelgenius/editor/_components/TrajectoryStylePicker.tsx
git commit -m "feat(padelgenius/editor): TrajectoryStylePicker chip-select"
```

---

## Task 8: OptionRow (collapsed list item + expanded mini-editor)

**Files:**
- Create: `src/app/ops/padelgenius/editor/_components/OptionRow.tsx`

- [ ] **Step 1:** Write the component

```tsx
// src/app/ops/padelgenius/editor/_components/OptionRow.tsx
'use client'
import type { QuestionOption, OptionId, PlayerRole } from '@/lib/padelgenius/types'
import { TrajectoryStylePicker } from './TrajectoryStylePicker'

export interface OptionRowProps {
  option: QuestionOption
  expanded: boolean
  selected: boolean      // whether this option is currently the "focused" one for trajectory drag
  onToggleExpanded: () => void
  onSelect: () => void   // makes this option the focused one
  onChange: (next: QuestionOption) => void
  onSetCorrect: () => void
  onDelete: () => void
}

const PLAYER_ROLES: PlayerRole[] = ['you', 'partner', 'opponent1', 'opponent2']

export function OptionRow({ option, expanded, selected, onToggleExpanded, onSelect, onChange, onSetCorrect, onDelete }: OptionRowProps) {
  const update = <K extends keyof QuestionOption>(key: K, val: QuestionOption[K]) => onChange({ ...option, [key]: val })

  return (
    <div style={{
      background: '#1a1a2e',
      border: `2px solid ${option.isCorrect ? '#22c55e' : selected ? '#1e88e5' : '#2a2a3e'}`,
      borderRadius: 8, marginBottom: 6,
    }}>
      <div onClick={onSelect} style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', cursor: 'pointer' }}>
        <span style={{
          width: 24, height: 24, borderRadius: '50%',
          background: option.isCorrect ? '#22c55e' : '#475569',
          color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 900, marginRight: 8,
        }}>{option.id.toUpperCase()}</span>
        <span style={{ flex: 1, color: '#fff', fontSize: 12, fontWeight: 700 }}>{option.label || '(no label)'}</span>
        <span style={{ color: '#94a3b8', fontSize: 10, marginRight: 8 }}>{option.outcome.trajectory.style}</span>
        <button onClick={(e) => { e.stopPropagation(); onSetCorrect() }}
          style={{ background: 'transparent', border: `1px solid ${option.isCorrect ? '#22c55e' : '#475569'}`, color: option.isCorrect ? '#22c55e' : '#94a3b8', borderRadius: 4, padding: '2px 6px', fontSize: 9, fontWeight: 800, cursor: 'pointer' }}
        >{option.isCorrect ? '✓ CORRECT' : 'mark correct'}</button>
        <button onClick={(e) => { e.stopPropagation(); onToggleExpanded() }}
          style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: 14, cursor: 'pointer', marginLeft: 4 }}>{expanded ? '▾' : '▸'}</button>
      </div>
      {expanded && (
        <div style={{ padding: '4px 10px 10px', display: 'grid', gap: 8 }}>
          <Field label="Label">
            <input value={option.label} onChange={e => update('label', e.target.value)}
              style={inputStyle} />
          </Field>
          <Field label="Direction tag (shown in label pill)">
            <input value={option.direction} onChange={e => update('direction', e.target.value)} placeholder="e.g. ↗ Cross-court slice"
              style={inputStyle} />
          </Field>
          <Field label="Trajectory style">
            <TrajectoryStylePicker value={option.outcome.trajectory.style}
              onChange={s => onChange({ ...option, outcome: { ...option.outcome, trajectory: { ...option.outcome.trajectory, style: s } } })} />
          </Field>
          <Field label="Letter position (0–100)">
            <CoordRow x={option.letter.x} y={option.letter.y}
              onChange={(x, y) => onChange({ ...option, letter: { x, y } })} />
          </Field>
          <Field label="Trajectory from (0–100)">
            <CoordRow x={option.outcome.trajectory.from[0]} y={option.outcome.trajectory.from[1]}
              onChange={(x, y) => onChange({ ...option, outcome: { ...option.outcome, trajectory: { ...option.outcome.trajectory, from: [x, y] } } })} />
          </Field>
          <Field label="Trajectory to (ball landing, 0–100)">
            <CoordRow x={option.outcome.trajectory.to[0]} y={option.outcome.trajectory.to[1]}
              onChange={(x, y) => onChange({ ...option, outcome: { ...option.outcome, trajectory: { ...option.outcome.trajectory, to: [x, y] }, ball: { x, y } } })} />
          </Field>
          <Field label="Player overrides (rare — e.g. YOU moves up to take the net)">
            <PlayerOverridesEditor overrides={option.outcome.playerOverrides ?? []}
              onChange={ov => onChange({ ...option, outcome: { ...option.outcome, playerOverrides: ov.length ? ov : undefined } })} />
          </Field>
          <button onClick={onDelete} style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 6, padding: '4px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer', justifySelf: 'flex-start' }}>Delete option</button>
        </div>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = { background: '#0e0e1a', border: '1px solid #2a2a3e', borderRadius: 4, padding: '4px 8px', color: '#fff', fontSize: 12, width: '100%' }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ color: '#94a3b8', fontSize: 9, fontWeight: 700, letterSpacing: 0.5, marginBottom: 3 }}>{label.toUpperCase()}</div>
      {children}
    </div>
  )
}

function CoordRow({ x, y, onChange }: { x: number; y: number; onChange: (x: number, y: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input type="number" min={0} max={100} step={1} value={x.toFixed(0)} onChange={e => onChange(parseFloat(e.target.value) || 0, y)} style={{ ...inputStyle, width: 70 }} />
      <input type="number" min={0} max={100} step={1} value={y.toFixed(0)} onChange={e => onChange(x, parseFloat(e.target.value) || 0)} style={{ ...inputStyle, width: 70 }} />
    </div>
  )
}

function PlayerOverridesEditor({ overrides, onChange }: { overrides: { role: PlayerRole; x: number; y: number }[]; onChange: (ov: { role: PlayerRole; x: number; y: number }[]) => void }) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {PLAYER_ROLES.map(role => {
        const ov = overrides.find(o => o.role === role)
        return (
          <div key={role} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#aaa' }}>
            <label style={{ width: 70, fontFamily: 'ui-monospace,monospace' }}>{role}</label>
            <input type="checkbox" checked={!!ov} onChange={e => {
              if (e.target.checked) onChange([...overrides, { role, x: 50, y: 50 }])
              else onChange(overrides.filter(o => o.role !== role))
            }} />
            {ov && (
              <>
                <input type="number" min={0} max={100} step={1} value={ov.x} onChange={e => onChange(overrides.map(o => o.role === role ? { ...o, x: parseFloat(e.target.value) || 0 } : o))} style={{ ...inputStyle, width: 60 }} />
                <input type="number" min={0} max={100} step={1} value={ov.y} onChange={e => onChange(overrides.map(o => o.role === role ? { ...o, y: parseFloat(e.target.value) || 0 } : o))} style={{ ...inputStyle, width: 60 }} />
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2:** Commit

```bash
git add src/app/ops/padelgenius/editor/_components/OptionRow.tsx
git commit -m "feat(padelgenius/editor): OptionRow with expandable mini-editor"
```

---

## Task 9: QuestionMetaForm

**Files:**
- Create: `src/app/ops/padelgenius/editor/_components/QuestionMetaForm.tsx`

- [ ] **Step 1:** Write the form

```tsx
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
```

- [ ] **Step 2:** Commit

```bash
git add src/app/ops/padelgenius/editor/_components/QuestionMetaForm.tsx
git commit -m "feat(padelgenius/editor): QuestionMetaForm"
```

---

## Task 10: ValidationBanner

**Files:**
- Create: `src/app/ops/padelgenius/editor/_components/ValidationBanner.tsx`

- [ ] **Step 1:** Write the component

```tsx
// src/app/ops/padelgenius/editor/_components/ValidationBanner.tsx
'use client'
import type { ValidationResult } from '@/lib/padelgenius/question-validation'

export function ValidationBanner({ validation }: { validation: ValidationResult }) {
  if (validation.ok && validation.warnings.length === 0) {
    return <div style={{ padding: '6px 10px', background: 'rgba(34,197,94,0.10)', color: '#86efac', fontSize: 11, fontWeight: 700, borderRadius: 6 }}>✓ Valid</div>
  }
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {validation.errors.map((e, i) => (
        <div key={`e${i}`} style={{ padding: '6px 10px', background: 'rgba(239,68,68,0.12)', color: '#fca5a5', fontSize: 11, fontWeight: 600, borderRadius: 6 }}>✕ {e}</div>
      ))}
      {validation.warnings.map((w, i) => (
        <div key={`w${i}`} style={{ padding: '6px 10px', background: 'rgba(253,224,71,0.12)', color: '#fde68a', fontSize: 11, fontWeight: 600, borderRadius: 6 }}>⚠ {w}</div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2:** Commit

```bash
git add src/app/ops/padelgenius/editor/_components/ValidationBanner.tsx
git commit -m "feat(padelgenius/editor): ValidationBanner"
```

---

## Task 11: QuestionList sidebar

**Files:**
- Create: `src/app/ops/padelgenius/editor/_components/QuestionList.tsx`

- [ ] **Step 1:** Write the component

```tsx
// src/app/ops/padelgenius/editor/_components/QuestionList.tsx
'use client'
import { useState } from 'react'
import type { Question } from '@/lib/padelgenius/types'

export interface QuestionListProps {
  questions: Question[]
  currentId: number | null
  onSelect: (id: number) => void
  onCreate: () => void
  onDelete: (id: number) => void
}

export function QuestionList({ questions, currentId, onSelect, onCreate, onDelete }: QuestionListProps) {
  const [filter, setFilter] = useState('')
  const filtered = questions.filter(q => !filter || q.prompt.toLowerCase().includes(filter.toLowerCase()) || String(q.id).includes(filter))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 240, borderRight: '1px solid #2a2a3e', background: '#0e0e1a' }}>
      <div style={{ padding: 10, borderBottom: '1px solid #2a2a3e', display: 'flex', gap: 6 }}>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search…" style={{ flex: 1, background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 4, padding: '4px 8px', color: '#fff', fontSize: 11 }} />
        <button onClick={onCreate} style={{ background: '#22c55e', color: '#0a0a14', border: '1px solid #15803d', borderRadius: 4, padding: '4px 10px', fontSize: 11, fontWeight: 900, cursor: 'pointer' }}>+ NEW</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.map(q => (
          <div key={q.id} onClick={() => onSelect(q.id)}
               style={{
                 padding: '8px 10px', borderBottom: '1px solid #1a1a2e', cursor: 'pointer',
                 background: q.id === currentId ? '#1e293b' : 'transparent',
               }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 9, color: '#fde047', fontWeight: 800, letterSpacing: 0.5 }}>Q{q.id}</span>
              <span style={{ fontSize: 9, color: '#94a3b8', textTransform: 'uppercase' }}>{q.theme} · {q.difficulty}</span>
              <button onClick={(e) => { e.stopPropagation(); if (confirm(`Delete Q${q.id}?`)) onDelete(q.id) }}
                style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 11 }}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 2, lineHeight: 1.3, maxHeight: 30, overflow: 'hidden' }}>{q.prompt}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2:** Commit

```bash
git add src/app/ops/padelgenius/editor/_components/QuestionList.tsx
git commit -m "feat(padelgenius/editor): QuestionList sidebar"
```

---

## Task 12: TestPlayPanel (mounts PlayMode with a single question)

**Files:**
- Create: `src/app/ops/padelgenius/editor/_components/TestPlayPanel.tsx`

- [ ] **Step 1:** Write the component

```tsx
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
      <button onClick={onClose} style={{ position: 'absolute', top: 20, right: 20, background: '#fff', color: '#0a0a14', borderRadius: '50%', width: 36, height: 36, fontSize: 16, fontWeight: 900, border: 'none', cursor: 'pointer' }}>✕</button>
    </div>
  )
}
```

- [ ] **Step 2:** Commit

```bash
git add src/app/ops/padelgenius/editor/_components/TestPlayPanel.tsx
git commit -m "feat(padelgenius/editor): TestPlayPanel mounts PlayMode with draft question"
```

---

## Task 13: Editor top-level component (Editor.tsx)

**Files:**
- Create: `src/app/ops/padelgenius/editor/Editor.tsx`

- [ ] **Step 1:** Write the component

```tsx
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
                  <button onClick={() => setTesting(true)} style={{ background: '#1a1a2e', border: '1px solid #2a2a3e', color: '#fde047', borderRadius: 6, padding: '5px 10px', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}>▶ TEST PLAY</button>
                  <button onClick={save} disabled={busy || !validation?.ok} style={{ background: validation?.ok ? '#22c55e' : '#1a1a2e', border: '1px solid #15803d', color: validation?.ok ? '#0a0a14' : '#475569', borderRadius: 6, padding: '5px 10px', fontSize: 10, fontWeight: 900, cursor: validation?.ok ? 'pointer' : 'not-allowed' }}>{busy ? 'SAVING…' : 'SAVE'}</button>
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
```

- [ ] **Step 2:** Commit

```bash
git add src/app/ops/padelgenius/editor/Editor.tsx
git commit -m "feat(padelgenius/editor): Editor top-level component"
```

---

## Task 14: Editor page (server entry)

**Files:**
- Create: `src/app/ops/padelgenius/editor/page.tsx`

- [ ] **Step 1:** Server entry that loads questions + active court

```tsx
// src/app/ops/padelgenius/editor/page.tsx
import { loadAllQuestions } from '@/lib/padelgenius/question-store'
import { loadActiveCourt } from '@/lib/padelgenius/court-loader'
import { Editor } from './Editor'

export const dynamic = 'force-dynamic'

export default async function EditorPage() {
  const [questions, { config: court }] = await Promise.all([
    loadAllQuestions(),
    loadActiveCourt(),
  ])
  return <Editor initialQuestions={questions} court={court} />
}
```

- [ ] **Step 2:** Verify it loads in the browser

Visit `http://localhost:3000/ops?token=$CRON_SECRET` to set the cookie, then `http://localhost:3000/ops/padelgenius/editor`. Expected: list of questions on the left, first question's form + preview on the right.

- [ ] **Step 3:** Commit

```bash
git add src/app/ops/padelgenius/editor/page.tsx
git commit -m "feat(padelgenius/editor): editor server entry page"
```

---

## Task 15: Manual end-to-end QA

- [ ] Open `/ops/padelgenius/editor` — first question loads. Form fields populate. Court preview shows players + letter handles + (selected option) trajectory endpoints.
- [ ] Click a player handle on the preview and drag — value updates in real time.
- [ ] Expand an option, edit the label → see it propagate to the option-row chip.
- [ ] Pick a different trajectory style → drag the trajectory `to` handle → confirm the dashed preview redraws with the new style.
- [ ] Click "+ NEW" → new question appears with placeholder fields. Edit and save.
- [ ] Try saving an invalid question (e.g. no correct option) → validation banner shows the error; SAVE button disabled.
- [ ] Click ▶ TEST PLAY → modal opens with the actual play screen using this draft question. Tap a letter → confirm → see the reveal. Close modal.
- [ ] Delete a freshly-created question from the list → it disappears.
- [ ] Reload the page → all saved changes persisted in `src/data/genius-questions.json`.
- [ ] Lint + typecheck: `npm run lint && npx tsc --noEmit`.

- [ ] Commit any fixes:

```bash
git add -A
git commit -m "chore(padelgenius/editor): QA fixes for Phase 3"
```

---

## Task 16: Open the PR

```bash
git push -u origin feature/padelgenius-v2-phase-3
gh pr create --title "feat(padelgenius/ops): v2 Phase 3 — question editor" --body "$(cat <<'EOF'
## Summary
- Implements PadelGenius v2 Phase 3 per docs/superpowers/specs/2026-05-13-padelgenius-v2-design.md (§8.3).
- New admin route: `/ops/padelgenius/editor` — two-pane editor with question list, metadata form, draggable court preview, per-option mini-editor, validation banner, Test Play modal.
- New API: `GET/POST /api/ops/padelgenius/questions`, `GET/PATCH/DELETE /api/ops/padelgenius/questions/[id]`.
- Question store (`src/lib/padelgenius/question-store.ts`) reads/writes `src/data/genius-questions.json`.
- Validation module ensures exactly one correct option, coords in 0–100, no overlapping letters, etc.
- Test Play mounts the production `PlayMode` with the draft question inside the active court — same renderer as production.

## Test plan
- [ ] CI lint + typecheck pass
- [ ] CI vitest green (question-validation tests)
- [ ] Manual QA per the plan's Task 15 checklist

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] Share the PR URL.

---

## Self-review summary

- **Spec coverage:** §8.3 (question editor with left list / right form / draggable preview / per-option mini-editor / TrajectoryStyle picker / playerOverrides / TEST PLAY / SAVE) → all addressed across Tasks 5–14. Validation in Task 2. Test Play uses the production PlayMode in a modal.
- **Placeholders:** none. Every route, component, and test has real code.
- **Type consistency:** `Question`, `QuestionOption`, `Outcome`, `OptionId`, `TrajectoryStyle`, `CourtConfig` used as defined in Phase 1 types. Validation result shape (`ValidationResult` with `ok`, `errors`, `warnings`) consistent between question-validation.ts and ValidationBanner consumer.
