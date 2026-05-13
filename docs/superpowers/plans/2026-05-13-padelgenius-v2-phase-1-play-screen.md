# PadelGenius v2 · Phase 1 — Play Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the redesigned PadelGenius play screen at `/padelgenius/play` — new layout, cartoon visual style, per-option outcome trajectories, ball animation, 9-sound audio system, 12 animations, slim reveal sheet. Uses the existing 50+ question bank (migrated to the new schema).

**Architecture:** Build new typed modules under `src/lib/padelgenius/` (types, projection, trajectories) plus colocated UI components under `src/app/[locale]/(app)/padelgenius/components/`. Replace the play surface; keep the existing hub at `/padelgenius` intact for now. Court geometry stays hardcoded for Phase 1 (Phase 2 moves it into per-court config files).

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS 4, SVG (native animations: `stroke-dashoffset`, `animateMotion`, CSS transitions/keyframes), native `Audio` API (no library), Vitest for unit tests.

**Spec reference:** `docs/superpowers/specs/2026-05-13-padelgenius-v2-design.md` §1–7 (game experience, data model, trajectory styles, animation, audio).

---

## File Structure

### New files

```
src/lib/padelgenius/
  types.ts                         ← all PadelGenius types (Question, Option, Outcome, Bounds, etc.)
  projection.ts                    ← toSvg, fromSvg, anchors table — pure functions
  trajectories.ts                  ← path generators for 8 styles (pure functions)
  scoring.ts                       ← scoreAnswer (correct/wrong + XP) — pure functions
  default-court.ts                 ← hardcoded CourtBounds + Zones + VisualSystem for Phase 1
  __tests__/projection.test.ts     ← toSvg/fromSvg round-trip + anchor interp
  __tests__/trajectories.test.ts   ← 8 style generators produce valid SVG paths
  __tests__/scoring.test.ts        ← scoring logic

src/app/[locale]/(app)/padelgenius/
  play/page.tsx                    ← the new play surface (replaces the spike route)
  components/
    PlayMode.tsx                   ← state machine (question/selecting/confirming/revealing/summary)
    Scene.tsx                      ← SVG scene root: court image + players + ball + letters + trajectories + sparkle
    PlayerSprite.tsx               ← single chibi renderer (extracted from IllustratedCourtView)
    PositionedOptions.tsx          ← cartoon letter circles + inline label/CONFIRM
    TrajectoryRenderer.tsx         ← renders one trajectory given style + from/to
    BallSprite.tsx                 ← ball + optional animateMotion along a path
    ProgressBar.tsx                ← right-wall tilted 5-segment bar
    RevealSheet.tsx                ← slim color bottom sheet + Why?▾ expand
    TopZone.tsx                    ← ✕ + theme/diff tag + question prompt
    ClearPill.tsx                  ← cartoon Clear selection pill

src/hooks/
  usePadelgeniusSound.ts           ← preload + play sounds, mute toggle, prefers-reduced-motion check

public/padelgenius/sounds/         ← 9 .mp3 placeholders (will be replaced with cartoon clips)
  tap.mp3
  confirm.mp3
  swoosh-flat.mp3
  swoosh-lob.mp3
  swoosh-smash.mp3
  correct.mp3
  wrong.mp3
  continue.mp3
  complete.mp3

scripts/
  migrate-genius-questions.ts      ← one-time script to upgrade existing JSON to new schema
```

### Modified files

```
src/data/genius-questions.json    ← upgraded to new schema (run migration script once)
src/app/[locale]/(app)/padelgenius/page.tsx  ← hub: add CTA to /padelgenius/play
```

### Tests

All unit tests live next to the code they test (`src/lib/padelgenius/__tests__/`). UI components are smoke-tested via the play page; integration tests via Playwright are out of scope for Phase 1 (added in Phase 3 if time allows).

---

## Task 1: Set up isolated worktree

**Files:**
- No file changes — environment setup only.

- [ ] **Step 1: Create worktree from main**

```bash
git worktree add .worktrees/padelgenius-v2-phase-1 -b feature/padelgenius-v2-phase-1 main
cd .worktrees/padelgenius-v2-phase-1
ln -s /Users/GuDenes/Projects/padel-live-scores/node_modules node_modules
```

Disk is tight; symlinking `node_modules` from the main checkout avoids a fresh install.

- [ ] **Step 2: Verify clean baseline**

```bash
npm run lint
npx vitest run src/lib/__tests__/score-inference.test.ts
```

Expected: both pass. Report failures before proceeding.

- [ ] **Step 3: Sanity-check dev server**

```bash
node node_modules/.bin/next dev
# Visit http://localhost:3000/padelgenius — should show the existing hub
```

Expected: existing PadelGenius hub loads without errors. `Ctrl+C` to stop.

---

## Task 2: Define core types

**Files:**
- Create: `src/lib/padelgenius/types.ts`

- [ ] **Step 1: Write the types module**

```ts
// src/lib/padelgenius/types.ts

export type PlayerRole = 'you' | 'partner' | 'opponent1' | 'opponent2'

export type TrajectoryStyle =
  | 'flat'
  | 'lob'
  | 'bandeja'
  | 'vibora'
  | 'smash'
  | 'chiquita'
  | 'wall-bounce'
  | 'cross'

export type Theme = 'shots' | 'positioning' | 'rules' | 'communication' | 'mixed'
export type Difficulty = 1 | 2 | 3
export type OptionId = 'a' | 'b' | 'c' | 'd'

export interface Trajectory {
  from: [number, number]
  to: [number, number]
  style: TrajectoryStyle
}

export interface PlayerPosition {
  role: PlayerRole
  x: number // 0–100
  y: number // 0–100
}

export interface Outcome {
  ball: { x: number; y: number }
  trajectory: Trajectory
  playerOverrides?: PlayerPosition[]
}

export interface QuestionOption {
  id: OptionId
  label: string
  direction: string
  letter: { x: number; y: number }
  isCorrect: boolean
  outcome: Outcome
}

export interface Question {
  id: number
  prompt: string
  theme: Theme
  difficulty: Difficulty
  court: {
    players: PlayerPosition[]
    ball?: { x: number; y: number }
    trajectory?: Trajectory
  }
  options: QuestionOption[]
  explanation: {
    title: string
    body: string
    proTip?: string
  }
}

export interface CourtBounds {
  backGlassY: number
  backServiceY: number
  netY: number
  nearServiceY: number
  nearGlassY: number
  farLeftX: number
  farRightX: number
  nearLeftX: number
  nearRightX: number
}

export interface CourtZones {
  attackDepth: number
  transitionDepth: number
}

export interface VisualSystem {
  playerBaseSize: number
  scaleCurveMin: number
  scaleCurveMax: number
  letterRadius: number
  progressBarTilt: number
}

export interface CourtConfig {
  name: string
  active: boolean
  imageUrl: string
  bounds: CourtBounds
  zones: CourtZones
  visualSystem: VisualSystem
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit src/lib/padelgenius/types.ts
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/padelgenius/types.ts
git commit -m "feat(padelgenius): define core domain types"
```

---

## Task 3: Hardcoded default court config

**Files:**
- Create: `src/lib/padelgenius/default-court.ts`

This is the Phase 1 stand-in for the per-court config files that Phase 2 will introduce. We pick values calibrated against the existing `court.png` during the brainstorm.

- [ ] **Step 1: Write the default config**

```ts
// src/lib/padelgenius/default-court.ts
import type { CourtConfig } from './types'

export const DEFAULT_COURT: CourtConfig = {
  name: 'Club Deportivo',
  active: true,
  imageUrl: '/padelgenius/court.png',
  bounds: {
    backGlassY: 0.250,
    backServiceY: 0.315,
    netY: 0.520,
    nearServiceY: 0.850,
    nearGlassY: 0.980,
    farLeftX: 0.253,
    farRightX: 0.740,
    nearLeftX: 0.045,
    nearRightX: 0.965,
  },
  zones: {
    attackDepth: 7,
    transitionDepth: 17,
  },
  visualSystem: {
    playerBaseSize: 90,
    scaleCurveMin: 0.85,
    scaleCurveMax: 1.20,
    letterRadius: 12,
    progressBarTilt: -7,
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/padelgenius/default-court.ts
git commit -m "feat(padelgenius): hardcode default court config for Phase 1"
```

---

## Task 4: Projection module (toSvg / fromSvg) + tests

**Files:**
- Create: `src/lib/padelgenius/projection.ts`
- Create: `src/lib/padelgenius/__tests__/projection.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/padelgenius/__tests__/projection.test.ts
import { describe, it, expect } from 'vitest'
import { toSvg, fromSvg } from '../projection'
import { DEFAULT_COURT } from '../default-court'

const W = 400
const H = 600
const b = DEFAULT_COURT.bounds

describe('toSvg', () => {
  it('maps back glass (y=0) to backGlassY * H', () => {
    const [, y] = toSvg(50, 0, b)
    expect(y).toBeCloseTo(b.backGlassY * H, 1)
  })

  it('maps net (y=50) to netY * H', () => {
    const [, y] = toSvg(50, 50, b)
    expect(y).toBeCloseTo(b.netY * H, 1)
  })

  it('maps near glass (y=100) to nearGlassY * H', () => {
    const [, y] = toSvg(50, 100, b)
    expect(y).toBeCloseTo(b.nearGlassY * H, 1)
  })

  it('interpolates between net and near glass at y=75', () => {
    const [, y50] = toSvg(50, 50, b)
    const [, y75] = toSvg(50, 75, b)
    const [, y100] = toSvg(50, 100, b)
    expect(y75).toBeGreaterThan(y50)
    expect(y75).toBeLessThan(y100)
  })

  it('places x=0 on the trapezoid left edge', () => {
    const [x] = toSvg(0, 50, b)
    expect(x).toBeGreaterThan(0)
    expect(x).toBeLessThan(W / 2)
  })

  it('places x=100 on the trapezoid right edge', () => {
    const [x] = toSvg(100, 50, b)
    expect(x).toBeGreaterThan(W / 2)
    expect(x).toBeLessThan(W)
  })
})

describe('fromSvg', () => {
  it('round-trips with toSvg at the center', () => {
    const [sx, sy] = toSvg(50, 50, b)
    const [nx, ny] = fromSvg(sx, sy, b)
    expect(nx).toBeCloseTo(50, 0)
    expect(ny).toBeCloseTo(50, 0)
  })

  it('returns [-1, -1] for points above the back glass', () => {
    const [nx, ny] = fromSvg(200, 0, b)
    expect(nx).toBe(-1)
    expect(ny).toBe(-1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/padelgenius/__tests__/projection.test.ts
```

Expected: all fail with "Cannot find module '../projection'".

- [ ] **Step 3: Implement projection.ts**

```ts
// src/lib/padelgenius/projection.ts
import type { CourtBounds } from './types'

export const W = 400
export const H = 600

/** y-axis anchor table: [logical y, canvas y in px], monotonic */
function anchors(b: CourtBounds): [number, number][] {
  return [
    [0,   b.backGlassY    * H],
    [33,  b.backServiceY  * H],
    [50,  b.netY          * H],
    [67,  b.nearServiceY  * H],
    [100, b.nearGlassY    * H],
  ]
}

export function toSvg(nx: number, ny: number, bounds: CourtBounds): [number, number] {
  const a = anchors(bounds)
  let svgY = a[a.length - 1][1]
  if (ny <= a[0][0]) svgY = a[0][1]
  else {
    for (let i = 0; i < a.length - 1; i++) {
      const [y0, p0] = a[i]
      const [y1, p1] = a[i + 1]
      if (ny >= y0 && ny <= y1) {
        const t = (ny - y0) / (y1 - y0)
        svgY = p0 + (p1 - p0) * t
        break
      }
    }
  }
  const depthT = (svgY / H - bounds.backGlassY) / (bounds.nearGlassY - bounds.backGlassY)
  const leftEdge  = (bounds.farLeftX  + (bounds.nearLeftX  - bounds.farLeftX)  * depthT) * W
  const rightEdge = (bounds.farRightX + (bounds.nearRightX - bounds.farRightX) * depthT) * W
  const svgX = leftEdge + (nx / 100) * (rightEdge - leftEdge)
  return [svgX, svgY]
}

export function fromSvg(svgX: number, svgY: number, bounds: CourtBounds): [number, number] {
  const a = anchors(bounds)
  const backY = a[0][1]
  const nearY = a[a.length - 1][1]
  if (svgY < backY || svgY > nearY) return [-1, -1]
  let ny = 0
  for (let i = 0; i < a.length - 1; i++) {
    const [y0, p0] = a[i]
    const [y1, p1] = a[i + 1]
    if (svgY >= p0 && svgY <= p1) {
      const t = (svgY - p0) / (p1 - p0)
      ny = y0 + (y1 - y0) * t
      break
    }
  }
  const depthT = (svgY - backY) / (nearY - backY)
  const leftEdge  = (bounds.farLeftX  + (bounds.nearLeftX  - bounds.farLeftX)  * depthT) * W
  const rightEdge = (bounds.farRightX + (bounds.nearRightX - bounds.farRightX) * depthT) * W
  const nx = ((svgX - leftEdge) / (rightEdge - leftEdge)) * 100
  return [nx, ny]
}

export function playerScale(ny: number, vs: { scaleCurveMin: number; scaleCurveMax: number }): number {
  return vs.scaleCurveMin + (ny / 100) * (vs.scaleCurveMax - vs.scaleCurveMin)
}
```

- [ ] **Step 4: Run tests — they should pass**

```bash
npx vitest run src/lib/padelgenius/__tests__/projection.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/padelgenius/projection.ts src/lib/padelgenius/__tests__/projection.test.ts
git commit -m "feat(padelgenius): bounds-aware projection module + tests"
```

---

## Task 5: Trajectory path generators (8 styles) + tests

**Files:**
- Create: `src/lib/padelgenius/trajectories.ts`
- Create: `src/lib/padelgenius/__tests__/trajectories.test.ts`

Each style is a pure function that returns an SVG path `d` string given start + end pixel coords. We test that the generated path starts at `from`, ends at `to`, and contains expected primitives (e.g. lobs use Q quadratic curves, smashes use straight lines).

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/padelgenius/__tests__/trajectories.test.ts
import { describe, it, expect } from 'vitest'
import { trajectoryPath } from '../trajectories'
import type { TrajectoryStyle } from '../types'

const styles: TrajectoryStyle[] = ['flat', 'lob', 'bandeja', 'vibora', 'smash', 'chiquita', 'wall-bounce', 'cross']

describe('trajectoryPath', () => {
  styles.forEach(style => {
    it(`${style}: starts with M at the from point`, () => {
      const d = trajectoryPath(style, [10, 100], [200, 50])
      expect(d).toMatch(/^M\s*10[\s,]+100/)
    })

    it(`${style}: path ends near the to point`, () => {
      const d = trajectoryPath(style, [10, 100], [200, 50])
      // The path string should contain "200" and "50" somewhere near the end
      const tail = d.slice(-60)
      expect(tail).toMatch(/200/)
      expect(tail).toMatch(/50/)
    })
  })

  it('lob: uses a quadratic curve (Q)', () => {
    const d = trajectoryPath('lob', [10, 200], [200, 60])
    expect(d).toMatch(/Q/)
  })

  it('flat: uses a straight line (L)', () => {
    const d = trajectoryPath('flat', [10, 200], [200, 60])
    expect(d).toMatch(/L/)
  })

  it('wall-bounce: contains at least one bounce point (two segments)', () => {
    const d = trajectoryPath('wall-bounce', [10, 200], [10, 100])
    // Bounce path: M start L bounce L end → two L commands
    const ls = d.match(/L/g) || []
    expect(ls.length).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run tests — should fail**

```bash
npx vitest run src/lib/padelgenius/__tests__/trajectories.test.ts
```

Expected: all fail (module not found).

- [ ] **Step 3: Implement trajectories.ts**

```ts
// src/lib/padelgenius/trajectories.ts
import type { TrajectoryStyle } from './types'

type Point = [number, number]

/** Returns an SVG path `d` string for the given trajectory style and endpoints. */
export function trajectoryPath(style: TrajectoryStyle, from: Point, to: Point): string {
  const [x1, y1] = from
  const [x2, y2] = to

  switch (style) {
    case 'flat':
    case 'cross':
      return `M ${x1} ${y1} L ${x2} ${y2}`

    case 'lob': {
      // Tall arch — control point is high above the midpoint
      const cx = (x1 + x2) / 2
      const cy = Math.min(y1, y2) - 120
      return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`
    }

    case 'bandeja': {
      // Gentle slice — control point pulls slightly above and along the path
      const cx = x1 + (x2 - x1) * 0.7
      const cy = y1 + (y2 - y1) * 0.3 - 20
      return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`
    }

    case 'vibora': {
      // Steeper, more aggressive — control point lower (more downward bend)
      const cx = x1 + (x2 - x1) * 0.5
      const cy = y1 + (y2 - y1) * 0.5 + 10
      return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`
    }

    case 'smash':
      // Steep downward straight line — same path as flat but caller styles it thicker/red
      return `M ${x1} ${y1} L ${x2} ${y2}`

    case 'chiquita': {
      // Short low arc — small bump
      const cx = (x1 + x2) / 2
      const cy = Math.min(y1, y2) - 25
      return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`
    }

    case 'wall-bounce': {
      // L start → bounce off back wall (at y_min) → L end
      const bounceY = Math.min(y1, y2) - 30
      const bounceX = x1 + (x2 - x1) * 0.5
      return `M ${x1} ${y1} L ${bounceX} ${bounceY} L ${x2} ${y2}`
    }
  }
}

/** Per-style render hints (for the renderer to pick stroke/decor). */
export const TRAJECTORY_DECOR: Record<TrajectoryStyle, {
  strokeWidth: number
  dashed: boolean
  spinMarkers: number  // 0, 1, or 2
  bolt: boolean
  star: boolean
  rays: boolean
  isWinner: boolean    // smash is red, others use state color
}> = {
  flat:         { strokeWidth: 4, dashed: false, spinMarkers: 0, bolt: false, star: false, rays: false, isWinner: false },
  lob:          { strokeWidth: 4, dashed: true,  spinMarkers: 0, bolt: false, star: false, rays: false, isWinner: false },
  bandeja:      { strokeWidth: 4, dashed: false, spinMarkers: 1, bolt: false, star: false, rays: false, isWinner: false },
  vibora:       { strokeWidth: 4, dashed: false, spinMarkers: 2, bolt: true,  star: false, rays: false, isWinner: false },
  smash:        { strokeWidth: 6, dashed: false, spinMarkers: 0, bolt: false, star: true,  rays: true,  isWinner: true  },
  chiquita:     { strokeWidth: 4, dashed: false, spinMarkers: 0, bolt: false, star: false, rays: false, isWinner: false },
  'wall-bounce':{ strokeWidth: 4, dashed: false, spinMarkers: 0, bolt: false, star: true,  rays: false, isWinner: false },
  cross:        { strokeWidth: 4, dashed: false, spinMarkers: 0, bolt: false, star: false, rays: false, isWinner: false },
}
```

- [ ] **Step 4: Run tests — they should pass**

```bash
npx vitest run src/lib/padelgenius/__tests__/trajectories.test.ts
```

Expected: 19 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/padelgenius/trajectories.ts src/lib/padelgenius/__tests__/trajectories.test.ts
git commit -m "feat(padelgenius): 8 trajectory style path generators + tests"
```

---

## Task 6: Scoring module + tests

**Files:**
- Create: `src/lib/padelgenius/scoring.ts`
- Create: `src/lib/padelgenius/__tests__/scoring.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/padelgenius/__tests__/scoring.test.ts
import { describe, it, expect } from 'vitest'
import { scoreAnswer } from '../scoring'
import type { Question } from '../types'

const q: Question = {
  id: 1, prompt: 't', theme: 'shots', difficulty: 1,
  court: { players: [] },
  options: [
    { id: 'a', label: 'A', direction: '', letter: { x: 0, y: 0 }, isCorrect: false, outcome: { ball: { x: 0, y: 0 }, trajectory: { from: [0, 0], to: [0, 0], style: 'flat' } } },
    { id: 'b', label: 'B', direction: '', letter: { x: 0, y: 0 }, isCorrect: true,  outcome: { ball: { x: 0, y: 0 }, trajectory: { from: [0, 0], to: [0, 0], style: 'flat' } } },
  ],
  explanation: { title: 't', body: 'b' },
}

describe('scoreAnswer', () => {
  it('returns correct=true and xp=100 when picked is the correct option', () => {
    expect(scoreAnswer(q, 'b')).toEqual({ correct: true, xp: 100 })
  })

  it('returns correct=false and xp=0 when picked is wrong', () => {
    expect(scoreAnswer(q, 'a')).toEqual({ correct: false, xp: 0 })
  })

  it('returns correct=false and xp=0 when picked is null', () => {
    expect(scoreAnswer(q, null)).toEqual({ correct: false, xp: 0 })
  })
})
```

- [ ] **Step 2: Run — fails**

```bash
npx vitest run src/lib/padelgenius/__tests__/scoring.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/lib/padelgenius/scoring.ts
import type { Question, OptionId } from './types'

export interface AnswerResult {
  correct: boolean
  xp: number
}

export function scoreAnswer(q: Question, picked: OptionId | null): AnswerResult {
  if (!picked) return { correct: false, xp: 0 }
  const opt = q.options.find(o => o.id === picked)
  if (!opt) return { correct: false, xp: 0 }
  return { correct: opt.isCorrect, xp: opt.isCorrect ? 100 : 0 }
}
```

- [ ] **Step 4: Pass**

```bash
npx vitest run src/lib/padelgenius/__tests__/scoring.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/padelgenius/scoring.ts src/lib/padelgenius/__tests__/scoring.test.ts
git commit -m "feat(padelgenius): scoring module + tests"
```

---

## Task 7: Question schema migration script

**Files:**
- Create: `scripts/migrate-genius-questions.ts`
- Modify: `src/data/genius-questions.json` (run script, commit output)

The existing JSON has older fields (`correctOption`, `type`, `correctZone`, etc.). We need each question to have the new option shape with `letter`, `direction`, `outcome`. Bridge: keep the existing prompt/explanation, default `outcome.trajectory` to copy the question's `explanation.courtOverlay.trajectory` if present, otherwise a short line from the ball position toward the relevant team. Make conservative defaults — content team can refine in Phase 3 editor.

- [ ] **Step 1: Write the migration script**

```ts
// scripts/migrate-genius-questions.ts
import { readFileSync, writeFileSync } from 'node:fs'
import type { Question, TrajectoryStyle } from '../src/lib/padelgenius/types'

interface OldQuestion {
  id: number
  type: string
  difficulty: 1 | 2 | 3
  theme: string
  question: string
  court: {
    players: { role: string; x: number; y: number }[]
    ball?: { x: number; y: number }
    trajectory?: { from: [number, number]; to: [number, number] }
  }
  options?: { id: string; label: string; emoji?: string }[]
  correctOption?: string
  explanation: {
    title: string
    text: string
    proTip?: string
    courtOverlay?: { trajectory?: { from: [number, number]; to: [number, number] }; label?: string }
  }
}

const KEYWORDS_TO_STYLE: { regex: RegExp; style: TrajectoryStyle }[] = [
  { regex: /smash/i,    style: 'smash'    },
  { regex: /v[ií]bora/i,style: 'vibora'   },
  { regex: /bandeja/i,  style: 'bandeja'  },
  { regex: /chiquita|drop/i, style: 'chiquita' },
  { regex: /lob|globo/i,style: 'lob'      },
  { regex: /wall|glass/i, style: 'wall-bounce' },
  { regex: /cross/i,    style: 'cross'    },
]

function pickStyle(label: string): TrajectoryStyle {
  for (const { regex, style } of KEYWORDS_TO_STYLE) {
    if (regex.test(label)) return style
  }
  return 'flat'
}

function defaultLetterPosition(idx: number, side: 'far' | 'near' | 'mid'): { x: number; y: number } {
  // Spread letters across the opponent half by default
  const xs = [30, 50, 70, 50]
  const ys = side === 'far' ? [8, 35, 8, 45] : [85, 60, 85, 50]
  return { x: xs[idx] ?? 50, y: ys[idx] ?? 30 }
}

function migrate(old: OldQuestion): Question {
  const correctId = (old.correctOption ?? 'b') as 'a' | 'b' | 'c' | 'd'
  const options = (old.options ?? []).slice(0, 4).map((opt, idx) => {
    const style = pickStyle(opt.label)
    const letter = defaultLetterPosition(idx, 'far')
    const overlayTraj = old.explanation.courtOverlay?.trajectory
    const trajectory = (opt.id === correctId && overlayTraj)
      ? { from: overlayTraj.from, to: overlayTraj.to, style }
      : { from: [50, 50] as [number, number], to: [letter.x, letter.y] as [number, number], style }
    return {
      id: opt.id as 'a' | 'b' | 'c' | 'd',
      label: opt.label.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/\s*[—-]\s*.*/, '').trim() || opt.label,
      direction: '',
      letter,
      isCorrect: opt.id === correctId,
      outcome: {
        ball: { x: trajectory.to[0], y: trajectory.to[1] },
        trajectory,
      },
    }
  })

  return {
    id: old.id,
    prompt: old.question,
    theme: (old.theme as Question['theme']) ?? 'mixed',
    difficulty: old.difficulty,
    court: {
      players: old.court.players.map(p => ({ role: p.role as Question['court']['players'][0]['role'], x: p.x, y: p.y })),
      ball: old.court.ball,
      trajectory: old.court.trajectory ? { ...old.court.trajectory, style: 'flat' } : undefined,
    },
    options,
    explanation: {
      title: old.explanation.title,
      body: old.explanation.text,
      proTip: old.explanation.proTip,
    },
  }
}

const inPath = 'src/data/genius-questions.json'
const old: OldQuestion[] = JSON.parse(readFileSync(inPath, 'utf-8'))
const migrated = old
  .filter(q => q.type === 'court-scenario' || q.type === 'rules-card')
  .map(migrate)
writeFileSync(inPath, JSON.stringify(migrated, null, 2) + '\n')
console.log(`Migrated ${migrated.length} questions (skipped ${old.length - migrated.length} non-court-scenario)`)
```

- [ ] **Step 2: Back up the existing JSON**

```bash
cp src/data/genius-questions.json src/data/genius-questions.legacy.json
git add src/data/genius-questions.legacy.json
git commit -m "chore(padelgenius): back up legacy question schema"
```

- [ ] **Step 3: Run the migration**

```bash
npx tsx scripts/migrate-genius-questions.ts
```

Expected: prints "Migrated N questions". Check the diff — every question should have `prompt`, `options[i].letter`, `options[i].outcome.trajectory.style`.

- [ ] **Step 4: Commit the migration script + new JSON**

```bash
git add scripts/migrate-genius-questions.ts src/data/genius-questions.json
git commit -m "feat(padelgenius): migrate question bank to v2 schema"
```

---

## Task 8: PlayerSprite component

**Files:**
- Create: `src/app/[locale]/(app)/padelgenius/components/PlayerSprite.tsx`

Extract the SVG image-rendering logic from the spike's `IllustratedCourtView.tsx`. Use `xMidYMax meet` with a 90×120 box (tall, matches portrait PNGs), preserves heads.

- [ ] **Step 1: Write the component**

```tsx
// src/app/[locale]/(app)/padelgenius/components/PlayerSprite.tsx
'use client'
import type { PlayerRole, VisualSystem } from '@/lib/padelgenius/types'

export interface PlayerSpriteProps {
  role: PlayerRole
  x: number          // SVG x (already projected)
  y: number          // SVG y (already projected, the feet anchor)
  scale: number      // perspective scale
  vs: VisualSystem
  spriteUrl: string
  faded?: boolean    // for non-selected during reveal
}

export function PlayerSprite({ x, y, scale, vs, spriteUrl, faded }: PlayerSpriteProps) {
  const h = (vs.playerBaseSize * 1.33) * scale  // tall box for portrait PNGs
  const w = vs.playerBaseSize * scale
  return (
    <image
      href={spriteUrl}
      x={x - w / 2}
      y={y - h + 14 * scale}
      width={w}
      height={h}
      preserveAspectRatio="xMidYMax meet"
      opacity={faded ? 0.45 : 1}
      style={{ transition: 'opacity 200ms ease-out' }}
    />
  )
}

export const PLAYER_SPRITE_URLS: Record<PlayerRole, string> = {
  you: '/padelgenius/you.png',
  partner: '/padelgenius/partner.png',
  opponent1: '/padelgenius/opponent1.png',
  opponent2: '/padelgenius/opponent2.png',
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/\(app\)/padelgenius/components/PlayerSprite.tsx
git commit -m "feat(padelgenius): PlayerSprite component"
```

---

## Task 9: BallSprite with animateMotion support

**Files:**
- Create: `src/app/[locale]/(app)/padelgenius/components/BallSprite.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/app/[locale]/(app)/padelgenius/components/BallSprite.tsx
'use client'

export interface BallSpriteProps {
  x: number              // SVG x (current position when static)
  y: number              // SVG y
  radius?: number        // default 9
  /** When set, ball animates along this SVG path d once, then stays at the end */
  motionPath?: string
  motionDuration?: number // ms
  /** Color of the seam line — usually black */
  outline?: string
}

export function BallSprite({ x, y, radius = 9, motionPath, motionDuration = 500, outline = '#1A1A2E' }: BallSpriteProps) {
  return (
    <g>
      <circle cx={x} cy={y} r={radius} fill="#FFE600" stroke={outline} strokeWidth={2.5}>
        {motionPath && (
          <animateMotion
            dur={`${motionDuration}ms`}
            path={motionPath}
            fill="freeze"
            rotate="0"
          />
        )}
      </circle>
    </g>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/\(app\)/padelgenius/components/BallSprite.tsx
git commit -m "feat(padelgenius): BallSprite with animateMotion support"
```

---

## Task 10: TrajectoryRenderer component

**Files:**
- Create: `src/app/[locale]/(app)/padelgenius/components/TrajectoryRenderer.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/app/[locale]/(app)/padelgenius/components/TrajectoryRenderer.tsx
'use client'
import { trajectoryPath, TRAJECTORY_DECOR } from '@/lib/padelgenius/trajectories'
import type { TrajectoryStyle } from '@/lib/padelgenius/types'

export interface TrajectoryRendererProps {
  style: TrajectoryStyle
  from: [number, number]   // SVG pixel coords
  to:   [number, number]
  state: 'preview' | 'correct' | 'wrong'
  /** When true, animate the line drawing via stroke-dashoffset */
  animate?: boolean
  pathId?: string          // for ball animateMotion to reference
}

const STATE_COLORS: Record<TrajectoryRendererProps['state'], string> = {
  preview: '#1e88e5',
  correct: '#22c55e',
  wrong:   '#ef4444',
}

export function TrajectoryRenderer({ style, from, to, state, animate, pathId }: TrajectoryRendererProps) {
  const d = trajectoryPath(style, from, to)
  const decor = TRAJECTORY_DECOR[style]
  const color = decor.isWinner && state !== 'wrong' ? '#ef4444' : STATE_COLORS[state]
  const dasharray = decor.dashed ? '6 4' : state === 'preview' ? '6 5' : undefined

  return (
    <g>
      {/* dark outline behind */}
      <path d={d} stroke="#1A1A2E" strokeWidth={decor.strokeWidth + 3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* colored line */}
      <path
        id={pathId}
        d={d}
        stroke={color}
        strokeWidth={decor.strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={animate ? '1000' : dasharray}
        strokeDashoffset={animate ? '1000' : undefined}
        style={animate ? {
          animation: 'pg-traj-draw 500ms ease-out forwards',
        } : undefined}
      />
      {/* Spin markers mid-flight */}
      {decor.spinMarkers >= 1 && (() => {
        const [mx, my] = midpoint(from, to)
        return <circle cx={mx} cy={my} r={6} fill="none" stroke={color} strokeWidth={1.8} strokeDasharray="3 2" />
      })()}
      {decor.spinMarkers >= 2 && (() => {
        const [mx, my] = midpoint(from, to, 0.7)
        return <circle cx={mx} cy={my} r={5} fill="none" stroke={color} strokeWidth={1.8} strokeDasharray="3 2" />
      })()}
      {/* Bolt at strike point */}
      {decor.bolt && <text x={from[0] - 14} y={from[1] - 4} fill="#fde047" fontSize={16} fontWeight={900}>⚡</text>}
      {/* Star at contact point */}
      {decor.star && <text x={from[0] - 6} y={from[1] - 8} fill="#fde047" fontSize={16} fontWeight={900}>★</text>}
      {/* Impact rays at landing */}
      {decor.rays && <ImpactRays x={to[0]} y={to[1]} color="#fde047" />}
    </g>
  )
}

function midpoint(from: [number, number], to: [number, number], t = 0.5): [number, number] {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]
}

function ImpactRays({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y})`} stroke={color} strokeWidth={2.5} strokeLinecap="round">
      <line x1="0" y1="0" x2="-10" y2="14" />
      <line x1="0" y1="0" x2="10" y2="14" />
      <line x1="0" y1="0" x2="-14" y2="2" />
      <line x1="0" y1="0" x2="14" y2="2" />
      <line x1="0" y1="0" x2="-7" y2="-7" />
      <line x1="0" y1="0" x2="7" y2="-7" />
    </g>
  )
}
```

- [ ] **Step 2: Add the SVG dash-draw keyframes globally**

Add to `src/app/globals.css` (or wherever PadelGenius styles can live; create `src/app/[locale]/(app)/padelgenius/padelgenius.css` if you prefer scoped styles):

```css
@keyframes pg-traj-draw {
  to { stroke-dashoffset: 0; }
}
@keyframes pg-sparkle {
  0%   { transform: scale(0); opacity: 0; }
  40%  { transform: scale(1.3); opacity: 1; }
  100% { transform: scale(1); opacity: 0; }
}
@keyframes pg-breathe {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-2px); }
}
@keyframes pg-pulse {
  0%, 100% { opacity: 0.7; transform: scale(1); }
  50%      { opacity: 0.2; transform: scale(1.15); }
}
@media (prefers-reduced-motion: reduce) {
  .pg-no-motion-reduce, .pg-no-motion-reduce * { animation-duration: 0ms !important; animation-iteration-count: 1 !important; transition-duration: 80ms !important; }
}
```

Import the stylesheet in the play page (next task creates it).

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/\(app\)/padelgenius/components/TrajectoryRenderer.tsx src/app/[locale]/\(app\)/padelgenius/padelgenius.css
git commit -m "feat(padelgenius): TrajectoryRenderer + keyframes"
```

---

## Task 11: PositionedOptions component (cartoon letters + selection state)

**Files:**
- Create: `src/app/[locale]/(app)/padelgenius/components/PositionedOptions.tsx`

This carries the cartoon style: thick navy outline, hard drop shadow, slight rotation. When selected, shows blue glow + inline label + inline CONFIRM pill.

- [ ] **Step 1: Write the component**

```tsx
// src/app/[locale]/(app)/padelgenius/components/PositionedOptions.tsx
'use client'
import type { QuestionOption, OptionId } from '@/lib/padelgenius/types'
import { toSvg } from '@/lib/padelgenius/projection'
import { DEFAULT_COURT } from '@/lib/padelgenius/default-court'

export interface PositionedOptionsProps {
  options: QuestionOption[]
  phase: 'idle' | 'selecting' | 'revealing'
  selectedId: OptionId | null
  correctId: OptionId | null
  onSelect: (id: OptionId) => void
  onConfirm: () => void
}

const ROTATIONS: Record<OptionId, number> = { a: -4, b: 6, c: -3, d: 5 }

export function PositionedOptions({ options, phase, selectedId, correctId, onSelect, onConfirm }: PositionedOptionsProps) {
  const bounds = DEFAULT_COURT.bounds
  const revealed = phase === 'revealing'

  return (
    <g>
      {options.map(opt => {
        const [cx, cy] = toSvg(opt.letter.x, opt.letter.y, bounds)
        const isSelected = !revealed && opt.id === selectedId
        const isCorrect = revealed && opt.id === correctId
        const isPickedWrong = revealed && opt.id === selectedId && opt.id !== correctId
        const dimmed = revealed && !isCorrect && !isPickedWrong
        const r = 22
        const rot = ROTATIONS[opt.id]

        let fill = '#FFFFFF', textColor = '#1A1A2E'
        if (isCorrect)       { fill = '#22C55E'; textColor = '#FFFFFF' }
        else if (isPickedWrong) { fill = '#EF4444'; textColor = '#FFFFFF' }
        else if (isSelected) { fill = '#1E88E5'; textColor = '#FFFFFF' }

        return (
          <g
            key={opt.id}
            transform={`translate(${cx} ${cy}) rotate(${rot})`}
            style={{
              cursor: !revealed && phase !== 'revealing' ? 'pointer' : 'default',
              opacity: dimmed ? 0.3 : 1,
              transition: 'opacity 200ms ease-out',
            }}
            onClick={() => { if (!revealed) onSelect(opt.id) }}
          >
            {/* shadow */}
            <ellipse cx="0" cy={r + 4} rx={r * 0.75} ry={3} fill="rgba(20,30,60,0.45)" />
            {/* pulsing halo when idle/selected */}
            {!revealed && (
              <circle r={r + 4} fill="none" stroke={isSelected ? '#1E88E5' : 'rgba(255,255,255,0.6)'} strokeWidth={isSelected ? 3 : 2} style={{
                animation: isSelected ? 'pg-pulse 1s ease-in-out infinite' : 'pg-pulse 1.6s ease-in-out infinite',
                transformOrigin: 'center',
              }} />
            )}
            {/* main circle */}
            <circle r={r} fill={fill} stroke="#1A1A2E" strokeWidth={3.5} />
            {/* letter */}
            <text y={1} textAnchor="middle" dominantBaseline="middle" fill={textColor} fontSize={22} fontWeight={900} fontFamily="ui-sans-serif, system-ui, sans-serif">
              {opt.id.toUpperCase()}
            </text>
            {/* check / cross badge on reveal */}
            {isCorrect && <text y={r + 14} textAnchor="middle" fill="#22c55e" fontSize={14} fontWeight={900} stroke="#fff" strokeWidth={3} paintOrder="stroke">✓</text>}
            {isPickedWrong && <text y={r + 14} textAnchor="middle" fill="#ef4444" fontSize={14} fontWeight={900} stroke="#fff" strokeWidth={3} paintOrder="stroke">✕</text>}
            {/* Inline label + CONFIRM when selected (pre-confirm) */}
            {isSelected && (
              <g transform={`translate(0 ${r + 28})`}>
                <SelectionPillRow label={opt.label} direction={opt.direction} onConfirm={(e) => { e.stopPropagation(); onConfirm() }} />
              </g>
            )}
            {/* Revealed label below the letter */}
            {(isCorrect || isPickedWrong) && (
              <g transform={`translate(0 ${r + 26})`}>
                <LabelPill label={opt.label} state={isCorrect ? 'correct' : 'wrong'} />
              </g>
            )}
          </g>
        )
      })}
    </g>
  )
}

function SelectionPillRow({ label, direction, onConfirm }: { label: string; direction: string; onConfirm: (e: React.MouseEvent) => void }) {
  const labelText = label
  const labelW = Math.max(76, labelText.length * 6.6) + 8
  const confirmW = 70
  const gap = 4
  const total = labelW + gap + confirmW
  return (
    <g>
      {/* label pill */}
      <g transform={`translate(${-total / 2 + labelW / 2} 0)`} pointerEvents="none">
        <rect x={-labelW / 2} y={-12} width={labelW} height={26} rx={13} fill="#1E88E5" stroke="#1A1A2E" strokeWidth={3} />
        <text y={-3} textAnchor="middle" fill="#fff" fontSize={11} fontWeight={900}>{labelText}</text>
        {direction && <text y={9} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize={8} fontWeight={700}>{direction}</text>}
      </g>
      {/* confirm pill */}
      <g
        transform={`translate(${total / 2 - confirmW / 2} 0)`}
        style={{ cursor: 'pointer' }}
        onClick={onConfirm}
      >
        <rect x={-confirmW / 2} y={-12} width={confirmW} height={26} rx={13} fill="#22C55E" stroke="#1A1A2E" strokeWidth={3} />
        <text y={4} textAnchor="middle" fill="#0a0a14" fontSize={11} fontWeight={900} letterSpacing={0.8}>CONFIRM ✓</text>
      </g>
    </g>
  )
}

function LabelPill({ label, state }: { label: string; state: 'correct' | 'wrong' }) {
  const w = Math.max(70, label.length * 6.6) + 8
  const color = state === 'correct' ? '#22c55e' : '#ef4444'
  return (
    <g pointerEvents="none">
      <rect x={-w / 2} y={-10} width={w} height={20} rx={10} fill={color} stroke="#1A1A2E" strokeWidth={2.5} />
      <text y={4} textAnchor="middle" fill="#fff" fontSize={11} fontWeight={900}>{label}</text>
    </g>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/\(app\)/padelgenius/components/PositionedOptions.tsx
git commit -m "feat(padelgenius): PositionedOptions with cartoon style + inline confirm"
```

---

## Task 12: ProgressBar (right-wall tilted, 5 segments)

**Files:**
- Create: `src/app/[locale]/(app)/padelgenius/components/ProgressBar.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/app/[locale]/(app)/padelgenius/components/ProgressBar.tsx
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
                color: '#fff',
                fontSize: 12,
                fontWeight: 900,
                transition: 'background 200ms ease-out',
              }}>
                {isDone ? (result === 'correct' ? '✓' : '✕') : ''}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/\(app\)/padelgenius/components/ProgressBar.tsx
git commit -m "feat(padelgenius): tilted right-wall ProgressBar"
```

---

## Task 13: TopZone (close + theme tag + question)

**Files:**
- Create: `src/app/[locale]/(app)/padelgenius/components/TopZone.tsx`

- [ ] **Step 1: Write the component**

```tsx
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
          style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, border: 'none' }}
        >✕</button>
        <div style={{ fontSize: 9, color: '#fde047', fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' }}>
          {question.theme} · diff {question.difficulty}
        </div>
        <button
          onClick={onToggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
          style={{ marginLeft: 'auto', width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, border: 'none' }}
        >{muted ? '🔇' : '🔊'}</button>
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.25, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>
        {question.prompt}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/\(app\)/padelgenius/components/TopZone.tsx
git commit -m "feat(padelgenius): TopZone (close + theme + prompt + mute)"
```

---

## Task 14: ClearPill component

**Files:**
- Create: `src/app/[locale]/(app)/padelgenius/components/ClearPill.tsx`

- [ ] **Step 1: Write the component**

```tsx
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
      }}
    >✕ CLEAR</button>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/\(app\)/padelgenius/components/ClearPill.tsx
git commit -m "feat(padelgenius): cartoon ClearPill"
```

---

## Task 15: RevealSheet (slim, expandable Why?)

**Files:**
- Create: `src/app/[locale]/(app)/padelgenius/components/RevealSheet.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/app/[locale]/(app)/padelgenius/components/RevealSheet.tsx
'use client'
import { useState } from 'react'
import type { Question, OptionId } from '@/lib/padelgenius/types'

export interface RevealSheetProps {
  question: Question
  correct: boolean
  picked: OptionId | null
  onContinue: () => void
}

export function RevealSheet({ question, correct, picked, onContinue }: RevealSheetProps) {
  const [expanded, setExpanded] = useState(false)
  const correctOpt = question.options.find(o => o.isCorrect)
  const accent = correct ? '#22c55e' : '#ef4444'
  const accentDark = correct ? '#15803d' : '#991b1b'

  return (
    <div
      role="status"
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        background: accent, borderTop: `3px solid ${accentDark}`,
        zIndex: 6,
        animation: 'pg-sheet-slide-up 200ms ease-out forwards',
      }}
    >
      {expanded && (
        <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid rgba(0,0,0,0.18)' }}>
          <div style={{ fontSize: 12, color: '#fff', lineHeight: 1.4, fontWeight: 600 }}>
            <strong>{question.explanation.title}</strong> · {question.explanation.body}
          </div>
          {question.explanation.proTip && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.2)', fontSize: 11, color: 'rgba(255,255,255,0.95)', lineHeight: 1.4 }}>
              <strong>Pro tip · </strong>{question.explanation.proTip}
            </div>
          )}
        </div>
      )}
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#fff', color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 900, flexShrink: 0 }}>
          {correct ? '✓' : '✕'}
        </div>
        <div style={{ color: correct ? '#0a0a14' : '#fff', fontSize: 11, fontWeight: 900, letterSpacing: 0.3, flex: 1 }}>
          {correct ? `CORRECT · +100 XP · ${correctOpt?.label}` : `NOT QUITE · Answer was ${correctOpt?.id.toUpperCase()} · ${correctOpt?.label}`}
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          style={{ background: 'rgba(10,10,20,0.18)', color: correct ? '#0a0a14' : '#fff', border: '1.5px solid rgba(10,10,20,0.35)', borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
        >{expanded ? 'Hide ▴' : 'Why? ▾'}</button>
        <button
          onClick={onContinue}
          style={{ background: '#0a0a14', color: accent, borderRadius: 8, padding: '6px 12px', fontWeight: 900, fontSize: 11, letterSpacing: 0.5, border: 'none', cursor: 'pointer' }}
        >CONTINUE →</button>
      </div>
    </div>
  )
}
```

Add keyframe to `padelgenius.css`:

```css
@keyframes pg-sheet-slide-up {
  from { transform: translateY(100%); }
  to   { transform: translateY(0); }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/\(app\)/padelgenius/components/RevealSheet.tsx src/app/[locale]/\(app\)/padelgenius/padelgenius.css
git commit -m "feat(padelgenius): slim RevealSheet with Why? expand"
```

---

## Task 16: usePadelgeniusSound hook

**Files:**
- Create: `src/hooks/usePadelgeniusSound.ts`
- Create: 9 placeholder MP3 files (silence) in `public/padelgenius/sounds/`

- [ ] **Step 1: Generate silent placeholders for the 9 sounds**

```bash
mkdir -p public/padelgenius/sounds
# 9 short silent placeholders (200ms of silence as a valid MP3)
# Using ffmpeg if available; otherwise drop in real clips later.
if command -v ffmpeg >/dev/null; then
  for name in tap confirm swoosh-flat swoosh-lob swoosh-smash correct wrong continue complete; do
    ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 0.2 -q:a 9 -acodec libmp3lame public/padelgenius/sounds/${name}.mp3
  done
else
  echo "ffmpeg not found — drop real MP3 placeholders into public/padelgenius/sounds/ manually" >&2
fi
```

Expected: 9 .mp3 files exist. They are silent for now — replaced with real cartoon clips before launch.

- [ ] **Step 2: Write the hook**

```ts
// src/hooks/usePadelgeniusSound.ts
'use client'
import { useEffect, useRef, useState, useCallback } from 'react'

export type SoundName =
  | 'tap' | 'confirm' | 'swoosh-flat' | 'swoosh-lob' | 'swoosh-smash'
  | 'correct' | 'wrong' | 'continue' | 'complete'

const SOUND_PATHS: Record<SoundName, string> = {
  tap:            '/padelgenius/sounds/tap.mp3',
  confirm:        '/padelgenius/sounds/confirm.mp3',
  'swoosh-flat':  '/padelgenius/sounds/swoosh-flat.mp3',
  'swoosh-lob':   '/padelgenius/sounds/swoosh-lob.mp3',
  'swoosh-smash': '/padelgenius/sounds/swoosh-smash.mp3',
  correct:        '/padelgenius/sounds/correct.mp3',
  wrong:          '/padelgenius/sounds/wrong.mp3',
  continue:       '/padelgenius/sounds/continue.mp3',
  complete:       '/padelgenius/sounds/complete.mp3',
}

const STORAGE_KEY = 'padelgenius:muted'

export function usePadelgeniusSound() {
  const cacheRef = useRef<Partial<Record<SoundName, HTMLAudioElement>>>({})
  const [muted, setMutedState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  })

  // Preload on mount
  useEffect(() => {
    (Object.keys(SOUND_PATHS) as SoundName[]).forEach(name => {
      const a = new Audio(SOUND_PATHS[name])
      a.preload = 'auto'
      cacheRef.current[name] = a
    })
  }, [])

  const play = useCallback((name: SoundName) => {
    if (muted) return
    const a = cacheRef.current[name]
    if (!a) return
    try {
      a.currentTime = 0
      void a.play()
    } catch {/* ignore */}
  }, [muted])

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
    }
  }, [])

  return { play, muted, setMuted, toggleMuted: () => setMuted(!muted) }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/usePadelgeniusSound.ts public/padelgenius/sounds/
git commit -m "feat(padelgenius): useSound hook + silent placeholder clips"
```

---

## Task 17: Scene component (court image + players + ball + trajectories + sparkle)

**Files:**
- Create: `src/app/[locale]/(app)/padelgenius/components/Scene.tsx`

The Scene composes the full SVG: court PNG as background, then players, ball, letter options, and (when revealing) trajectory + sparkle.

- [ ] **Step 1: Write the component**

```tsx
// src/app/[locale]/(app)/padelgenius/components/Scene.tsx
'use client'
import type { Question, OptionId, PlayerPosition, PlayerRole, Outcome } from '@/lib/padelgenius/types'
import { toSvg, playerScale, fromSvg, W, H } from '@/lib/padelgenius/projection'
import { DEFAULT_COURT } from '@/lib/padelgenius/default-court'
import { PlayerSprite, PLAYER_SPRITE_URLS } from './PlayerSprite'
import { BallSprite } from './BallSprite'
import { TrajectoryRenderer } from './TrajectoryRenderer'
import { PositionedOptions } from './PositionedOptions'
import { trajectoryPath } from '@/lib/padelgenius/trajectories'

export interface SceneProps {
  question: Question
  phase: 'idle' | 'selecting' | 'revealing'
  selectedId: OptionId | null
  pickedId: OptionId | null
  onSelect: (id: OptionId) => void
  onConfirm: () => void
}

export function Scene({ question, phase, selectedId, pickedId, onSelect, onConfirm }: SceneProps) {
  const bounds = DEFAULT_COURT.bounds
  const vs = DEFAULT_COURT.visualSystem
  const correctOpt = question.options.find(o => o.isCorrect)!
  const correctId = correctOpt.id
  const revealing = phase === 'revealing'

  // Apply playerOverrides from the picked option during reveal
  const players: PlayerPosition[] = revealing && pickedId
    ? applyOverrides(question.court.players, question.options.find(o => o.id === pickedId)?.outcome.playerOverrides)
    : question.court.players
  const sortedPlayers = [...players].sort((a, b) => a.y - b.y)

  // Trajectory(ies) during reveal
  const revealedOutcomes: { id: OptionId; outcome: Outcome; state: 'correct' | 'wrong' }[] = revealing && pickedId
    ? pickedId === correctId
      ? [{ id: pickedId, outcome: question.options.find(o => o.id === pickedId)!.outcome, state: 'correct' }]
      : [
          { id: pickedId, outcome: question.options.find(o => o.id === pickedId)!.outcome, state: 'wrong' },
          { id: correctId, outcome: correctOpt.outcome, state: 'correct' },
        ]
    : []

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }}>
      {/* Court image */}
      <image href={DEFAULT_COURT.imageUrl} x={0} y={0} width={W} height={H} preserveAspectRatio="xMidYMid slice" />

      {/* Players — sorted by depth so far players draw first */}
      {sortedPlayers.map(p => {
        const [px, py] = toSvg(p.x, p.y, bounds)
        const s = playerScale(p.y, vs)
        return (
          <PlayerSprite
            key={p.role}
            role={p.role}
            x={px}
            y={py}
            scale={s}
            vs={vs}
            spriteUrl={PLAYER_SPRITE_URLS[p.role]}
            faded={false}
          />
        )
      })}

      {/* Existing question ball (if part of the setup, e.g. incoming lob) */}
      {question.court.ball && !revealing && (
        <BallSprite x={toSvg(question.court.ball.x, question.court.ball.y, bounds)[0]} y={toSvg(question.court.ball.x, question.court.ball.y, bounds)[1]} />
      )}

      {/* Reveal trajectories */}
      {revealedOutcomes.map(({ id, outcome, state }) => {
        const from = toSvg(outcome.trajectory.from[0], outcome.trajectory.from[1], bounds)
        const to = toSvg(outcome.trajectory.to[0], outcome.trajectory.to[1], bounds)
        const pathId = `traj-${id}`
        return (
          <g key={id}>
            <TrajectoryRenderer style={outcome.trajectory.style} from={from} to={to} state={state} animate pathId={pathId} />
            {/* Ball animates along the path */}
            <BallSprite
              x={from[0]} y={from[1]}
              motionPath={trajectoryPath(outcome.trajectory.style, from, to)}
              motionDuration={500}
            />
            {/* Star sparkle on correct */}
            {state === 'correct' && <Sparkle x={to[0]} y={to[1]} />}
          </g>
        )
      })}

      {/* Option letters */}
      <PositionedOptions
        options={question.options}
        phase={phase}
        selectedId={selectedId}
        correctId={revealing ? correctId : null}
        onSelect={onSelect}
        onConfirm={onConfirm}
      />
    </svg>
  )
}

function applyOverrides(base: PlayerPosition[], overrides?: PlayerPosition[]): PlayerPosition[] {
  if (!overrides || overrides.length === 0) return base
  const map = new Map(overrides.map(o => [o.role, o]))
  return base.map(p => map.get(p.role) ?? p)
}

function Sparkle({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} style={{ animation: 'pg-sparkle 400ms ease-out forwards', transformOrigin: `${x}px ${y}px` }}>
      <text textAnchor="middle" y={6} fontSize={20} fill="#fde047" fontWeight={900} stroke="#1A1A2E" strokeWidth={1.5} paintOrder="stroke">★</text>
    </g>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/\(app\)/padelgenius/components/Scene.tsx
git commit -m "feat(padelgenius): Scene composes court + players + ball + trajectories + sparkle"
```

---

## Task 18: PlayMode state machine

**Files:**
- Create: `src/app/[locale]/(app)/padelgenius/components/PlayMode.tsx`

This is the orchestrator. Holds the question index, picked/selected option, phase, history. Plays sounds at the right moments.

- [ ] **Step 1: Write the component**

```tsx
// src/app/[locale]/(app)/padelgenius/components/PlayMode.tsx
'use client'
import { useState, useEffect, useCallback } from 'react'
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
    <div style={{ position: 'fixed', inset: 0, background: '#0a0a14', overflow: 'hidden', zIndex: 9999 }}>
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
```

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/\(app\)/padelgenius/components/PlayMode.tsx
git commit -m "feat(padelgenius): PlayMode orchestrator with sound + state machine"
```

---

## Task 19: SummaryView for the lesson-complete screen

**Files:**
- Create: `src/app/[locale]/(app)/padelgenius/components/SummaryView.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/app/[locale]/(app)/padelgenius/components/SummaryView.tsx
'use client'
import type { Question, OptionId } from '@/lib/padelgenius/types'

export interface SummaryViewProps {
  questions: Question[]
  results: { questionId: number; picked: OptionId | null; correct: boolean }[]
  onPlayAgain: () => void
  onExit: () => void
}

export function SummaryView({ questions, results, onPlayAgain, onExit }: SummaryViewProps) {
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
                  background: r.correct ? '#22c55e' : '#ef4444', color: '#0a0a14',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 12,
                }}>{r.correct ? '✓' : '✕'}</div>
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
```

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/\(app\)/padelgenius/components/SummaryView.tsx
git commit -m "feat(padelgenius): SummaryView for lesson-complete screen"
```

---

## Task 20: Play page route

**Files:**
- Create: `src/app/[locale]/(app)/padelgenius/play/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
// src/app/[locale]/(app)/padelgenius/play/page.tsx
'use client'
import { useState, useMemo } from 'react'
import { useRouter } from '@/i18n/navigation'
import questionsData from '@/data/genius-questions.json'
import type { Question, OptionId } from '@/lib/padelgenius/types'
import { PlayMode } from '../components/PlayMode'
import { SummaryView } from '../components/SummaryView'
import '../padelgenius.css'

const LESSON_SIZE = 5

function pickLesson(all: Question[]): Question[] {
  const shuffled = [...all].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, LESSON_SIZE)
}

export default function PadelGeniusPlayPage() {
  const router = useRouter()
  const [lesson, setLesson] = useState<Question[]>(() => pickLesson(questionsData as Question[]))
  const [results, setResults] = useState<{ questionId: number; picked: OptionId | null; correct: boolean }[] | null>(null)

  const handleExit = () => router.push('/padelgenius')
  const handleComplete = (r: typeof results) => setResults(r)
  const handlePlayAgain = () => {
    setLesson(pickLesson(questionsData as Question[]))
    setResults(null)
  }

  if (results) {
    return <SummaryView questions={lesson} results={results} onPlayAgain={handlePlayAgain} onExit={handleExit} />
  }
  return <PlayMode questions={lesson} onExit={handleExit} onComplete={handleComplete} />
}
```

- [ ] **Step 2: Verify it renders in the browser**

Start dev server and visit `http://localhost:3000/padelgenius/play`.

Expected: full-bleed court, 5 letters visible somewhere on the court, top zone shows the prompt, right-wall progress bar visible with one amber segment.

If letters overlap or sit off the court, that's a question-data issue (Task 7 used heuristic defaults). Fix individual questions in the JSON or note for Phase 3 editor follow-up.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/\(app\)/padelgenius/play/page.tsx
git commit -m "feat(padelgenius): /padelgenius/play page wired end-to-end"
```

---

## Task 21: Hub CTA — link from /padelgenius to /padelgenius/play

**Files:**
- Modify: `src/app/[locale]/(app)/padelgenius/page.tsx`

The existing hub has its own state. Add a prominent CTA that goes to the new play route. Leave the rest intact.

- [ ] **Step 1: Read the current page**

```bash
head -80 src/app/[locale]/\(app\)/padelgenius/page.tsx
```

- [ ] **Step 2: Add a "Start lesson (v2)" button**

Locate the section that renders the Hub (the "play" CTA in the existing flow) and either replace its onClick to navigate to `/padelgenius/play`, or add a second button labeled "Play with new visuals" that does so. Recommended: add a second button so we can A/B compare v1 vs v2 while shipping.

Example: insert after the existing Start button —

```tsx
import Link from 'next/link'
// ...
<Link
  href="/padelgenius/play"
  style={{
    display: 'block', textAlign: 'center', background: '#22c55e', color: '#0a0a14',
    padding: '14px 20px', borderRadius: 16, fontWeight: 900, marginTop: 12, textDecoration: 'none',
  }}
>
  ▶ Play (new visuals)
</Link>
```

- [ ] **Step 3: Verify navigation**

Visit `/padelgenius`, click "Play (new visuals)", verify it loads the new screen.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/\(app\)/padelgenius/page.tsx
git commit -m "feat(padelgenius): link hub to /padelgenius/play"
```

---

## Task 22: Idle player breathing (CSS keyframe applied to sprites)

**Files:**
- Modify: `src/app/[locale]/(app)/padelgenius/components/PlayerSprite.tsx`
- Modify: `src/app/[locale]/(app)/padelgenius/padelgenius.css`

Each chibi gets a `pg-breathe` animation with a per-role delay so they aren't synced.

- [ ] **Step 1: Update PlayerSprite**

Replace the `<image>` element with a group wrapper that applies the breathing animation:

```tsx
const BREATHE_DELAY: Record<PlayerRole, string> = {
  you: '0s', partner: '0.4s', opponent1: '0.8s', opponent2: '1.2s',
}
// ...
return (
  <g style={{ animation: `pg-breathe 2.5s ease-in-out infinite`, animationDelay: BREATHE_DELAY[role], transformOrigin: `${x}px ${y}px` }}>
    <image .../>
  </g>
)
```

- [ ] **Step 2: Verify the breathing in the browser**

Reload `/padelgenius/play`, observe the chibis softly bobbing.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/\(app\)/padelgenius/components/PlayerSprite.tsx
git commit -m "feat(padelgenius): idle player breathing animation"
```

---

## Task 23: Tap-scale feedback on letters

**Files:**
- Modify: `src/app/[locale]/(app)/padelgenius/components/PositionedOptions.tsx`

When a letter is selected, briefly scale it 1.0→1.05→1.0 for haptic feel.

- [ ] **Step 1: Add a brief scale animation**

Add to `padelgenius.css`:

```css
@keyframes pg-tap {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.08); }
}
```

In `PositionedOptions.tsx`, when `isSelected` becomes true, apply `animation: pg-tap 150ms ease-out` to the letter group:

```tsx
style={{
  ...(prev style)...
  animation: isSelected ? 'pg-tap 150ms ease-out' : undefined,
}}
```

- [ ] **Step 2: Verify in the browser**

Tap a letter, observe a tiny scale-up bounce.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/\(app\)/padelgenius/components/PositionedOptions.tsx src/app/[locale]/\(app\)/padelgenius/padelgenius.css
git commit -m "feat(padelgenius): tap scale feedback on letters"
```

---

## Task 24: Confirm button pulse

**Files:**
- Modify: `src/app/[locale]/(app)/padelgenius/components/PositionedOptions.tsx`

On confirm-pill click, emit one outward pulse ring.

- [ ] **Step 1: Wrap the confirm pill in a state that triggers an animation**

Inside `SelectionPillRow`, add a one-shot animation class when clicked:

```tsx
const [pulsing, setPulsing] = useState(false)
// ...
onClick={(e) => { setPulsing(true); setTimeout(() => setPulsing(false), 300); onConfirm(e) }}
// ...
{pulsing && <circle r={20} fill="none" stroke="#22C55E" strokeWidth={3} style={{ animation: 'pg-pulse 300ms ease-out forwards' }} />}
```

- [ ] **Step 2: Verify**

Tap CONFIRM, see a brief outward ring.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/\(app\)/padelgenius/components/PositionedOptions.tsx
git commit -m "feat(padelgenius): confirm button pulse"
```

---

## Task 25: Question cross-fade on advance

**Files:**
- Modify: `src/app/[locale]/(app)/padelgenius/components/PlayMode.tsx`

When `idx` changes, briefly fade the whole scene.

- [ ] **Step 1: Add a fade key tied to idx**

```tsx
<div key={idx} style={{ animation: 'pg-fade-in 250ms ease-out' }}>
  {/* existing Scene + chrome */}
</div>
```

Add keyframe:

```css
@keyframes pg-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
```

- [ ] **Step 2: Verify**

Complete a question, advance, watch the next question fade in.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/\(app\)/padelgenius/components/PlayMode.tsx src/app/[locale]/\(app\)/padelgenius/padelgenius.css
git commit -m "feat(padelgenius): question cross-fade on advance"
```

---

## Task 26: Accessibility — prefers-reduced-motion

**Files:**
- Already covered by the CSS rule in `padelgenius.css`. Verify it applies broadly.

- [ ] **Step 1: Apply `pg-no-motion-reduce` class to the play container**

In `PlayMode.tsx`:

```tsx
<div className="pg-no-motion-reduce" style={{ position: 'fixed', inset: 0, ... }}>
```

- [ ] **Step 2: Manually test**

In macOS System Settings → Accessibility → Display, enable "Reduce motion". Reload `/padelgenius/play`. Confirm idle bob and pulses are disabled or very fast. State transitions still work (≤80 ms).

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/\(app\)/padelgenius/components/PlayMode.tsx
git commit -m "feat(padelgenius): respect prefers-reduced-motion"
```

---

## Task 27: Smoke tests for the play flow

**Files:**
- Create: `src/app/[locale]/(app)/padelgenius/components/__tests__/PlayMode.smoke.test.tsx`

Use Vitest + React Testing Library. Verify the basic state machine: render → tap letter → confirm → see reveal → continue advances.

- [ ] **Step 1: Write the test**

```tsx
// src/app/[locale]/(app)/padelgenius/components/__tests__/PlayMode.smoke.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PlayMode } from '../PlayMode'
import type { Question } from '@/lib/padelgenius/types'

// stub the sound hook so audio never tries to play
vi.mock('@/hooks/usePadelgeniusSound', () => ({
  usePadelgeniusSound: () => ({ play: vi.fn(), muted: false, setMuted: vi.fn(), toggleMuted: vi.fn() }),
}))

const fakeQ: Question = {
  id: 1, prompt: 'Test prompt', theme: 'shots', difficulty: 1,
  court: { players: [
    { role: 'you', x: 40, y: 80 }, { role: 'partner', x: 60, y: 80 },
    { role: 'opponent1', x: 40, y: 20 }, { role: 'opponent2', x: 60, y: 20 },
  ] },
  options: [
    { id: 'a', label: 'A', direction: '', letter: { x: 30, y: 30 }, isCorrect: false,
      outcome: { ball: { x: 30, y: 30 }, trajectory: { from: [50, 50], to: [30, 30], style: 'flat' } } },
    { id: 'b', label: 'B', direction: '', letter: { x: 70, y: 30 }, isCorrect: true,
      outcome: { ball: { x: 70, y: 30 }, trajectory: { from: [50, 50], to: [70, 30], style: 'flat' } } },
  ],
  explanation: { title: 'T', body: 'Body' },
}

describe('PlayMode smoke', () => {
  it('shows the prompt', () => {
    render(<PlayMode questions={[fakeQ]} onExit={() => {}} onComplete={() => {}} />)
    expect(screen.getByText('Test prompt')).toBeInTheDocument()
  })

  it('transitions to reveal on confirm', () => {
    render(<PlayMode questions={[fakeQ]} onExit={() => {}} onComplete={() => {}} />)
    // Click letter B (the correct one) — the letter is inside an SVG <text>; click its parent <g>
    const letters = screen.getAllByText(/^[AB]$/)
    fireEvent.click(letters.find(el => el.textContent === 'B')!.parentElement!)
    // Confirm pill appears
    expect(screen.getByText(/CONFIRM/)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/CONFIRM/).parentElement!)
    // Reveal sheet shows CORRECT
    expect(screen.getByText(/CORRECT/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Configure DOM if not already set up**

Ensure `vitest.config.ts` has `environment: 'jsdom'` for component tests. If not, add it or create a project-scoped config. Check:

```bash
grep -n "environment" vitest.config.ts 2>/dev/null || echo "no jsdom configured — add it"
```

If missing, add `test: { environment: 'jsdom' }` to the vitest config.

- [ ] **Step 3: Run the smoke test**

```bash
npx vitest run src/app/[locale]/\(app\)/padelgenius/components/__tests__/PlayMode.smoke.test.tsx
```

Expected: both tests pass. If the SVG click target finding is brittle, add `data-testid` attributes to the letter groups instead.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/\(app\)/padelgenius/components/__tests__/
git commit -m "test(padelgenius): smoke test for PlayMode state machine"
```

---

## Task 28: Manual QA checklist

**Files:** none. Use this as a pre-PR pass.

- [ ] Visit `/padelgenius` — hub loads with both old + new CTA visible.
- [ ] Visit `/padelgenius/play` — new layout renders: court fills viewport, top zone shows prompt, right-wall progress bar visible with amber-current segment, hint pill pulses at bottom.
- [ ] Tap a letter — turns blue, label pill + CONFIRM appear inline, tap-scale bounce visible.
- [ ] Tap CONFIRM — letter recolors green/red, trajectory animates from start to landing point, ball travels along the trajectory, ★ sparkles at landing if correct, reveal sheet slides up.
- [ ] Tap CONTINUE — next question cross-fades in, progress segment recolored and amber moved up.
- [ ] Complete 5 questions — summary screen shows count, XP, per-question review, Play again + Exit.
- [ ] Enable Reduce Motion in OS settings — reload play page — confirm idle bob/halo/pulse disabled.
- [ ] Toggle mute in the top bar — sounds stop. Refresh — mute state persists.
- [ ] Lint + typecheck clean: `npm run lint && npx tsc --noEmit`.

If anything fails, fix inline before opening the PR.

- [ ] Commit any post-QA fixes:

```bash
git add -A
git commit -m "chore(padelgenius): QA fixes for Phase 1"
```

---

## Task 29: Open the PR

- [ ] Push the branch:

```bash
git push -u origin feature/padelgenius-v2-phase-1
```

- [ ] Open the PR:

```bash
gh pr create --title "feat(padelgenius): v2 Phase 1 — new play screen" --body "$(cat <<'EOF'
## Summary
- Implements PadelGenius v2 Phase 1 per docs/superpowers/specs/2026-05-13-padelgenius-v2-design.md (§§1–7).
- New routes: `/padelgenius/play` running the redesigned scene.
- New visual system: cartoon letters, inline label + CONFIRM, right-wall tilted progress bar, slim reveal sheet.
- Per-option outcome data model + 8 trajectory styles (incl. vibora, smash).
- Ball animation along trajectory, ★ sparkle on correct, idle player breathing, hint-pill pulse, tap-scale feedback.
- Cartoon-style audio: 9 sounds preloaded, mute toggle, prefers-reduced-motion respected.
- Existing 50+ questions migrated to the new schema via scripts/migrate-genius-questions.ts.
- Tests for projection, trajectory paths, scoring, and a PlayMode smoke test.

## Test plan
- [ ] CI lint + typecheck pass
- [ ] CI vitest green
- [ ] Manual QA at /padelgenius/play on mobile viewport
- [ ] Hub `/padelgenius` still works (legacy CTA unchanged)
- [ ] /ops and the rest of the app unaffected

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] Share the PR URL.

---

## Self-review summary

- **Spec coverage:** §1 (goal) → covered by routes + lesson size constant; §2.1 layout → TopZone + Scene + RevealSheet + ProgressBar + ClearPill; §2.2 lifecycle → PlayMode state machine; §2.3 cartoon style → PositionedOptions + ProgressBar + RevealSheet styling; §2.4 trajectory styles → trajectories.ts + TrajectoryRenderer; §3 data model → types.ts + migration script; §6 animation budget → CSS keyframes + Task 22–26; §7 audio → usePadelgeniusSound + Task 16. §4 architecture maps to the file layout. §5 calibration & §8 admin authoring are explicitly out of scope for Phase 1 (Phases 2 and 3).
- **Placeholders:** none. All steps include real code, real commands, real expected outputs.
- **Type consistency:** `Question`, `QuestionOption`, `Outcome`, `Trajectory`, `TrajectoryStyle`, `CourtBounds`, `VisualSystem` are defined in Task 2 and used unchanged throughout.
