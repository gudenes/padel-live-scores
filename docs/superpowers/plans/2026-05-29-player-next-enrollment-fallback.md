# Player Next-Enrollment Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a player has no scheduled match and no matches-derived upcoming tournament, show the next tournament they're *enrolled* in (from padelgod entry lists), rendered as Option B (name · date · Seed n · with partner + level badge).

**Architecture:** A pure resolver over (player identity, upcoming tournaments, their latest entry-list snapshots) returns the soonest enrollment. A server API route does the I/O **tournament-first** (load upcoming tournaments, then their entry-list snapshots via the indexed `tournament_id` path — never a player-first full scan). The player page lazily calls the route only as tier-3 fallback and renders the existing NEXT TOURNAMENT strip with an enriched meta line.

**Tech Stack:** Next.js 16 app-router route handler, `@supabase/supabase-js` (service key, `padelgod` schema), `vitest`, `next-intl`.

**Spec:** `docs/superpowers/specs/2026-05-29-player-next-enrollment-fallback-design.md`

**Cost note (refinement vs spec):** The spec described resolving the player's snapshot rows first. `padelgod.entry_list_snapshots` has **no index on `fip_id`/`name`** (only `(tournament_id, category, captured_at DESC)`), so a player-first query is a 1.5M-row full scan. This plan instead loads **upcoming tournaments first** (small, indexed) and queries snapshots filtered by those `tournament_id`s — identical result, indexed reads. See memory `project_supabase_cost`.

**Worktree:** `/Volumes/Crucial/dev/padel-live-scores-worktrees/player-next-enrolled-tournament` (branch `fix/player-next-enrolled-tournament`). Deps installed. Run commands from here.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/lib/next-enrollment-resolver.ts` | Pure resolver: pick soonest enrollment from snapshot+tournament rows | Create |
| `src/lib/__tests__/next-enrollment-resolver.test.ts` | Unit tests for the resolver | Create |
| `src/app/api/player/[id]/next-enrollment/route.ts` | Tournament-first I/O wrapping the resolver | Create |
| `src/app/[locale]/player/[id]/page.tsx` | Tier-3 lazy fetch + Option B strip | Modify |
| `src/messages/{en,es,pt,it,fr}.json` | `player.nextEnrollmentSeed` + `player.nextEnrollmentWith` | Modify |

---

## Task 1: Pure resolver + unit tests

**Files:**
- Create: `src/lib/next-enrollment-resolver.ts`
- Test: `src/lib/__tests__/next-enrollment-resolver.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/next-enrollment-resolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveNextEnrollment, type EntrySnapshotRow, type UpcomingTournament } from '../next-enrollment-resolver'

const NOW = new Date('2026-05-29T12:00:00Z')

function tourn(over: Partial<UpcomingTournament> & { id: string }): UpcomingTournament {
  return { id: over.id, name: over.name ?? 'T', level: over.level ?? 'major', starts_at: over.starts_at ?? '2026-05-31T00:00:00Z', ends_at: over.ends_at ?? '2026-06-02T00:00:00Z' }
}
function row(over: Partial<EntrySnapshotRow> & { tournament_id: string; scrape_job_id: string; name: string; captured_at: string }): EntrySnapshotRow {
  return { category: 'men', draw_type: 'main_draw', fip_id: null, seed: null, partner_name: null, ...over }
}

describe('resolveNextEnrollment', () => {
  it('matches by fip_id ignoring the fip- prefix mismatch', () => {
    const res = resolveNextEnrollment({
      player: { fipId: 'P000036', normalizedName: 'lucas bergamini' },
      tournaments: [tourn({ id: 't1', name: 'Italy Major' })],
      snapshots: [row({ tournament_id: 't1', scrape_job_id: 'j1', name: 'L. Bergamini', fip_id: 'fip-P000036', seed: 8, partner_name: 'Javi Garrido', captured_at: '2026-05-29T10:00:00Z' })],
      now: NOW,
    })
    expect(res?.tournamentId).toBe('t1')
    expect(res?.seed).toBe(8)
    expect(res?.partnerName).toBe('Javi Garrido')
  })

  it('honors withdrawals — only the latest scrape_job per (tournament,category) counts', () => {
    const res = resolveNextEnrollment({
      player: { fipId: 'P000036', normalizedName: 'lucas bergamini' },
      tournaments: [tourn({ id: 't1' })],
      snapshots: [
        // newer scrape no longer lists the player
        row({ tournament_id: 't1', scrape_job_id: 'j2', name: 'Someone Else', fip_id: 'P999', captured_at: '2026-05-29T11:00:00Z' }),
        // older scrape did list them
        row({ tournament_id: 't1', scrape_job_id: 'j1', name: 'L. Bergamini', fip_id: 'P000036', captured_at: '2026-05-29T09:00:00Z' }),
      ],
      now: NOW,
    })
    expect(res).toBeNull()
  })

  it('picks the soonest upcoming tournament', () => {
    const res = resolveNextEnrollment({
      player: { fipId: 'P1', normalizedName: 'x' },
      tournaments: [
        tourn({ id: 'later', starts_at: '2026-06-10T00:00:00Z', ends_at: '2026-06-12T00:00:00Z' }),
        tourn({ id: 'sooner', starts_at: '2026-05-31T00:00:00Z', ends_at: '2026-06-02T00:00:00Z' }),
      ],
      snapshots: [
        row({ tournament_id: 'later', scrape_job_id: 'a', name: 'P', fip_id: 'P1', captured_at: '2026-05-29T10:00:00Z' }),
        row({ tournament_id: 'sooner', scrape_job_id: 'b', name: 'P', fip_id: 'P1', captured_at: '2026-05-29T10:00:00Z' }),
      ],
      now: NOW,
    })
    expect(res?.tournamentId).toBe('sooner')
  })

  it('excludes tournaments that have already ended', () => {
    const res = resolveNextEnrollment({
      player: { fipId: 'P1', normalizedName: 'x' },
      tournaments: [tourn({ id: 'past', starts_at: '2026-05-01T00:00:00Z', ends_at: '2026-05-03T00:00:00Z' })],
      snapshots: [row({ tournament_id: 'past', scrape_job_id: 'a', name: 'P', fip_id: 'P1', captured_at: '2026-05-01T00:00:00Z' })],
      now: NOW,
    })
    expect(res).toBeNull()
  })

  it('falls back to normalized-name match when fip_id is absent', () => {
    const res = resolveNextEnrollment({
      player: { fipId: null, normalizedName: 'lucas bergamini' },
      tournaments: [tourn({ id: 't1' })],
      snapshots: [row({ tournament_id: 't1', scrape_job_id: 'j1', name: 'Lúcas  Bergamini', fip_id: null, captured_at: '2026-05-29T10:00:00Z' })],
      now: NOW,
    })
    expect(res?.tournamentId).toBe('t1')
  })

  it('prefers the main_draw row for seed/partner when both draws list the player', () => {
    const res = resolveNextEnrollment({
      player: { fipId: 'P1', normalizedName: 'x' },
      tournaments: [tourn({ id: 't1' })],
      snapshots: [
        row({ tournament_id: 't1', scrape_job_id: 'j1', name: 'P', fip_id: 'P1', draw_type: 'qualifying', seed: null, captured_at: '2026-05-29T10:00:00Z' }),
        row({ tournament_id: 't1', scrape_job_id: 'j1', name: 'P', fip_id: 'P1', draw_type: 'main_draw', seed: 3, partner_name: 'Mate', captured_at: '2026-05-29T10:00:00Z' }),
      ],
      now: NOW,
    })
    expect(res?.drawType).toBe('main_draw')
    expect(res?.seed).toBe(3)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/__tests__/next-enrollment-resolver.test.ts`
Expected: FAIL — `Cannot find module '../next-enrollment-resolver'`.

- [ ] **Step 3: Implement the resolver**

Create `src/lib/next-enrollment-resolver.ts`:

```ts
import { normalize } from '@/lib/player-resolver'

export interface EntrySnapshotRow {
  scrape_job_id: string
  tournament_id: string
  category: 'men' | 'women'
  draw_type: 'main_draw' | 'qualifying'
  fip_id: string | null
  name: string
  seed: number | null
  partner_name: string | null
  captured_at: string
}

export interface UpcomingTournament {
  id: string
  name: string | null
  level: string | null
  starts_at: string | null
  ends_at: string | null
}

export interface PlayerIdentity {
  /** Raw FIP id from public.players, e.g. 'P000036' (no fip- prefix). */
  fipId: string | null
  /** public.players.normalized_name. */
  normalizedName: string | null
}

export interface NextEnrollment {
  tournamentId: string
  name: string | null
  level: string | null
  startsAt: string | null
  endsAt: string | null
  seed: number | null
  partnerName: string | null
  drawType: 'main_draw' | 'qualifying'
}

const stripFip = (s: string | null): string | null =>
  s == null ? null : s.replace(/^fip-/, '')

/**
 * Pick the soonest upcoming tournament the player is currently enrolled in.
 * Pure: caller supplies snapshot rows (already restricted to the upcoming
 * tournaments) and the tournament metadata. Honors withdrawals by keeping
 * only the latest scrape_job per (tournament_id, category).
 */
export function resolveNextEnrollment(args: {
  player: PlayerIdentity
  snapshots: EntrySnapshotRow[]
  tournaments: UpcomingTournament[]
  now: Date
}): NextEnrollment | null {
  const { player, snapshots, tournaments, now } = args

  // Upcoming tournaments only (ends_at in the future), indexed by id.
  const tournById = new Map<string, UpcomingTournament>()
  for (const t of tournaments) {
    if (!t.ends_at || new Date(t.ends_at) > now) tournById.set(t.id, t)
  }
  if (tournById.size === 0) return null

  // Keep only rows from the latest scrape_job per (tournament_id, category).
  const latestJob = new Map<string, { jobId: string; capturedAt: string }>()
  for (const r of snapshots) {
    if (!tournById.has(r.tournament_id)) continue
    const key = `${r.tournament_id}::${r.category}`
    const cur = latestJob.get(key)
    if (!cur || r.captured_at > cur.capturedAt) {
      latestJob.set(key, { jobId: r.scrape_job_id, capturedAt: r.captured_at })
    }
  }
  const isLatest = (r: EntrySnapshotRow) =>
    latestJob.get(`${r.tournament_id}::${r.category}`)?.jobId === r.scrape_job_id

  // Match the player within the latest rows.
  const wantFip = stripFip(player.fipId)
  const wantName = player.normalizedName
  const matches = snapshots.filter((r) => {
    if (!isLatest(r)) return false
    if (wantFip && stripFip(r.fip_id) === wantFip) return true
    if (wantName && r.fip_id == null && normalize(r.name) === wantName) return true
    // Name fallback also applies when the row HAS a fip_id but it didn't
    // match above (different player) — so only match-by-name when fip is null
    // on the row to avoid cross-matching. Covered by the guard above.
    return false
  })
  if (matches.length === 0) return null

  // Group matched rows by tournament; choose soonest by starts_at.
  const byTourn = new Map<string, EntrySnapshotRow[]>()
  for (const r of matches) {
    const arr = byTourn.get(r.tournament_id) ?? []
    arr.push(r)
    byTourn.set(r.tournament_id, arr)
  }

  let best: { t: UpcomingTournament; rows: EntrySnapshotRow[] } | null = null
  for (const [tid, rows] of byTourn) {
    const t = tournById.get(tid)
    if (!t) continue
    if (best === null) { best = { t, rows }; continue }
    const a = t.starts_at ? new Date(t.starts_at).getTime() : Infinity
    const b = best.t.starts_at ? new Date(best.t.starts_at).getTime() : Infinity
    if (a < b) best = { t, rows }
  }
  if (best === null) return null

  // Prefer the main_draw row for seed/partner; else first row.
  const chosen = best.rows.find((r) => r.draw_type === 'main_draw') ?? best.rows[0]

  return {
    tournamentId: best.t.id,
    name: best.t.name,
    level: best.t.level,
    startsAt: best.t.starts_at,
    endsAt: best.t.ends_at,
    seed: chosen.seed,
    partnerName: chosen.partner_name,
    drawType: chosen.draw_type,
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/__tests__/next-enrollment-resolver.test.ts`
Expected: PASS (6 passing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/next-enrollment-resolver.ts src/lib/__tests__/next-enrollment-resolver.test.ts
git commit -m "feat(player): pure resolver for next-enrollment fallback"
```

---

## Task 2: API route (tournament-first I/O)

**Files:**
- Create: `src/app/api/player/[id]/next-enrollment/route.ts`

- [ ] **Step 1: Implement the route**

Create `src/app/api/player/[id]/next-enrollment/route.ts`:

```ts
// GET /api/player/[id]/next-enrollment
//
// Tier-3 fallback for the player profile "next appointment" strip: the next
// tournament the player is ENROLLED in (padelgod entry lists), used only when
// they have no scheduled match and no matches-derived upcoming tournament.
//
// Cost: queries entry_list_snapshots TOURNAMENT-FIRST (filtered by the small
// set of upcoming tournament ids — the indexed path), never player-first
// (fip_id/name are unindexed → full scan). See the resolver + cost memory.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  resolveNextEnrollment,
  type EntrySnapshotRow,
  type UpcomingTournament,
} from '@/lib/next-enrollment-resolver'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // 1. Player identity.
  const { data: player, error: playerErr } = await supabase
    .from('players')
    .select('fip_id, normalized_name')
    .eq('id', id)
    .maybeSingle()
  if (playerErr) {
    return NextResponse.json({ error: `players read: ${playerErr.message}` }, { status: 500 })
  }
  const fipId = (player?.fip_id as string | null) ?? null
  const normalizedName = (player?.normalized_name as string | null) ?? null
  if (!fipId && !normalizedName) return jsonNoCache({ enrollment: null })

  // 2. Upcoming tournaments (small, indexed).
  const nowIso = new Date().toISOString()
  const { data: tournaments, error: tourErr } = await supabase
    .from('tournaments')
    .select('id, name, level, starts_at, ends_at')
    .gt('ends_at', nowIso)
    .order('starts_at', { ascending: true })
  if (tourErr) {
    return NextResponse.json({ error: `tournaments read: ${tourErr.message}` }, { status: 500 })
  }
  const upcoming = (tournaments ?? []) as UpcomingTournament[]
  if (upcoming.length === 0) return jsonNoCache({ enrollment: null })

  // 3. Entry-list snapshots for those tournaments (tournament_id is indexed).
  const upcomingIds = upcoming.map((t) => t.id)
  const { data: snaps, error: snapErr } = await supabase
    .schema('padelgod')
    .from('entry_list_snapshots')
    .select('scrape_job_id, tournament_id, category, draw_type, fip_id, name, seed, partner_name, captured_at')
    .in('tournament_id', upcomingIds)
    .order('captured_at', { ascending: false })
  if (snapErr) {
    return NextResponse.json({ error: `entry_list_snapshots read: ${snapErr.message}` }, { status: 500 })
  }

  const enrollment = resolveNextEnrollment({
    player: { fipId, normalizedName },
    snapshots: (snaps ?? []) as EntrySnapshotRow[],
    tournaments: upcoming,
    now: new Date(),
  })

  return jsonNoCache({ enrollment })
}

function jsonNoCache(body: unknown): NextResponse {
  // Per-player + enrollment changes slowly; a short private cache is fine.
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'private, max-age=300' },
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/player/[id]/next-enrollment/route.ts
git commit -m "feat(player): next-enrollment API route (tournament-first reads)"
```

---

## Task 3: i18n keys (5 locales)

**Files:**
- Modify: `src/messages/en.json`, `es.json`, `pt.json`, `it.json`, `fr.json`

- [ ] **Step 1: Add the two keys to each locale's `player` namespace**

Add these keys inside the `"player"` object of each file (place after `"noMatchesForSeason"`). Values per locale:

- `en.json`:
```json
    "nextEnrollmentSeed": "Seed {n}",
    "nextEnrollmentWith": "with {partner}"
```
- `es.json`:
```json
    "nextEnrollmentSeed": "Cabeza de serie {n}",
    "nextEnrollmentWith": "con {partner}"
```
- `pt.json`:
```json
    "nextEnrollmentSeed": "Cabeça de série {n}",
    "nextEnrollmentWith": "com {partner}"
```
- `it.json`:
```json
    "nextEnrollmentSeed": "Testa di serie {n}",
    "nextEnrollmentWith": "con {partner}"
```
- `fr.json`:
```json
    "nextEnrollmentSeed": "Tête de série {n}",
    "nextEnrollmentWith": "avec {partner}"
```

Ensure you add a comma after the preceding key so the JSON stays valid. Do NOT reorder or touch other keys.

- [ ] **Step 2: Verify JSON validity**

Run: `for f in en es pt it fr; do node -e "JSON.parse(require('fs').readFileSync('src/messages/$f.json','utf8'))" && echo "$f ok"; done`
Expected: `en ok` … `fr ok` (no parse errors).

- [ ] **Step 3: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "i18n(player): seed + partner fragments for next-enrollment strip (5 locales)"
```

---

## Task 4: Client orchestration + Option B display

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx`

- [ ] **Step 1: Add enrollment state + tier-3 lazy fetch**

Near the other `useState` hooks in the component, add:
```tsx
  const [enrollment, setEnrollment] = useState<{
    tournamentId: string
    name: string | null
    level: string | null
    startsAt: string | null
    seed: number | null
    partnerName: string | null
  } | null>(null)
```

After the `derived` `useMemo` (and the existing year `useEffect`), add an effect that fires ONLY when both higher tiers are empty:
```tsx
  useEffect(() => {
    // Tier 3: only when there's no scheduled match and no matches-derived
    // upcoming tournament. Fires the network call exactly in the case we fix.
    if (derived.nextScheduled || derived.nextTournament) { setEnrollment(null); return }
    let cancelled = false
    fetch(`/api/player/${id}/next-enrollment`)
      .then((r) => (r.ok ? r.json() : { enrollment: null }))
      .then((d) => { if (!cancelled) setEnrollment(d.enrollment ?? null) })
      .catch(() => { if (!cancelled) setEnrollment(null) })
    return () => { cancelled = true }
  }, [id, derived.nextScheduled, derived.nextTournament])
```

- [ ] **Step 2: Render the Option B strip when enrollment is present**

In the "Next match / tournament strip" block, the outer guard is currently:
```tsx
          {(derived.nextScheduled || derived.nextTournament) && (() => {
```
Add an enrollment branch AFTER that block (a sibling), so it only renders when the tiered values are absent. Immediately after the closing `})()}` of the existing block, add:

```tsx
          {!derived.nextScheduled && !derived.nextTournament && enrollment && (() => {
            const dateStr = enrollment.startsAt
              ? format.dateTime(new Date(enrollment.startsAt), DATE_WITH_WEEKDAY)
              : null
            const meta = [
              dateStr,
              enrollment.seed != null ? tPlayer('nextEnrollmentSeed', { n: enrollment.seed }) : null,
              enrollment.partnerName ? tPlayer('nextEnrollmentWith', { partner: enrollment.partnerName }) : null,
            ].filter(Boolean).join(' · ')
            return (
              <div
                onClick={() => router.push(`/tournaments/${enrollment.tournamentId}` as Parameters<typeof router.push>[0])}
                style={{
                  marginTop: 8, background: 'rgba(245,166,35,0.07)',
                  border: '1px solid rgba(245,166,35,0.18)', borderRadius: 6,
                  padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8,
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 7, fontWeight: 700, color: ORANGE, textTransform: 'uppercase', letterSpacing: 0.8, flexShrink: 0 }}>
                  {tPlayer('nextTournament')}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {titleCase(enrollment.name ?? '')}
                  </div>
                  {meta && <div style={{ fontSize: 8, color: MUTED, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta}</div>}
                </div>
                {enrollment.level && (
                  <div style={{ fontSize: 7, fontWeight: 800, color: '#000', background: ORANGE, padding: '2px 6px', clipPath: CHUNKY.badge, flexShrink: 0 }}>
                    {levelLabel(enrollment.level)}
                  </div>
                )}
              </div>
            )
          })()}
```

- [ ] **Step 3: Verify `useState`/`useEffect` are imported**

They are already used in this file (the year-default effect + existing state). No import change expected. If `useState` or `useEffect` is somehow not imported, add it to the existing `import { ... } from 'react'` line.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/player/[id]/page.tsx
git commit -m "feat(player): tier-3 enrollment fallback strip (Option B)"
```

---

## Task 5: Manual verification

- [ ] **Step 1: Verify in the browser via the preview tools**

Start the dev server, navigate to Lucas Bergamini's player page (id `43ac372d-0293-4791-9292-201e985e2ce6`), and confirm:
- The strip renders **NEXT TOURNAMENT → Italy Major**, meta line `Sun, 31 May · Seed 8 · with Javi Garrido` (or whatever the current entry list holds), MAJOR badge.
- A player WITH a scheduled match still shows NEXT MATCH and the `/api/player/[id]/next-enrollment` call does NOT fire (check the network panel).

Use the preview tools (preview_start, preview_snapshot, preview_network, preview_screenshot). Capture a screenshot as proof.

---

## Notes for the implementer
- Run from the feature worktree. Deps are installed.
- `normalize` is `@/lib/player-resolver`. `DATE_WITH_WEEKDAY` is `@/lib/format-patterns`. `ORANGE`, `MUTED`, `CHUNKY`, `titleCase`, `levelLabel`, `tPlayer`, `format`, `router` are already in scope in the player page.
- The resolver is the only unit-tested piece; the route is thin I/O and the page change is presentational, verified manually in the browser.
- Do NOT change the existing `nextScheduled` / `nextTournament` tiers — the enrollment branch is purely additive.
