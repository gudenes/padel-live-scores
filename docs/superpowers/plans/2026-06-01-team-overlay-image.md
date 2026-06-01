# Team Overlay Image — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin tool that overlaps two players' transparent portrait cut-outs into a single transparent PNG and lets the operator download it — pick two players, one click, download.

**Architecture:** Server-side `sharp` composition (already a dep in `apps/ops`, `^0.34.5`) behind an operator-gated API route, driven by a small client page that reuses the existing player-search API. The core compositor is a pure, unit-tested function; the route looks up `photo_url`, downloads both PNGs, composites, and returns `image/png`; the page previews the blob and downloads it. Nothing is persisted.

**Tech Stack:** TypeScript, Next.js 16 (`apps/ops` admin app), `sharp`, Vitest (node env), Supabase (read `players.photo_url`), Auth.js (operator gate).

**Spec:** `docs/superpowers/specs/2026-06-01-team-overlay-image-design.md`

**Branch:** built on `feat/player-photo-capture` (per user — merged later, after deploy). All paths below are inside `apps/ops/`.

**Prerequisite (already true):** `players.photo_url` exists in the production DB and is populated for some top players (Coello, Tapia, Triay, Brea, Chingotto, Galán, Paula, Beatriz). The FIP portraits are transparent cut-outs, so no background removal is needed.

---

## File Structure

| File | Responsibility | Create/Modify |
|---|---|---|
| `apps/ops/src/lib/team-overlay.ts` | Pure `composeTeamOverlay(bufA, bufB)` compositor | Create |
| `apps/ops/src/lib/__tests__/team-overlay.test.ts` | Unit tests for the compositor | Create |
| `apps/ops/src/app/api/internal/team-image/route.ts` | Operator-gated POST: lookup → download → compose → PNG | Create |
| `apps/ops/src/app/api/internal/search-players/route.ts` | Add `photo_url` to the SELECT so the picker can flag missing photos | Modify |
| `apps/ops/src/app/(app)/team-image/page.tsx` | Client page: two pickers + Generate + preview + Download | Create |
| `apps/ops/src/components/shell/Rail.tsx` | Add a nav item for the tool | Modify |

Test command (all): `cd apps/ops && npx vitest run`
Typecheck: `cd apps/ops && npx tsc --noEmit`
Vitest picks up `src/**/__tests__/**/*.test.ts` with `environment: 'node'` and `globals: false` (so tests import `{ describe, it, expect }` from `vitest`).

---

## Task 1: Composition library `composeTeamOverlay`

**Files:**
- Create: `apps/ops/src/lib/team-overlay.ts`
- Test: `apps/ops/src/lib/__tests__/team-overlay.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/ops/src/lib/__tests__/team-overlay.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { composeTeamOverlay } from '../team-overlay'

// Build a transparent WxH PNG with an opaque rw×rh rectangle centered inside,
// so trim() crops it down to exactly rw×rh of the given color.
async function fig(W: number, H: number, rw: number, rh: number, color: { r: number; g: number; b: number }): Promise<Buffer> {
  const rect = await sharp({ create: { width: rw, height: rh, channels: 4, background: { ...color, alpha: 1 } } }).png().toBuffer()
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: rect, left: Math.floor((W - rw) / 2), top: Math.floor((H - rh) / 2) }])
    .png()
    .toBuffer()
}

async function pixel(buf: Buffer, x: number, y: number): Promise<[number, number, number, number]> {
  const { data } = await sharp(buf).ensureAlpha().extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true })
  return [data[0]!, data[1]!, data[2]!, data[3]!]
}

describe('composeTeamOverlay', () => {
  it('overlaps two trimmed figures into a transparent PNG of the expected size, second in front', async () => {
    const a = await fig(200, 400, 80, 300, { r: 255, g: 0, b: 0 })   // trims to 80×300 (red)
    const b = await fig(160, 360, 100, 300, { r: 0, g: 0, b: 255 })  // trims to 100×300 (blue)
    const out = await composeTeamOverlay(a, b, { overlapFraction: 0.25 })
    const m = await sharp(out).metadata()
    // both already 300 tall → targetH 300; wA=80, wB=100; overlap=round(100*0.25)=25
    expect(m.height).toBe(300)
    expect(m.width).toBe(80 + 100 - 25) // 155
    expect(m.hasAlpha).toBe(true)
    // A-only region (left), B-only region (right), and overlap (B in front):
    const [ar] = await pixel(out, 20, 150); expect(ar).toBeGreaterThan(200)       // red dominant
    const bOnly = await pixel(out, 130, 150); expect(bOnly[2]).toBeGreaterThan(200) // blue dominant
    const overlap = await pixel(out, 70, 150); expect(overlap[2]).toBeGreaterThan(200) // blue (B front)
  })

  it('swapping inputs puts the other player in front', async () => {
    const a = await fig(200, 400, 80, 300, { r: 255, g: 0, b: 0 })
    const b = await fig(160, 360, 100, 300, { r: 0, g: 0, b: 255 })
    const out = await composeTeamOverlay(b, a, { overlapFraction: 0.25 }) // a now in front
    // front figure (a, red) is on the right; overlap region near the seam shows red
    const m = await sharp(out).metadata()
    expect(m.width).toBe(100 + 80 - Math.round(80 * 0.25)) // 100+80-20 = 160
    const overlap = await pixel(out, 95, 150); expect(overlap[0]).toBeGreaterThan(200) // red (a front)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/ops && npx vitest run src/lib/__tests__/team-overlay.test.ts`
Expected: FAIL — `composeTeamOverlay` not found (module doesn't exist).

- [ ] **Step 3: Implement the compositor**

Create `apps/ops/src/lib/team-overlay.ts`:

```ts
// apps/ops/src/lib/team-overlay.ts
// Deterministic compositor: overlap two transparent player cut-out PNGs into a
// single transparent PNG. No background, no text. Used by the team-image route.
import sharp from 'sharp'

export interface TeamOverlayOptions {
  /** Fraction of the FRONT figure's width that overlaps the back figure. */
  overlapFraction?: number
}

const DEFAULT_OVERLAP = 0.28

/**
 * Composite two transparent cut-out portraits, overlapping, onto a transparent
 * canvas cropped tight to the figures. `bufB` (the second player) is placed in
 * FRONT. Both inputs are trimmed of transparent margins and normalized to the
 * SMALLER of the two trimmed heights (downscale-only → no quality loss).
 * Returns a PNG buffer with alpha preserved.
 */
export async function composeTeamOverlay(
  bufA: Buffer,
  bufB: Buffer,
  options: TeamOverlayOptions = {},
): Promise<Buffer> {
  const overlapFraction = options.overlapFraction ?? DEFAULT_OVERLAP

  // 1. Trim transparent margins to tight figure bounds.
  const trimmedA = await sharp(bufA).trim().png().toBuffer()
  const trimmedB = await sharp(bufB).trim().png().toBuffer()
  const metaA = await sharp(trimmedA).metadata()
  const metaB = await sharp(trimmedB).metadata()

  // 2. Normalize both to equal height = smaller trimmed height (downscale-only).
  const targetH = Math.min(metaA.height ?? 0, metaB.height ?? 0)
  if (!targetH) throw new Error('team-overlay: a source image has zero height after trim')
  const figA = await sharp(trimmedA).resize({ height: targetH }).png().toBuffer()
  const figB = await sharp(trimmedB).resize({ height: targetH }).png().toBuffer()
  const wA = (await sharp(figA).metadata()).width ?? 0
  const wB = (await sharp(figB).metadata()).width ?? 0

  // 3. Overlap by a fraction of the front figure's width.
  const overlapPx = Math.round(wB * overlapFraction)
  const canvasW = wA + wB - overlapPx

  // 4. Composite onto a transparent canvas; figB (second player) painted last → in front.
  return sharp({
    create: { width: canvasW, height: targetH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: figA, left: 0, top: 0 },
      { input: figB, left: wA - overlapPx, top: 0 },
    ])
    .png()
    .toBuffer()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/ops && npx vitest run src/lib/__tests__/team-overlay.test.ts`
Expected: PASS (2 tests). Then `cd apps/ops && npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/lib/team-overlay.ts apps/ops/src/lib/__tests__/team-overlay.test.ts
git commit -m "feat(ops): add composeTeamOverlay compositor for team images"
```

---

## Task 2: Operator-gated API route

**Files:**
- Create: `apps/ops/src/app/api/internal/team-image/route.ts`

(No unit test — the route needs auth + Supabase + network; it's covered by the unit-tested compositor and the manual verification in Task 5. Keep the route thin.)

- [ ] **Step 1: Implement the route**

Create `apps/ops/src/app/api/internal/team-image/route.ts`:

```ts
// apps/ops/src/app/api/internal/team-image/route.ts
// Operator-gated: overlap two players' portraits into a transparent PNG.
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { composeTeamOverlay } from '@/lib/team-overlay'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { playerAId?: string; playerBId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { playerAId, playerBId } = body
  if (!playerAId || !playerBId) return NextResponse.json({ error: 'missing_players' }, { status: 400 })
  if (playerAId === playerBId) return NextResponse.json({ error: 'same_player' }, { status: 400 })

  const supabase = serviceClient()
  const { data: players, error } = await supabase
    .from('players')
    .select('id, name, photo_url')
    .in('id', [playerAId, playerBId])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const a = players?.find((p) => p.id === playerAId)
  const b = players?.find((p) => p.id === playerBId)
  if (!a || !b) return NextResponse.json({ error: 'player_not_found' }, { status: 404 })

  const missing = [a, b].filter((p) => !p.photo_url).map((p) => p.name)
  if (missing.length) return NextResponse.json({ error: 'missing_photo', players: missing }, { status: 400 })

  let bufA: Buffer
  let bufB: Buffer
  try {
    const [ra, rb] = await Promise.all([fetch(a.photo_url as string), fetch(b.photo_url as string)])
    if (!ra.ok || !rb.ok) throw new Error('download failed')
    bufA = Buffer.from(await ra.arrayBuffer())
    bufB = Buffer.from(await rb.arrayBuffer())
  } catch {
    return NextResponse.json({ error: 'download_failed' }, { status: 502 })
  }

  const png = await composeTeamOverlay(bufA, bufB)
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/ops && npx tsc --noEmit`
Expected: clean. (If `serviceClient`/`auth` import paths differ, confirm against `apps/ops/src/app/api/internal/search-players/route.ts`, which uses `import { auth } from '@/lib/auth'` and `import { serviceClient } from '@/lib/supabase'`.)

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/api/internal/team-image/route.ts
git commit -m "feat(ops): add /api/internal/team-image route"
```

---

## Task 3: Expose `photo_url` in player search

**Files:**
- Modify: `apps/ops/src/app/api/internal/search-players/route.ts`

- [ ] **Step 1: Add `photo_url` to the SELECT**

In `apps/ops/src/app/api/internal/search-players/route.ts`, the select currently reads:

```ts
    .select('id, name, display_name, country, ranking, points, category, avatar_url, fip_id', { count: 'exact' })
```

Change it to add `photo_url`:

```ts
    .select('id, name, display_name, country, ranking, points, category, avatar_url, photo_url, fip_id', { count: 'exact' })
```

Nothing else changes — the `players` array in the JSON response now carries `photo_url`, which the picker uses to flag players without a photo.

- [ ] **Step 2: Typecheck**

Run: `cd apps/ops && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/api/internal/search-players/route.ts
git commit -m "feat(ops): include photo_url in player search results"
```

---

## Task 4: Team Image page + nav

**Files:**
- Create: `apps/ops/src/app/(app)/team-image/page.tsx`
- Modify: `apps/ops/src/components/shell/Rail.tsx`

- [ ] **Step 1: Create the page**

Create `apps/ops/src/app/(app)/team-image/page.tsx`:

```tsx
'use client'
/* eslint-disable @next/next/no-img-element */
// apps/ops/src/app/(app)/team-image/page.tsx
// Pick two players → overlap their portraits into a transparent PNG → download.
import { useEffect, useRef, useState } from 'react'

type PlayerLite = {
  id: string
  name: string
  display_name: string | null
  photo_url: string | null
}

// CSS checkerboard so the transparent result reads in the preview.
const CHECKER: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg,#cdd2d8 25%,transparent 25%),linear-gradient(-45deg,#cdd2d8 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#cdd2d8 75%),linear-gradient(-45deg,transparent 75%,#cdd2d8 75%)',
  backgroundSize: '24px 24px',
  backgroundPosition: '0 0,0 12px,12px -12px,-12px 0',
  backgroundColor: '#e9ebee',
}

function PlayerPicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: PlayerLite | null
  onChange: (p: PlayerLite | null) => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PlayerLite[]>([])
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!q.trim()) {
      setResults([])
      return
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const res = await fetch(`/api/internal/search-players?q=${encodeURIComponent(q)}&per_page=8`)
      if (!res.ok) return
      const json = await res.json()
      setResults(json.players ?? [])
      setOpen(true)
    }, 250)
  }, [q])

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>{label}</div>
      {value ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, border: '1px solid var(--border-card)', borderRadius: 8, background: 'var(--bg-card)' }}>
          {value.photo_url ? (
            <img src={value.photo_url} alt="" style={{ width: 40, height: 50, objectFit: 'cover', borderRadius: 6 }} />
          ) : (
            <div style={{ width: 40, height: 50, borderRadius: 6, background: 'var(--bg-hover)' }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: 'var(--text-1)', fontSize: 14 }}>{value.display_name ?? value.name}</div>
            {!value.photo_url && <div style={{ color: '#e5484d', fontSize: 12 }}>No photo — can’t use</div>}
          </div>
          <button onClick={() => onChange(null)} style={{ fontSize: 12, color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer' }}>
            Change
          </button>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search player…"
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-card)', background: 'var(--bg-card)', color: 'var(--text-1)' }}
          />
          {open && results.length > 0 && (
            <div style={{ position: 'absolute', zIndex: 10, top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 8, overflow: 'hidden' }}>
              {results.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    onChange(p)
                    setOpen(false)
                    setQ('')
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: 8, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--text-1)' }}
                >
                  {p.photo_url ? (
                    <img src={p.photo_url} alt="" style={{ width: 28, height: 34, objectFit: 'cover', borderRadius: 4 }} />
                  ) : (
                    <div style={{ width: 28, height: 34, borderRadius: 4, background: 'var(--bg-hover)' }} />
                  )}
                  <span style={{ fontSize: 13 }}>{p.display_name ?? p.name}</span>
                  {!p.photo_url && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>no photo</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function TeamImagePage() {
  const [a, setA] = useState<PlayerLite | null>(null)
  const [b, setB] = useState<PlayerLite | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imgUrl, setImgUrl] = useState<string | null>(null)

  const canGenerate = !!a?.photo_url && !!b?.photo_url && a.id !== b.id && !loading

  async function generate() {
    if (!a || !b) return
    setLoading(true)
    setError(null)
    if (imgUrl) {
      URL.revokeObjectURL(imgUrl)
      setImgUrl(null)
    }
    try {
      const res = await fetch('/api/internal/team-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerAId: a.id, playerBId: b.id }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error === 'missing_photo' ? `No photo for: ${(j.players ?? []).join(', ')}` : (j.error ?? `HTTP ${res.status}`))
        return
      }
      const blob = await res.blob()
      setImgUrl(URL.createObjectURL(blob))
    } catch {
      setError('Something went wrong generating the image.')
    } finally {
      setLoading(false)
    }
  }

  const slug = (n: string) => n.replace(/\s+/g, '-').toLowerCase()
  const fileName = `team-${slug(a?.name ?? 'a')}-${slug(b?.name ?? 'b')}.png`

  return (
    <div className="ui-page">
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>Team Image</h1>
      <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>Pick two players to overlap their photos into a transparent PNG.</p>

      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <PlayerPicker label="Player 1 (back)" value={a} onChange={setA} />
        <PlayerPicker label="Player 2 (front)" value={b} onChange={setB} />
      </div>

      <button
        onClick={generate}
        disabled={!canGenerate}
        style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid var(--border-card)', background: canGenerate ? '#6abf3a' : 'var(--bg-hover)', color: canGenerate ? '#0a0b0d' : 'var(--text-3)', fontWeight: 600, cursor: canGenerate ? 'pointer' : 'not-allowed' }}
      >
        {loading ? 'Generating…' : 'Generate'}
      </button>
      {a && b && a.id === b.id && <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-3)' }}>Pick two different players.</span>}
      {error && <div style={{ marginTop: 12, fontSize: 13, color: '#e5484d' }}>{error}</div>}

      {imgUrl && (
        <div style={{ marginTop: 24 }}>
          <div style={{ ...CHECKER, display: 'inline-block', padding: 16, borderRadius: 12, border: '1px solid var(--border-card)' }}>
            <img src={imgUrl} alt="Team composite" style={{ maxHeight: 460, display: 'block' }} />
          </div>
          <div style={{ marginTop: 12 }}>
            <a href={imgUrl} download={fileName} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border-card)', background: 'var(--bg-card)', color: 'var(--text-1)', textDecoration: 'none', fontSize: 13 }}>
              Download PNG
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add the nav item**

In `apps/ops/src/components/shell/Rail.tsx`, find the `Content` group:

```tsx
  { label: 'Content', items: [
    { href: '/news', label: 'News', icon: 'doc' },
    { href: '/news-sources', label: 'News Sources', icon: 'list' },
    { href: '/highlights', label: 'Highlights', icon: 'film' },
  ]},
```

Add a Team Image item to it:

```tsx
  { label: 'Content', items: [
    { href: '/news', label: 'News', icon: 'doc' },
    { href: '/news-sources', label: 'News Sources', icon: 'list' },
    { href: '/highlights', label: 'Highlights', icon: 'film' },
    { href: '/team-image', label: 'Team Image', icon: 'film' },
  ]},
```

(`film` is a valid icon name in `IconSprite.tsx`; reuse is fine.)

- [ ] **Step 3: Typecheck**

Run: `cd apps/ops && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "apps/ops/src/app/(app)/team-image/page.tsx" apps/ops/src/components/shell/Rail.tsx
git commit -m "feat(ops): add Team Image tool page + nav item"
```

---

## Task 5: Manual verification in the running admin app

**Files:** none (verification only). Per repo memory (`feedback_test-locally.md`): verify previewable changes in the running app before calling the work done.

- [ ] **Step 1: Start the admin app** (if not already running)

Run: `cd apps/ops && npm run dev` (port 3004).

- [ ] **Step 2: Open the tool**

Navigate to `http://localhost:3004/team-image` (log in as operator if prompted). Confirm "Team Image" appears in the rail under Content.

- [ ] **Step 3: Happy path**

Search and pick two players who have photos (e.g. **Coello** and **Tapia**). Confirm each picker shows the portrait thumbnail. Click **Generate**. Expected: a preview appears on the checkerboard showing the two figures overlapped, second pick in front. Click **Download PNG** and open the file — confirm the background is truly transparent (not white).

- [ ] **Step 4: Guard paths**

- Pick the same player in both → Generate disabled, "Pick two different players." hint.
- Pick a player with **no** photo (search an obscure/low-ranked player) → that picker shows "No photo — can’t use" and Generate stays disabled.

- [ ] **Step 5: Full check**

Run: `cd apps/ops && npx vitest run && npx tsc --noEmit`
Expected: all green.

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** compositor (T1), route incl. missing-photo/download guards (T2), picker photo flag via search (T3), one-click UI + preview + download + rail (T4), manual verify incl. transparency + guards (T5). Every spec section maps to a task.
- **Defaults match spec:** equal-height (min trimmed height, downscale-only), 0.28 overlap, second player in front, tight transparent crop, no storage/text/background.
- **Type consistency:** `composeTeamOverlay(bufA, bufB, options?)` defined in T1 is called the same way in T2; `PlayerLite` (with `photo_url`) in T4 matches the `photo_url` added to search results in T3.
- **No new deps:** `sharp` already in `apps/ops` (`^0.34.5`).
