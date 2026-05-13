# PadelGenius v2 · Phase 2 — Court Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship admin tooling at `/ops/padelgenius/courts` so the team can upload alternative court PNGs, calibrate them (15 dimensions), configure sponsor branding (5 slots), and switch the active court — all without code changes. Replaces the hardcoded `DEFAULT_COURT` from Phase 1.

**Architecture:** Court configs live on disk under `public/padelgenius/courts/<slug>/` (image + JSON config). A single `active: true` court is the live one. Phase 1's `DEFAULT_COURT` becomes the first persisted court; everything reads through the active-court resolver. The admin UI is a thin Next.js page; persistence is via small API routes under `/api/ops/padelgenius/courts/*` protected by the existing `ops_token` cookie.

**Tech Stack:** Next.js 16 App Router, React 19, server-side `fs/promises` for reading/writing JSON, `multer`-style file upload via the platform's native FormData (no extra dep), `sharp` (already in deps via Next image optimization — if not, install) for thumbnail generation.

**Spec reference:** §3.3, §5, §8.1–8.2 of `docs/superpowers/specs/2026-05-13-padelgenius-v2-design.md`.

**Depends on:** Phase 1 (types.ts, projection.ts, default-court.ts).

---

## File Structure

### New files

```
public/padelgenius/courts/
  club-deportivo/                       ← seeded from Phase 1's DEFAULT_COURT
    court.png                            ← moved/copied from /padelgenius/court.png
    config.json                          ← persisted CourtConfig
    thumb.png                            ← auto-generated 200×300

src/lib/padelgenius/
  court-loader.ts                        ← server-only: read all courts from disk
  court-store.ts                         ← server-only: write court config + upload
  active-court-cache.ts                  ← in-process cache of the active court (revalidates on save)
  __tests__/court-loader.test.ts

src/app/[locale]/(app)/padelgenius/
  components/
    ActiveCourtProvider.tsx              ← client context — exposes the active CourtConfig (replaces DEFAULT_COURT usage in Phase 1 components)

src/app/api/ops/padelgenius/
  courts/route.ts                        ← GET (list all) + POST (upload new)
  courts/[slug]/route.ts                 ← GET (one) + PATCH (update config) + DELETE
  courts/[slug]/activate/route.ts        ← POST: set active
  courts/[slug]/sponsor/route.ts         ← POST: upload sponsor logo to a slot

src/app/ops/padelgenius/
  layout.tsx                             ← optional shared shell (or use existing ops layout)
  courts/page.tsx                        ← library: grid of court cards
  courts/[slug]/page.tsx                 ← per-court editor with tabs
  courts/_components/
    CourtCard.tsx
    DimensionsTab.tsx
    ZonesTab.tsx
    BrandingTab.tsx
    SliderRow.tsx
    SlotCard.tsx
    LandmarkOverlay.tsx                  ← the dashed-line preview over the court image
    UploadCourtDropzone.tsx
```

### Modified files

```
src/lib/padelgenius/default-court.ts   ← convert to fallback only; primary path reads from disk
src/app/[locale]/(app)/padelgenius/components/Scene.tsx
src/app/[locale]/(app)/padelgenius/components/PlayMode.tsx
src/app/[locale]/(app)/padelgenius/play/page.tsx
                                        ← all consumers switch from `DEFAULT_COURT` to `useActiveCourt()`
```

---

## Task 1: Worktree + dependencies

- [ ] **Step 1:** Create worktree

```bash
git worktree add .worktrees/padelgenius-v2-phase-2 -b feature/padelgenius-v2-phase-2 main
cd .worktrees/padelgenius-v2-phase-2
ln -s /Users/GuDenes/Projects/padel-live-scores/node_modules node_modules
```

- [ ] **Step 2:** Verify `sharp` is available (Next.js usually pulls it in for image optimization)

```bash
node -e "console.log(require('sharp')?.format ? 'sharp ok' : 'missing')"
```

If missing:

```bash
npm install sharp
```

- [ ] **Step 3:** Confirm Phase 1 baseline is green

```bash
npx vitest run src/lib/padelgenius/__tests__/
```

Expected: all pass.

---

## Task 2: Seed the first court folder

**Files:**
- Create: `public/padelgenius/courts/club-deportivo/court.png` (copied from existing `public/padelgenius/court.png`)
- Create: `public/padelgenius/courts/club-deportivo/config.json`

- [ ] **Step 1:** Create the folder and copy the court image

```bash
mkdir -p public/padelgenius/courts/club-deportivo
cp public/padelgenius/court.png public/padelgenius/courts/club-deportivo/court.png
```

- [ ] **Step 2:** Write the config.json (matches Phase 1's `DEFAULT_COURT`)

```bash
cat > public/padelgenius/courts/club-deportivo/config.json <<'JSON'
{
  "name": "Club Deportivo",
  "active": true,
  "imageUrl": "/padelgenius/courts/club-deportivo/court.png",
  "bounds": {
    "backGlassY": 0.250,
    "backServiceY": 0.315,
    "netY": 0.520,
    "nearServiceY": 0.850,
    "nearGlassY": 0.980,
    "farLeftX": 0.253,
    "farRightX": 0.740,
    "nearLeftX": 0.045,
    "nearRightX": 0.965
  },
  "zones": {
    "attackDepth": 7,
    "transitionDepth": 17
  },
  "visualSystem": {
    "playerBaseSize": 90,
    "scaleCurveMin": 0.85,
    "scaleCurveMax": 1.20,
    "letterRadius": 12,
    "progressBarTilt": -7
  },
  "branding": {
    "backWall": null,
    "sideGlassLeft": null,
    "sideGlassRight": null,
    "netBand": null,
    "floorCenter": null
  }
}
JSON
```

- [ ] **Step 3:** Commit

```bash
git add public/padelgenius/courts/club-deportivo/
git commit -m "feat(padelgenius/courts): seed club-deportivo court folder"
```

---

## Task 3: Extend types with branding

**Files:**
- Modify: `src/lib/padelgenius/types.ts`

- [ ] **Step 1:** Add `BrandingSlots`, `SlotConfig`, update `CourtConfig`

Append to `types.ts`:

```ts
export interface SlotConfig {
  logoUrl: string
  scale: number   // 0.5–2.0
}

export interface BrandingSlots {
  backWall: SlotConfig | null
  sideGlassLeft: SlotConfig | null
  sideGlassRight: SlotConfig | null
  netBand: SlotConfig | null
  floorCenter: SlotConfig | null
}

// update CourtConfig to include branding
export interface CourtConfig {
  name: string
  active: boolean
  imageUrl: string
  bounds: CourtBounds
  zones: CourtZones
  visualSystem: VisualSystem
  branding: BrandingSlots
}
```

If `CourtConfig` already exists from Phase 1 without `branding`, edit the existing definition to add the field.

- [ ] **Step 2:** Typecheck

```bash
npx tsc --noEmit src/lib/padelgenius/types.ts
```

- [ ] **Step 3:** Commit

```bash
git add src/lib/padelgenius/types.ts
git commit -m "feat(padelgenius): add BrandingSlots types"
```

---

## Task 4: Court loader (server-only) + tests

**Files:**
- Create: `src/lib/padelgenius/court-loader.ts`
- Create: `src/lib/padelgenius/__tests__/court-loader.test.ts`

- [ ] **Step 1:** Write failing tests

```ts
// src/lib/padelgenius/__tests__/court-loader.test.ts
import { describe, it, expect } from 'vitest'
import { loadAllCourts, loadActiveCourt } from '../court-loader'

describe('court loader', () => {
  it('loads at least one court from disk', async () => {
    const all = await loadAllCourts()
    expect(all.length).toBeGreaterThan(0)
  })

  it('club-deportivo is in the list', async () => {
    const all = await loadAllCourts()
    expect(all.find(c => c.slug === 'club-deportivo')).toBeDefined()
  })

  it('exactly one court is active', async () => {
    const all = await loadAllCourts()
    const active = all.filter(c => c.config.active)
    expect(active.length).toBe(1)
  })

  it('loadActiveCourt returns the active one', async () => {
    const active = await loadActiveCourt()
    expect(active.slug).toBe('club-deportivo')
    expect(active.config.active).toBe(true)
  })
})
```

- [ ] **Step 2:** Run — should fail (module not found)

```bash
npx vitest run src/lib/padelgenius/__tests__/court-loader.test.ts
```

- [ ] **Step 3:** Implement loader

```ts
// src/lib/padelgenius/court-loader.ts
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { CourtConfig } from './types'

const COURTS_DIR = path.join(process.cwd(), 'public', 'padelgenius', 'courts')

export interface LoadedCourt {
  slug: string
  config: CourtConfig
}

export async function loadAllCourts(): Promise<LoadedCourt[]> {
  const entries = await fs.readdir(COURTS_DIR, { withFileTypes: true })
  const results: LoadedCourt[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const configPath = path.join(COURTS_DIR, entry.name, 'config.json')
    try {
      const raw = await fs.readFile(configPath, 'utf-8')
      const config = JSON.parse(raw) as CourtConfig
      results.push({ slug: entry.name, config })
    } catch {
      // skip directories without a config
    }
  }
  return results
}

export async function loadActiveCourt(): Promise<LoadedCourt> {
  const all = await loadAllCourts()
  const active = all.find(c => c.config.active)
  if (!active) {
    if (all.length === 0) throw new Error('No courts found under public/padelgenius/courts/')
    // Fallback: first court becomes active
    return all[0]
  }
  return active
}
```

- [ ] **Step 4:** Run — should pass

```bash
npx vitest run src/lib/padelgenius/__tests__/court-loader.test.ts
```

- [ ] **Step 5:** Commit

```bash
git add src/lib/padelgenius/court-loader.ts src/lib/padelgenius/__tests__/court-loader.test.ts
git commit -m "feat(padelgenius): server-side court loader + tests"
```

---

## Task 5: Active court provider on the client

**Files:**
- Create: `src/app/[locale]/(app)/padelgenius/components/ActiveCourtProvider.tsx`
- Modify: `src/app/[locale]/(app)/padelgenius/play/page.tsx` to fetch the active court server-side and pass it down.

- [ ] **Step 1:** Create the provider

```tsx
// src/app/[locale]/(app)/padelgenius/components/ActiveCourtProvider.tsx
'use client'
import { createContext, useContext } from 'react'
import type { CourtConfig } from '@/lib/padelgenius/types'

const Ctx = createContext<CourtConfig | null>(null)

export function ActiveCourtProvider({ court, children }: { court: CourtConfig; children: React.ReactNode }) {
  return <Ctx.Provider value={court}>{children}</Ctx.Provider>
}

export function useActiveCourt(): CourtConfig {
  const c = useContext(Ctx)
  if (!c) throw new Error('useActiveCourt must be used inside ActiveCourtProvider')
  return c
}
```

- [ ] **Step 2:** Update `play/page.tsx` to be a server component that loads the active court

```tsx
// src/app/[locale]/(app)/padelgenius/play/page.tsx
import { loadActiveCourt } from '@/lib/padelgenius/court-loader'
import { ActiveCourtProvider } from '../components/ActiveCourtProvider'
import { PlayClient } from './PlayClient'
import questionsData from '@/data/genius-questions.json'
import type { Question } from '@/lib/padelgenius/types'
import '../padelgenius.css'

export default async function PadelGeniusPlayPage() {
  const { config } = await loadActiveCourt()
  return (
    <ActiveCourtProvider court={config}>
      <PlayClient questions={questionsData as Question[]} />
    </ActiveCourtProvider>
  )
}
```

- [ ] **Step 3:** Extract the client logic from the previous `play/page.tsx` into `PlayClient.tsx`

```tsx
// src/app/[locale]/(app)/padelgenius/play/PlayClient.tsx
'use client'
import { useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import type { Question, OptionId } from '@/lib/padelgenius/types'
import { PlayMode } from '../components/PlayMode'
import { SummaryView } from '../components/SummaryView'

const LESSON_SIZE = 5

function pickLesson(all: Question[]): Question[] {
  const shuffled = [...all].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, LESSON_SIZE)
}

export function PlayClient({ questions }: { questions: Question[] }) {
  const router = useRouter()
  const [lesson, setLesson] = useState<Question[]>(() => pickLesson(questions))
  const [results, setResults] = useState<{ questionId: number; picked: OptionId | null; correct: boolean }[] | null>(null)

  const handleExit = () => router.push('/padelgenius')
  const handleComplete = (r: typeof results) => setResults(r)
  const handlePlayAgain = () => { setLesson(pickLesson(questions)); setResults(null) }

  return results
    ? <SummaryView questions={lesson} results={results} onPlayAgain={handlePlayAgain} onExit={handleExit} />
    : <PlayMode questions={lesson} onExit={handleExit} onComplete={handleComplete} />
}
```

- [ ] **Step 4:** Commit

```bash
git add src/app/[locale]/\(app\)/padelgenius/
git commit -m "feat(padelgenius): load active court server-side + provide via context"
```

---

## Task 6: Refactor Phase 1 components to use `useActiveCourt`

**Files:**
- Modify: `src/app/[locale]/(app)/padelgenius/components/Scene.tsx`
- Modify: `src/app/[locale]/(app)/padelgenius/components/PositionedOptions.tsx`
- Modify: `src/app/[locale]/(app)/padelgenius/components/ProgressBar.tsx`

Replace `import { DEFAULT_COURT } from '@/lib/padelgenius/default-court'` with `import { useActiveCourt } from './ActiveCourtProvider'`, and call `const court = useActiveCourt()` inside each component. Use `court.bounds`, `court.visualSystem`, `court.imageUrl`, `court.branding` where needed.

- [ ] **Step 1:** Update Scene.tsx

In Scene.tsx, replace the `DEFAULT_COURT` references:

```tsx
import { useActiveCourt } from './ActiveCourtProvider'
// ... inside Scene():
const court = useActiveCourt()
const bounds = court.bounds
const vs = court.visualSystem
// ... use court.imageUrl for the court image href
```

- [ ] **Step 2:** Update PositionedOptions.tsx and ProgressBar.tsx similarly

In each, swap `DEFAULT_COURT` → `useActiveCourt()`.

- [ ] **Step 3:** Render branding overlays in Scene

Add after the court image render, before players:

```tsx
{court.branding.backWall && (
  <image
    href={court.branding.backWall.logoUrl}
    x={W * 0.18} y={H * 0.13} width={W * 0.64} height={H * 0.07}
    preserveAspectRatio="xMidYMid meet"
    opacity={1}
  />
)}
{court.branding.sideGlassLeft && (
  <image
    href={court.branding.sideGlassLeft.logoUrl}
    x={W * 0.02} y={H * 0.45} width={W * 0.16} height={H * 0.06}
    preserveAspectRatio="xMidYMid meet"
  />
)}
{court.branding.sideGlassRight && (
  <image
    href={court.branding.sideGlassRight.logoUrl}
    x={W * 0.82} y={H * 0.45} width={W * 0.16} height={H * 0.06}
    preserveAspectRatio="xMidYMid meet"
  />
)}
{court.branding.netBand && (
  <image
    href={court.branding.netBand.logoUrl}
    x={W * 0.10} y={H * 0.50} width={W * 0.80} height={H * 0.02}
    preserveAspectRatio="xMidYMid meet"
  />
)}
{court.branding.floorCenter && (
  <image
    href={court.branding.floorCenter.logoUrl}
    x={W * 0.40} y={H * 0.65} width={W * 0.20} height={W * 0.20}
    preserveAspectRatio="xMidYMid meet"
  />
)}
```

(Positions are starting defaults — Phase 2 calibration UI can later expose them as tunable, but Phase 1 spec didn't define per-slot calibration, so fixed positions are fine.)

- [ ] **Step 4:** Verify the play screen still works in the browser

Start dev server, visit `/padelgenius/play`, confirm nothing visibly changed.

- [ ] **Step 5:** Commit

```bash
git add src/app/[locale]/\(app\)/padelgenius/components/
git commit -m "refactor(padelgenius): consume active court via context; render branding slots"
```

---

## Task 7: API route — list + upload courts

**Files:**
- Create: `src/app/api/ops/padelgenius/courts/route.ts`

The `/ops/*` routes already enforce auth via the `ops_token` cookie (set by the middleware on `/ops?token=$CRON_SECRET`). Mirror that pattern.

- [ ] **Step 1:** Write the route handler

```ts
// src/app/api/ops/padelgenius/courts/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { loadAllCourts } from '@/lib/padelgenius/court-loader'
import type { CourtConfig } from '@/lib/padelgenius/types'

function assertOpsAuth() {
  const token = cookies().get('ops_token')?.value
  if (!token || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return null
}

const COURTS_DIR = path.join(process.cwd(), 'public', 'padelgenius', 'courts')

export async function GET() {
  const unauth = assertOpsAuth()
  if (unauth) return unauth
  const courts = await loadAllCourts()
  return NextResponse.json({ courts })
}

export async function POST(request: Request) {
  const unauth = assertOpsAuth()
  if (unauth) return unauth

  const form = await request.formData()
  const file = form.get('court') as File | null
  const name = (form.get('name') as string | null) ?? 'Untitled court'
  if (!file) return NextResponse.json({ error: 'missing file' }, { status: 400 })

  const slug = slugify(name) || `court-${Date.now()}`
  const dir = path.join(COURTS_DIR, slug)
  await fs.mkdir(dir, { recursive: true })

  // Save PNG
  const buf = Buffer.from(await file.arrayBuffer())
  await fs.writeFile(path.join(dir, 'court.png'), buf)

  // Auto-thumbnail 200×300
  await sharp(buf).resize(200, 300, { fit: 'cover', position: 'center' }).png().toFile(path.join(dir, 'thumb.png'))

  // Default config (not active — admin must explicitly activate)
  const config: CourtConfig = {
    name,
    active: false,
    imageUrl: `/padelgenius/courts/${slug}/court.png`,
    bounds: {
      backGlassY: 0.25, backServiceY: 0.32, netY: 0.52, nearServiceY: 0.85, nearGlassY: 0.98,
      farLeftX: 0.25, farRightX: 0.74, nearLeftX: 0.05, nearRightX: 0.96,
    },
    zones: { attackDepth: 7, transitionDepth: 17 },
    visualSystem: { playerBaseSize: 90, scaleCurveMin: 0.85, scaleCurveMax: 1.20, letterRadius: 12, progressBarTilt: -7 },
    branding: { backWall: null, sideGlassLeft: null, sideGlassRight: null, netBand: null, floorCenter: null },
  }
  await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify(config, null, 2) + '\n')

  return NextResponse.json({ slug, config })
}

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
}
```

- [ ] **Step 2:** Test via curl

```bash
# Get courts list (need to grab ops cookie first by visiting /ops?token=$CRON_SECRET in browser)
curl http://localhost:3000/api/ops/padelgenius/courts -H "Cookie: ops_token=$CRON_SECRET" | jq
```

Expected: JSON with `courts` array containing `club-deportivo`.

- [ ] **Step 3:** Commit

```bash
git add src/app/api/ops/padelgenius/courts/route.ts
git commit -m "feat(padelgenius/ops): GET list + POST upload courts API"
```

---

## Task 8: API route — single court CRUD

**Files:**
- Create: `src/app/api/ops/padelgenius/courts/[slug]/route.ts`

- [ ] **Step 1:** Write the route

```ts
// src/app/api/ops/padelgenius/courts/[slug]/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { CourtConfig } from '@/lib/padelgenius/types'

function authed() {
  const t = cookies().get('ops_token')?.value
  return !!t && t === process.env.CRON_SECRET
}

const COURTS_DIR = path.join(process.cwd(), 'public', 'padelgenius', 'courts')

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  if (!authed()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const file = path.join(COURTS_DIR, params.slug, 'config.json')
  try {
    const raw = await fs.readFile(file, 'utf-8')
    return NextResponse.json({ slug: params.slug, config: JSON.parse(raw) })
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
}

export async function PATCH(req: Request, { params }: { params: { slug: string } }) {
  if (!authed()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json() as Partial<CourtConfig>
  const file = path.join(COURTS_DIR, params.slug, 'config.json')
  let existing: CourtConfig
  try {
    existing = JSON.parse(await fs.readFile(file, 'utf-8'))
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  const merged: CourtConfig = {
    ...existing,
    ...body,
    bounds: { ...existing.bounds, ...(body.bounds ?? {}) },
    zones: { ...existing.zones, ...(body.zones ?? {}) },
    visualSystem: { ...existing.visualSystem, ...(body.visualSystem ?? {}) },
    branding: { ...existing.branding, ...(body.branding ?? {}) },
  }
  await fs.writeFile(file, JSON.stringify(merged, null, 2) + '\n')
  return NextResponse.json({ slug: params.slug, config: merged })
}

export async function DELETE(_req: Request, { params }: { params: { slug: string } }) {
  if (!authed()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const dir = path.join(COURTS_DIR, params.slug)
  try {
    // Don't allow deleting the active court
    const cfg = JSON.parse(await fs.readFile(path.join(dir, 'config.json'), 'utf-8')) as CourtConfig
    if (cfg.active) return NextResponse.json({ error: 'cannot delete active court — activate another first' }, { status: 400 })
    await fs.rm(dir, { recursive: true, force: true })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
}
```

- [ ] **Step 2:** Commit

```bash
git add src/app/api/ops/padelgenius/courts/\[slug\]/route.ts
git commit -m "feat(padelgenius/ops): per-court GET/PATCH/DELETE API"
```

---

## Task 9: API route — activate a court

**Files:**
- Create: `src/app/api/ops/padelgenius/courts/[slug]/activate/route.ts`

Activating must atomically set this court to `active: true` AND set all others to `active: false`.

- [ ] **Step 1:** Write the route

```ts
// src/app/api/ops/padelgenius/courts/[slug]/activate/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { loadAllCourts } from '@/lib/padelgenius/court-loader'

const COURTS_DIR = path.join(process.cwd(), 'public', 'padelgenius', 'courts')

export async function POST(_req: Request, { params }: { params: { slug: string } }) {
  const t = cookies().get('ops_token')?.value
  if (!t || t !== process.env.CRON_SECRET) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const all = await loadAllCourts()
  const target = all.find(c => c.slug === params.slug)
  if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 })

  await Promise.all(all.map(c => {
    const file = path.join(COURTS_DIR, c.slug, 'config.json')
    const next = { ...c.config, active: c.slug === params.slug }
    return fs.writeFile(file, JSON.stringify(next, null, 2) + '\n')
  }))

  return NextResponse.json({ slug: params.slug })
}
```

- [ ] **Step 2:** Commit

```bash
git add src/app/api/ops/padelgenius/courts/\[slug\]/activate/route.ts
git commit -m "feat(padelgenius/ops): atomic activate court API"
```

---

## Task 10: API route — sponsor logo upload

**Files:**
- Create: `src/app/api/ops/padelgenius/courts/[slug]/sponsor/route.ts`

- [ ] **Step 1:** Write the route

```ts
// src/app/api/ops/padelgenius/courts/[slug]/sponsor/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { CourtConfig, BrandingSlots } from '@/lib/padelgenius/types'

const COURTS_DIR = path.join(process.cwd(), 'public', 'padelgenius', 'courts')
type Slot = keyof BrandingSlots

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const t = cookies().get('ops_token')?.value
  if (!t || t !== process.env.CRON_SECRET) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const form = await req.formData()
  const slot = form.get('slot') as Slot | null
  const file = form.get('logo') as File | null
  const scale = parseFloat((form.get('scale') as string | null) ?? '1.0')
  if (!slot || !file) return NextResponse.json({ error: 'missing slot or logo' }, { status: 400 })

  const dir = path.join(COURTS_DIR, params.slug, 'sponsors')
  await fs.mkdir(dir, { recursive: true })
  const ext = file.name.endsWith('.svg') ? 'svg' : 'png'
  const filename = `${slot}.${ext}`
  await fs.writeFile(path.join(dir, filename), Buffer.from(await file.arrayBuffer()))

  // Update config
  const configFile = path.join(COURTS_DIR, params.slug, 'config.json')
  const cfg = JSON.parse(await fs.readFile(configFile, 'utf-8')) as CourtConfig
  cfg.branding[slot] = {
    logoUrl: `/padelgenius/courts/${params.slug}/sponsors/${filename}`,
    scale,
  }
  await fs.writeFile(configFile, JSON.stringify(cfg, null, 2) + '\n')

  return NextResponse.json({ slot, logoUrl: cfg.branding[slot]?.logoUrl, scale })
}

export async function DELETE(req: Request, { params }: { params: { slug: string } }) {
  const t = cookies().get('ops_token')?.value
  if (!t || t !== process.env.CRON_SECRET) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { slot } = await req.json() as { slot: Slot }
  const configFile = path.join(COURTS_DIR, params.slug, 'config.json')
  const cfg = JSON.parse(await fs.readFile(configFile, 'utf-8')) as CourtConfig
  cfg.branding[slot] = null
  await fs.writeFile(configFile, JSON.stringify(cfg, null, 2) + '\n')
  return NextResponse.json({ slot, removed: true })
}
```

- [ ] **Step 2:** Commit

```bash
git add src/app/api/ops/padelgenius/courts/\[slug\]/sponsor/route.ts
git commit -m "feat(padelgenius/ops): sponsor logo upload + remove API"
```

---

## Task 11: Courts library page (server-rendered)

**Files:**
- Create: `src/app/ops/padelgenius/courts/page.tsx`
- Create: `src/app/ops/padelgenius/courts/_components/CourtCard.tsx`
- Create: `src/app/ops/padelgenius/courts/_components/UploadCourtDropzone.tsx`

- [ ] **Step 1:** Write the library page

```tsx
// src/app/ops/padelgenius/courts/page.tsx
import Link from 'next/link'
import { loadAllCourts } from '@/lib/padelgenius/court-loader'
import { CourtCard } from './_components/CourtCard'
import { UploadCourtDropzone } from './_components/UploadCourtDropzone'

export const dynamic = 'force-dynamic'

export default async function CourtsLibraryPage() {
  const courts = await loadAllCourts()
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a14', color: '#e2e8f0', padding: 24 }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 12, color: '#fde047', fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase' }}>Courts · {courts.length}</div>
          <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>PadelGenius courts</h1>
        </div>
        <UploadCourtDropzone />
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
        {courts.map(c => <CourtCard key={c.slug} slug={c.slug} config={c.config} />)}
      </div>
    </div>
  )
}
```

- [ ] **Step 2:** CourtCard component

```tsx
// src/app/ops/padelgenius/courts/_components/CourtCard.tsx
'use client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { CourtConfig } from '@/lib/padelgenius/types'

export function CourtCard({ slug, config }: { slug: string; config: CourtConfig }) {
  const router = useRouter()
  const thumbUrl = `/padelgenius/courts/${slug}/thumb.png`

  const activate = async () => {
    await fetch(`/api/ops/padelgenius/courts/${slug}/activate`, { method: 'POST' })
    router.refresh()
  }
  const remove = async () => {
    if (!confirm(`Delete court "${config.name}"?`)) return
    const r = await fetch(`/api/ops/padelgenius/courts/${slug}`, { method: 'DELETE' })
    if (!r.ok) alert((await r.json()).error)
    router.refresh()
  }

  return (
    <div style={{
      background: '#0e0e1a', borderRadius: 10, padding: 10,
      border: config.active ? '2px solid #22c55e' : '1px solid #2a2a3e',
      position: 'relative',
    }}>
      {config.active && <div style={{ position: 'absolute', top: -7, left: 10, background: '#22c55e', color: '#0a0a14', fontSize: 9, fontWeight: 900, padding: '1px 8px', borderRadius: 8, letterSpacing: 0.5 }}>ACTIVE</div>}
      <div style={{ width: '100%', aspectRatio: '2/3', background: `url("${thumbUrl}") center/cover #1976b8`, borderRadius: 6, marginBottom: 8 }} />
      <div style={{ color: '#fff', fontSize: 12, fontWeight: 800 }}>{config.name}</div>
      <div style={{ color: '#94a3b8', fontSize: 10, marginBottom: 8 }}>{config.imageUrl}</div>
      <div style={{ display: 'flex', gap: 4 }}>
        <Link href={`/ops/padelgenius/courts/${slug}`} style={{ flex: 1, textAlign: 'center', background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 4, padding: '4px 0', color: '#fde047', fontSize: 10, fontWeight: 700, textDecoration: 'none' }}>EDIT</Link>
        {!config.active && <button onClick={activate} style={{ flex: 1, background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 4, padding: '4px 0', color: '#7dd3fc', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>SET ACTIVE</button>}
        {!config.active && <button onClick={remove} style={{ background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 4, padding: '4px 8px', color: '#ef4444', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>✕</button>}
      </div>
    </div>
  )
}
```

- [ ] **Step 3:** Upload dropzone

```tsx
// src/app/ops/padelgenius/courts/_components/UploadCourtDropzone.tsx
'use client'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

export function UploadCourtDropzone() {
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const onUpload = async (file: File) => {
    const name = prompt('Court name:', file.name.replace(/\.[^.]+$/, ''))
    if (!name) return
    setBusy(true)
    const fd = new FormData()
    fd.append('court', file)
    fd.append('name', name)
    const r = await fetch('/api/ops/padelgenius/courts', { method: 'POST', body: fd })
    setBusy(false)
    if (!r.ok) { alert('Upload failed'); return }
    router.refresh()
  }

  return (
    <div>
      <input ref={fileRef} type="file" accept="image/png" hidden onChange={e => e.target.files?.[0] && onUpload(e.target.files[0])} />
      <button onClick={() => fileRef.current?.click()} disabled={busy} style={{ background: '#22c55e', color: '#0a0a14', border: '1px solid #15803d', borderRadius: 6, padding: '6px 12px', fontSize: 11, fontWeight: 900, cursor: 'pointer' }}>
        {busy ? 'UPLOADING…' : '+ UPLOAD NEW'}
      </button>
    </div>
  )
}
```

- [ ] **Step 4:** Manual smoke

Visit `http://localhost:3000/ops?token=$CRON_SECRET` to set the cookie, then `http://localhost:3000/ops/padelgenius/courts`. Expected: one card for Club Deportivo with ACTIVE badge.

- [ ] **Step 5:** Commit

```bash
git add src/app/ops/padelgenius/courts/
git commit -m "feat(padelgenius/ops): courts library page"
```

---

## Task 12: Per-court editor scaffold with tabs

**Files:**
- Create: `src/app/ops/padelgenius/courts/[slug]/page.tsx`
- Create: `src/app/ops/padelgenius/courts/[slug]/CourtEditor.tsx`

- [ ] **Step 1:** Server-render the page, hydrate the editor on the client

```tsx
// src/app/ops/padelgenius/courts/[slug]/page.tsx
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { notFound } from 'next/navigation'
import { CourtEditor } from './CourtEditor'
import type { CourtConfig } from '@/lib/padelgenius/types'

export const dynamic = 'force-dynamic'

export default async function CourtEditorPage({ params }: { params: { slug: string } }) {
  const file = path.join(process.cwd(), 'public', 'padelgenius', 'courts', params.slug, 'config.json')
  let config: CourtConfig
  try { config = JSON.parse(await fs.readFile(file, 'utf-8')) } catch { return notFound() }
  return <CourtEditor slug={params.slug} initial={config} />
}
```

- [ ] **Step 2:** Editor scaffold with tabs

```tsx
// src/app/ops/padelgenius/courts/[slug]/CourtEditor.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { CourtConfig } from '@/lib/padelgenius/types'
import { DimensionsTab } from '../_components/DimensionsTab'
import { ZonesTab } from '../_components/ZonesTab'
import { BrandingTab } from '../_components/BrandingTab'

type Tab = 'dimensions' | 'zones' | 'branding'

export function CourtEditor({ slug, initial }: { slug: string; initial: CourtConfig }) {
  const [config, setConfig] = useState<CourtConfig>(initial)
  const [tab, setTab] = useState<Tab>('dimensions')
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  const save = async () => {
    setBusy(true)
    const r = await fetch(`/api/ops/padelgenius/courts/${slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    setBusy(false)
    if (!r.ok) { alert('Save failed'); return }
    router.refresh()
  }

  const reset = () => setConfig(initial)

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a14', color: '#e2e8f0', padding: 16 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <Link href="/ops/padelgenius/courts" style={{ color: '#94a3b8', textDecoration: 'none' }}>← Courts</Link>
        <h1 style={{ fontSize: 18, fontWeight: 900, margin: 0 }}>{config.name}</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button onClick={reset} style={{ background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: 6, padding: '6px 12px', color: '#aaa', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>RESET</button>
          <button onClick={save} disabled={busy} style={{ background: '#22c55e', border: '1px solid #15803d', borderRadius: 6, padding: '6px 12px', color: '#0a0a14', fontSize: 11, fontWeight: 900, cursor: 'pointer' }}>{busy ? 'SAVING…' : 'SAVE'}</button>
        </div>
      </header>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid #2a2a3e' }}>
        {(['dimensions', 'zones', 'branding'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: 'transparent', border: 'none', padding: '8px 14px',
            fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase',
            color: tab === t ? '#fde047' : '#94a3b8',
            borderBottom: tab === t ? '2px solid #fde047' : '2px solid transparent',
            cursor: 'pointer',
          }}>{t}</button>
        ))}
      </div>
      {tab === 'dimensions' && <DimensionsTab config={config} onChange={setConfig} />}
      {tab === 'zones' && <ZonesTab config={config} onChange={setConfig} />}
      {tab === 'branding' && <BrandingTab slug={slug} config={config} onChange={setConfig} />}
    </div>
  )
}
```

- [ ] **Step 3:** Commit

```bash
git add src/app/ops/padelgenius/courts/\[slug\]/
git commit -m "feat(padelgenius/ops): per-court editor scaffold + tabs"
```

---

## Task 13: SliderRow + LandmarkOverlay reusables

**Files:**
- Create: `src/app/ops/padelgenius/courts/_components/SliderRow.tsx`
- Create: `src/app/ops/padelgenius/courts/_components/LandmarkOverlay.tsx`

- [ ] **Step 1:** SliderRow

```tsx
// src/app/ops/padelgenius/courts/_components/SliderRow.tsx
'use client'
export function SliderRow({
  label, value, min, max, step, color, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number; color: string;
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 1 }}>
        <span style={{ fontSize: 10, color: '#aaa' }}>{label}</span>
        <span style={{ fontSize: 10, color: '#fff', fontFamily: 'ui-monospace,monospace' }}>{value.toFixed(3)}</span>
      </div>
      <input type="range" value={value} min={min} max={max} step={step} onChange={e => onChange(parseFloat(e.target.value))}
             style={{ width: '100%', accentColor: color }} />
    </div>
  )
}
```

- [ ] **Step 2:** LandmarkOverlay — dashed lines + corner pins over the court preview

```tsx
// src/app/ops/padelgenius/courts/_components/LandmarkOverlay.tsx
'use client'
import type { CourtBounds } from '@/lib/padelgenius/types'

export function LandmarkOverlay({ bounds }: { bounds: CourtBounds }) {
  // Each landmark renders as a horizontal dashed line + label.
  const lines: { y: number; color: string; label: string }[] = [
    { y: bounds.backGlassY,   color: '#ef4444', label: 'BACK GLASS · y=0' },
    { y: bounds.backServiceY, color: '#38c8ff', label: 'BACK SERVICE · y=33' },
    { y: bounds.netY,         color: '#22c55e', label: 'NET · y=50' },
    { y: bounds.nearServiceY, color: '#38c8ff', label: 'NEAR SERVICE · y=67' },
    { y: bounds.nearGlassY,   color: '#ef4444', label: 'NEAR GLASS · y=100' },
  ]
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      {lines.map((l, i) => (
        <g key={i}>
          <line x1="0" y1={l.y * 100} x2="100" y2={l.y * 100} stroke={l.color} strokeWidth="0.4" strokeDasharray="1.5 1" opacity="0.85" />
          <text x="1" y={l.y * 100 - 0.6} fill={l.color} fontSize="2" fontWeight="900" stroke="#fff" strokeWidth="0.4" paintOrder="stroke">{l.label}</text>
        </g>
      ))}
      {/* Yellow trapezoid */}
      <polygon
        points={`${bounds.farLeftX * 100},${bounds.backGlassY * 100} ${bounds.farRightX * 100},${bounds.backGlassY * 100} ${bounds.nearRightX * 100},${bounds.nearGlassY * 100} ${bounds.nearLeftX * 100},${bounds.nearGlassY * 100}`}
        fill="none" stroke="#fde047" strokeWidth="0.5" strokeDasharray="2 1" opacity="0.9" />
      {[[bounds.farLeftX, bounds.backGlassY], [bounds.farRightX, bounds.backGlassY], [bounds.nearLeftX, bounds.nearGlassY], [bounds.nearRightX, bounds.nearGlassY]].map(([x, y], i) => (
        <circle key={i} cx={x * 100} cy={y * 100} r="0.9" fill="#fde047" stroke="#1a1a2e" strokeWidth="0.3" />
      ))}
    </svg>
  )
}
```

- [ ] **Step 3:** Commit

```bash
git add src/app/ops/padelgenius/courts/_components/
git commit -m "feat(padelgenius/ops): SliderRow + LandmarkOverlay reusables"
```

---

## Task 14: DimensionsTab (15 sliders + live preview)

**Files:**
- Create: `src/app/ops/padelgenius/courts/_components/DimensionsTab.tsx`

- [ ] **Step 1:** Write the tab

```tsx
// src/app/ops/padelgenius/courts/_components/DimensionsTab.tsx
'use client'
import type { CourtConfig } from '@/lib/padelgenius/types'
import { SliderRow } from './SliderRow'
import { LandmarkOverlay } from './LandmarkOverlay'

export function DimensionsTab({ config, onChange }: { config: CourtConfig; onChange: (c: CourtConfig) => void }) {
  const setBound = (key: keyof CourtConfig['bounds'], v: number) => onChange({ ...config, bounds: { ...config.bounds, [key]: v } })
  const setVis   = (key: keyof CourtConfig['visualSystem'], v: number) => onChange({ ...config, visualSystem: { ...config.visualSystem, [key]: v } })

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
      {/* Live preview */}
      <div style={{ flex: '0 0 280px' }}>
        <div style={{ position: 'relative', width: '100%', aspectRatio: '2/3', background: `url("${config.imageUrl}") center/cover`, border: '2px solid #2a2a3e', borderRadius: 8, overflow: 'hidden' }}>
          <LandmarkOverlay bounds={config.bounds} />
        </div>
      </div>

      {/* Sliders */}
      <div style={{ flex: 1, fontSize: 10, color: '#aaa', minWidth: 0 }}>
        <Group title="COURT Y LANDMARKS · 5">
          <SliderRow label="back glass Y"    value={config.bounds.backGlassY}    min={0} max={1} step={0.005} color="#ef4444" onChange={v => setBound('backGlassY', v)} />
          <SliderRow label="back service Y"  value={config.bounds.backServiceY}  min={0} max={1} step={0.005} color="#38c8ff" onChange={v => setBound('backServiceY', v)} />
          <SliderRow label="net Y"           value={config.bounds.netY}          min={0} max={1} step={0.005} color="#22c55e" onChange={v => setBound('netY', v)} />
          <SliderRow label="near service Y"  value={config.bounds.nearServiceY}  min={0} max={1} step={0.005} color="#38c8ff" onChange={v => setBound('nearServiceY', v)} />
          <SliderRow label="near glass Y"    value={config.bounds.nearGlassY}    min={0} max={1} step={0.005} color="#ef4444" onChange={v => setBound('nearGlassY', v)} />
        </Group>
        <Group title="TRAPEZOID X CORNERS · 4">
          <SliderRow label="far left X"   value={config.bounds.farLeftX}   min={0} max={1} step={0.005} color="#fde047" onChange={v => setBound('farLeftX', v)} />
          <SliderRow label="far right X"  value={config.bounds.farRightX}  min={0} max={1} step={0.005} color="#fde047" onChange={v => setBound('farRightX', v)} />
          <SliderRow label="near left X"  value={config.bounds.nearLeftX}  min={0} max={1} step={0.005} color="#fde047" onChange={v => setBound('nearLeftX', v)} />
          <SliderRow label="near right X" value={config.bounds.nearRightX} min={0} max={1} step={0.005} color="#fde047" onChange={v => setBound('nearRightX', v)} />
        </Group>
        <Group title="VISUAL SYSTEM · 4 controls">
          <SliderRow label="player base size"   value={config.visualSystem.playerBaseSize}  min={40} max={160} step={2} color="#7dd3fc" onChange={v => setVis('playerBaseSize', v)} />
          <SliderRow label="scale curve min"    value={config.visualSystem.scaleCurveMin}   min={0.5} max={1.2} step={0.01} color="#7dd3fc" onChange={v => setVis('scaleCurveMin', v)} />
          <SliderRow label="scale curve max"    value={config.visualSystem.scaleCurveMax}   min={0.8} max={2.0} step={0.01} color="#7dd3fc" onChange={v => setVis('scaleCurveMax', v)} />
          <SliderRow label="letter radius"      value={config.visualSystem.letterRadius}    min={6} max={30} step={1} color="#7dd3fc" onChange={v => setVis('letterRadius', v)} />
          <SliderRow label="progress bar tilt°" value={config.visualSystem.progressBarTilt} min={-30} max={30} step={0.5} color="#7dd3fc" onChange={v => setVis('progressBarTilt', v)} />
        </Group>
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ color: '#fde047', fontSize: 10, fontWeight: 800, letterSpacing: 1, marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 5 }}>{children}</div>
    </div>
  )
}
```

- [ ] **Step 2:** Commit

```bash
git add src/app/ops/padelgenius/courts/_components/DimensionsTab.tsx
git commit -m "feat(padelgenius/ops): DimensionsTab with 14 sliders + live preview"
```

---

## Task 15: ZonesTab

**Files:**
- Create: `src/app/ops/padelgenius/courts/_components/ZonesTab.tsx`

- [ ] **Step 1:** Write the tab

```tsx
// src/app/ops/padelgenius/courts/_components/ZonesTab.tsx
'use client'
import type { CourtConfig } from '@/lib/padelgenius/types'
import { SliderRow } from './SliderRow'

export function ZonesTab({ config, onChange }: { config: CourtConfig; onChange: (c: CourtConfig) => void }) {
  const setZ = (key: keyof CourtConfig['zones'], v: number) => onChange({ ...config, zones: { ...config.zones, [key]: v } })
  const z = config.zones
  const farDefEnd     = Math.max(0, 50 - z.transitionDepth)
  const farTransEnd   = Math.max(0, 50 - z.attackDepth)
  const nearAttEnd    = Math.min(100, 50 + z.attackDepth)
  const nearTransEnd  = Math.min(100, 50 + z.transitionDepth)

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
      <div style={{ flex: '0 0 280px' }}>
        <div style={{ position: 'relative', width: '100%', aspectRatio: '2/3', background: `url("${config.imageUrl}") center/cover`, border: '2px solid #2a2a3e', borderRadius: 8, overflow: 'hidden' }}>
          {/* Zone bands */}
          <Band yTop={0}            yBot={farDefEnd}   color="rgba(52,152,219,0.30)" label="DEFENSE" />
          <Band yTop={farDefEnd}    yBot={farTransEnd} color="rgba(243,156,18,0.28)" label="TRANSITION" />
          <Band yTop={farTransEnd}  yBot={50}          color="rgba(231,76,60,0.30)"  label="ATTACK" />
          <Band yTop={50}           yBot={nearAttEnd}  color="rgba(231,76,60,0.30)"  label="ATTACK" />
          <Band yTop={nearAttEnd}   yBot={nearTransEnd} color="rgba(243,156,18,0.28)" label="TRANSITION" />
          <Band yTop={nearTransEnd} yBot={100}         color="rgba(52,152,219,0.30)" label="DEFENSE" />
        </div>
      </div>
      <div style={{ flex: 1, color: '#aaa' }}>
        <SliderRow label="attack depth (from net)"      value={z.attackDepth}     min={2} max={45} step={1} color="#ef4444" onChange={v => setZ('attackDepth', v)} />
        <div style={{ height: 8 }} />
        <SliderRow label="transition depth (from net)"  value={z.transitionDepth} min={z.attackDepth + 1} max={49} step={1} color="#f97316" onChange={v => setZ('transitionDepth', v)} />
        <div style={{ marginTop: 14, fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
          Defense → behind the service line (in real padel, this is where you defend lobs and back-wall shots).<br/>
          Transition → between service line and the attack zone.<br/>
          Attack → adjacent to the net.
        </div>
      </div>
    </div>
  )
}

function Band({ yTop, yBot, color, label }: { yTop: number; yBot: number; color: string; label: string }) {
  if (yBot - yTop < 1) return null
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0,
      top: `${yTop}%`, height: `${yBot - yTop}%`,
      background: color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontSize: 10, fontWeight: 900, letterSpacing: 1.2, textShadow: '0 1px 2px rgba(0,0,0,0.6)',
      pointerEvents: 'none',
    }}>{label}</div>
  )
}
```

- [ ] **Step 2:** Commit

```bash
git add src/app/ops/padelgenius/courts/_components/ZonesTab.tsx
git commit -m "feat(padelgenius/ops): ZonesTab with band overlay"
```

---

## Task 16: BrandingTab + SlotCard

**Files:**
- Create: `src/app/ops/padelgenius/courts/_components/BrandingTab.tsx`
- Create: `src/app/ops/padelgenius/courts/_components/SlotCard.tsx`

- [ ] **Step 1:** SlotCard

```tsx
// src/app/ops/padelgenius/courts/_components/SlotCard.tsx
'use client'
import { useRef, useState } from 'react'
import type { CourtConfig, SlotConfig, BrandingSlots } from '@/lib/padelgenius/types'

type Slot = keyof BrandingSlots

export function SlotCard({
  slug, slot, label, dimsHint, value, onChange,
}: {
  slug: string; slot: Slot; label: string; dimsHint: string;
  value: SlotConfig | null;
  onChange: (next: SlotConfig | null) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const upload = async (file: File) => {
    setBusy(true)
    const fd = new FormData()
    fd.append('slot', slot)
    fd.append('logo', file)
    fd.append('scale', String(value?.scale ?? 1.0))
    const r = await fetch(`/api/ops/padelgenius/courts/${slug}/sponsor`, { method: 'POST', body: fd })
    setBusy(false)
    if (!r.ok) { alert('Upload failed'); return }
    const j = await r.json()
    onChange({ logoUrl: j.logoUrl, scale: j.scale })
  }
  const remove = async () => {
    setBusy(true)
    await fetch(`/api/ops/padelgenius/courts/${slug}/sponsor`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot }),
    })
    setBusy(false)
    onChange(null)
  }

  const on = !!value
  return (
    <div style={{ background: '#1a1a2e', border: `2px solid ${on ? '#22c55e' : '#2a2a3e'}`, borderRadius: 8, padding: 10 }}>
      <input ref={ref} type="file" accept="image/png,image/svg+xml" hidden onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ color: '#fde047', fontSize: 10, fontWeight: 800, letterSpacing: 0.5 }}>{label}</div>
        <div style={{ background: on ? '#22c55e' : '#475569', color: on ? '#0a0a14' : '#fff', fontSize: 8, fontWeight: 900, padding: '2px 6px', borderRadius: 8 }}>{on ? 'ON' : 'OFF'}</div>
      </div>
      <div style={{ width: '100%', height: 38, background: on ? `url("${value.logoUrl}") center/contain no-repeat #0e0e1a` : '#0e0e1a', border: '1px dashed #2a2a3e', borderRadius: 4, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 10 }}>
        {!on && 'Click below to upload'}
      </div>
      <div style={{ color: '#94a3b8', fontSize: 9, marginBottom: 6 }}>{dimsHint}</div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={() => ref.current?.click()} disabled={busy} style={{ flex: 1, background: '#0e0e1a', border: '1px solid #2a2a3e', borderRadius: 4, padding: '4px 0', color: '#aaa', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>{on ? 'REPLACE' : 'UPLOAD'}</button>
        {on && <button onClick={remove} disabled={busy} style={{ flex: 1, background: '#0e0e1a', border: '1px solid #2a2a3e', borderRadius: 4, padding: '4px 0', color: '#ef4444', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>REMOVE</button>}
      </div>
      {on && (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888', fontSize: 9, marginBottom: 1 }}><span>scale</span><span style={{ color: '#fff' }}>{value.scale.toFixed(2)}×</span></div>
          <input type="range" min={0.5} max={2.0} step={0.05} value={value.scale} onChange={e => onChange({ ...value, scale: parseFloat(e.target.value) })} style={{ width: '100%', accentColor: '#7dd3fc' }} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2:** BrandingTab

```tsx
// src/app/ops/padelgenius/courts/_components/BrandingTab.tsx
'use client'
import type { CourtConfig, BrandingSlots, SlotConfig } from '@/lib/padelgenius/types'
import { SlotCard } from './SlotCard'

const SLOT_META: { slot: keyof BrandingSlots; label: string; dimsHint: string }[] = [
  { slot: 'backWall',       label: 'BACK WALL',       dimsHint: '1200 × 280 px' },
  { slot: 'sideGlassLeft',  label: 'SIDE GLASS · L',  dimsHint: '400 × 140 px' },
  { slot: 'sideGlassRight', label: 'SIDE GLASS · R',  dimsHint: '400 × 140 px' },
  { slot: 'netBand',        label: 'NET BAND',        dimsHint: '1000 × 80 px' },
  { slot: 'floorCenter',    label: 'FLOOR CENTER',    dimsHint: '400 × 400 px' },
]

export function BrandingTab({ slug, config, onChange }: { slug: string; config: CourtConfig; onChange: (c: CourtConfig) => void }) {
  const setSlot = (slot: keyof BrandingSlots, value: SlotConfig | null) =>
    onChange({ ...config, branding: { ...config.branding, [slot]: value } })

  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
      <div style={{ flex: '0 0 280px' }}>
        <div style={{ position: 'relative', width: '100%', aspectRatio: '2/3', background: `url("${config.imageUrl}") center/cover`, border: '2px solid #2a2a3e', borderRadius: 8, overflow: 'hidden' }}>
          {/* Render the same overlays the Scene uses */}
          {config.branding.backWall && <img alt="" src={config.branding.backWall.logoUrl} style={{ position: 'absolute', top: '13%', left: '18%', width: '64%', height: '7%', objectFit: 'contain' }} />}
          {config.branding.sideGlassLeft && <img alt="" src={config.branding.sideGlassLeft.logoUrl} style={{ position: 'absolute', top: '45%', left: '2%', width: '16%', height: '6%', objectFit: 'contain' }} />}
          {config.branding.sideGlassRight && <img alt="" src={config.branding.sideGlassRight.logoUrl} style={{ position: 'absolute', top: '45%', right: '2%', width: '16%', height: '6%', objectFit: 'contain' }} />}
          {config.branding.netBand && <img alt="" src={config.branding.netBand.logoUrl} style={{ position: 'absolute', top: '50%', left: '10%', width: '80%', height: '2%', objectFit: 'contain' }} />}
          {config.branding.floorCenter && <img alt="" src={config.branding.floorCenter.logoUrl} style={{ position: 'absolute', top: '65%', left: '40%', width: '20%', height: '15%', objectFit: 'contain' }} />}
        </div>
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {SLOT_META.map(m => <SlotCard key={m.slot} slug={slug} slot={m.slot} label={m.label} dimsHint={m.dimsHint} value={config.branding[m.slot]} onChange={v => setSlot(m.slot, v)} />)}
      </div>
    </div>
  )
}
```

- [ ] **Step 3:** Commit

```bash
git add src/app/ops/padelgenius/courts/_components/BrandingTab.tsx src/app/ops/padelgenius/courts/_components/SlotCard.tsx
git commit -m "feat(padelgenius/ops): BrandingTab + SlotCard"
```

---

## Task 17: Smoke test for the loader after API changes

**Files:**
- Modify: `src/lib/padelgenius/__tests__/court-loader.test.ts`

- [ ] **Step 1:** Add a test ensuring branding fields are preserved through round-trip via PATCH

```ts
// append to court-loader.test.ts
import { promises as fs } from 'node:fs'
import path from 'node:path'

it('preserves branding through a write-read round-trip', async () => {
  const file = path.join(process.cwd(), 'public', 'padelgenius', 'courts', 'club-deportivo', 'config.json')
  const original = await fs.readFile(file, 'utf-8')
  const cfg = JSON.parse(original)
  cfg.branding.backWall = { logoUrl: '/test.png', scale: 1.1 }
  await fs.writeFile(file, JSON.stringify(cfg, null, 2) + '\n')
  const all = await loadAllCourts()
  const club = all.find(c => c.slug === 'club-deportivo')!
  expect(club.config.branding.backWall).toEqual({ logoUrl: '/test.png', scale: 1.1 })
  // restore
  await fs.writeFile(file, original)
})
```

- [ ] **Step 2:** Run

```bash
npx vitest run src/lib/padelgenius/__tests__/court-loader.test.ts
```

Expected: all pass.

- [ ] **Step 3:** Commit

```bash
git add src/lib/padelgenius/__tests__/court-loader.test.ts
git commit -m "test(padelgenius): branding round-trip"
```

---

## Task 18: Manual QA checklist

- [ ] Sign in to ops: visit `http://localhost:3000/ops?token=$CRON_SECRET`.
- [ ] Visit `/ops/padelgenius/courts` — see Club Deportivo card with ACTIVE badge.
- [ ] Click EDIT — opens `/ops/padelgenius/courts/club-deportivo`. All three tabs render.
- [ ] **Dimensions tab:** slide sliders, see live overlay update on the preview. Click SAVE — refresh — values persist.
- [ ] **Zones tab:** slide attack/transition depths, bands resize on the preview, attack ≥ 2, transition > attack.
- [ ] **Branding tab:** upload a small PNG to the BACK WALL slot — appears in the slot card AND on the preview. Adjust scale slider — preview re-renders. Click REMOVE → slot empties.
- [ ] **Activate flow:** upload a new court PNG from the library page, fill in a name. Card appears with "Not calibrated yet"-ish badge (we didn't add that label — it's fine). Click SET ACTIVE → both cards refresh, new court is active.
- [ ] **Play screen reads active:** visit `/padelgenius/play` — uses the new active court's image and bounds. Switch back via the library — the play page reflects the change after a refresh.
- [ ] **Delete protection:** try to delete the active court → API returns 400.
- [ ] Lint + typecheck: `npm run lint && npx tsc --noEmit`.

- [ ] **Step 1:** Fix anything broken, commit:

```bash
git add -A
git commit -m "chore(padelgenius): QA fixes for Phase 2"
```

---

## Task 19: Open the PR

- [ ] **Step 1:**

```bash
git push -u origin feature/padelgenius-v2-phase-2
gh pr create --title "feat(padelgenius/ops): v2 Phase 2 — court management" --body "$(cat <<'EOF'
## Summary
- Implements PadelGenius v2 Phase 2 per docs/superpowers/specs/2026-05-13-padelgenius-v2-design.md (§§3.3, 5, 8.1–8.2).
- New admin routes: `/ops/padelgenius/courts` library + per-court editor with Dimensions / Zones / Branding tabs.
- New API: `GET/POST /api/ops/padelgenius/courts`, `GET/PATCH/DELETE /api/ops/padelgenius/courts/[slug]`, `POST /api/ops/padelgenius/courts/[slug]/activate`, `POST/DELETE /api/ops/padelgenius/courts/[slug]/sponsor`.
- Courts stored on disk: `public/padelgenius/courts/<slug>/court.png + config.json + thumb.png`.
- Phase 1's `DEFAULT_COURT` replaced with a server-side `loadActiveCourt()`; `ActiveCourtProvider` makes the config available to all play-screen components.
- Sponsor branding slots (5) render on top of the court in Scene.
- All endpoints protected via the existing `ops_token` cookie.

## Test plan
- [ ] CI lint + typecheck pass
- [ ] CI vitest green (court-loader tests)
- [ ] Manual QA per the plan's Task 18 checklist
- [ ] /padelgenius and /padelgenius/play unchanged from the player's perspective when the default court is active

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2:** Share the PR URL.

---

## Self-review summary

- **Spec coverage:** §3.3 (court config schema) → types extension + on-disk storage; §5 (15 calibration dimensions grouped) → DimensionsTab + ZonesTab; §8.1 (courts library) → Task 11; §8.2 (per-court editor with three tabs) → Tasks 12–16; sponsor slots → BrandingTab; branding render in Scene → Task 6. Phase 1 components consume via `useActiveCourt`.
- **Placeholders:** none. All endpoints, components, tests have real code.
- **Type consistency:** `CourtConfig`, `BrandingSlots`, `SlotConfig` defined in Task 3 and used unchanged. Slot keys are typed (`keyof BrandingSlots`) so the compiler enforces correctness across SlotCard → BrandingTab → API.
