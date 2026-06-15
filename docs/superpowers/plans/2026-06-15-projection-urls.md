# Projection URLs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the tournament Projection (road-to-title) tab dedicated, shareable, server-rendered URLs — `/tournaments/<id>/projection?category=men|women` and `/tournaments/<id>/projection/<pair-slug>` — for sharing, SEO indexing, and per-projection analytics.

**Architecture:** Two new **server** route segments under the existing `tournaments/[id]/` route (which already provides tournament JSON-LD + sr-only `<h1>` via its server `layout.tsx`). Each route server-fetches the precomputed `tournament_projections` rows + player names, emits an `sr-only` SEO block (names + champion %, the same SEO pattern `layout.tsx` uses), sets `generateMetadata` (canonical/hreflang/OG), and mounts the existing **client** `ProjectionTab` as the interactive layer. Pair identity is a readable surname slug resolved against player IDs with a 308 canonical redirect for stale/reordered slugs. A new `sitemap-projections.xml` (gated by the `projection_enabled` flag, read server-side) lists all computed projection URLs.

**Design §3 deviation (intentional, lower-risk):** Rather than extract the main page's collapsing-on-scroll hero into a shared component, the projection route renders its own lightweight **server** header (cover + title + M/W links) and reuses the existing `SlidingInkTabs` for the tab strip. Visual continuity is preserved (same cover, title, tab strip); only the scroll-collapse micro-interaction is main-page-only. Adopting the shared header in `page.tsx` is a noted follow-up, not in scope.

**Tech Stack:** Next.js 16 App Router (server + client components), next-intl (`[locale]` routing, server `redirect`/`getTranslations`), Supabase (`createServerClient` service client for SSR reads, public-read `tournament_projections`/`players`/`feature_flags`), Vitest (unit), Playwright (E2E).

---

## File Structure

**New files:**
- `src/lib/projection-slug.ts` — pure slug build + resolution (no I/O).
- `src/lib/__tests__/projection-slug.test.ts` — unit tests for the above.
- `src/lib/projection-server.ts` — server-only data helpers: fetch projection rows, player names, tournament meta, and the server-side projection flag read.
- `src/components/tournament/TournamentProjectionHeader.tsx` — server presentational header (cover, back, level pill, flag, title, M/W links).
- `src/app/[locale]/(app)/tournaments/[id]/projection/page.tsx` — tournament-level projection route (server).
- `src/app/[locale]/(app)/tournaments/[id]/projection/[pair]/page.tsx` — per-pair road-to-title route (server).
- `src/app/[locale]/(app)/tournaments/[id]/projection/ProjectionSeoBlock.tsx` — server component, `sr-only` SEO list/road.
- `src/app/[locale]/(app)/tournaments/[id]/projection/ProjectionRouteClient.tsx` — client wrapper: tab strip (`SlidingInkTabs`) + `ProjectionTab` + URL sync on pair pick.
- `src/app/sitemap-projections.xml/route.ts` — child sitemap for projection URLs.

**Modified files:**
- `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx` — add optional `onPairChange` callback fired when the selected pair changes.
- `src/app/[locale]/(app)/tournaments/[id]/page.tsx` — Projection tab `onChange` navigates to the route instead of toggling in-page state; remove the now-dead in-page `pageTab === 'projection'` render branch.
- `src/app/sitemap.xml/route.ts` — register `sitemap-projections.xml` in the index.

---

## Task 1: Pair slug helper (pure, TDD)

**Files:**
- Create: `src/lib/projection-slug.ts`
- Test: `src/lib/__tests__/projection-slug.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/projection-slug.test.ts
import { describe, it, expect } from 'vitest'
import { pairSlugFromNames, buildSlugIndex, resolvePairSlug } from '../projection-slug'

const P = (id: string, name: string) => ({ id, name })

describe('pairSlugFromNames', () => {
  it('joins surnames, lowercased, diacritics stripped', () => {
    expect(pairSlugFromNames([P('b', 'Arturo Coello'), P('a', 'Agustín Tapia')]))
      // ordered by id: a (Tapia) then b (Coello)
      .toBe('tapia-coello')
  })

  it('is order-independent (sorts by id)', () => {
    const s1 = pairSlugFromNames([P('a', 'Agustín Tapia'), P('b', 'Arturo Coello')])
    const s2 = pairSlugFromNames([P('b', 'Arturo Coello'), P('a', 'Agustín Tapia')])
    expect(s1).toBe(s2)
  })

  it('uses the last whitespace token as the surname', () => {
    expect(pairSlugFromNames([P('a', 'Juan Lebron'), P('b', 'Ale Galan')]))
      .toBe('lebron-galan')
  })

  it('strips punctuation and collapses dashes', () => {
    expect(pairSlugFromNames([P('a', "Paula Josemaría"), P('b', 'Ari Sánchez')]))
      .toBe('josemaria-sanchez')
  })
})

describe('buildSlugIndex + resolvePairSlug', () => {
  const rows = [
    { pair_key: 'k1', pair_player_ids: ['a', 'b'] },
    { pair_key: 'k2', pair_player_ids: ['c', 'd'] },
  ]
  const nameById = new Map([
    ['a', 'Agustín Tapia'], ['b', 'Arturo Coello'],
    ['c', 'Juan Lebron'], ['d', 'Ale Galan'],
  ])

  it('resolves an exact canonical slug with no redirect', () => {
    const idx = buildSlugIndex(rows, nameById)
    expect(resolvePairSlug(idx, 'tapia-coello')).toEqual({
      pairKey: 'k1', canonicalSlug: 'tapia-coello', redirect: false,
    })
  })

  it('308-redirects a reordered slug to canonical', () => {
    const idx = buildSlugIndex(rows, nameById)
    expect(resolvePairSlug(idx, 'coello-tapia')).toEqual({
      pairKey: 'k1', canonicalSlug: 'tapia-coello', redirect: true,
    })
  })

  it('returns null for an unknown slug', () => {
    const idx = buildSlugIndex(rows, nameById)
    expect(resolvePairSlug(idx, 'nobody-here')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/projection-slug.test.ts`
Expected: FAIL — "Cannot find module '../projection-slug'".

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/projection-slug.ts
// Pure helpers for projection pair URL slugs. A pair slug is a readable,
// SEO-friendly identity ("tapia-coello") derived from player surnames, but
// always resolved back to a stable pair_key against player IDs. No I/O here.

export interface SlugPlayer {
  id: string
  name: string
}

export interface SlugRow {
  pair_key: string
  pair_player_ids: string[]
}

export interface SlugIndex {
  /** canonical slug -> pair_key */
  slugToPairKey: Map<string, string>
  /** pair_key -> canonical slug */
  pairKeyToSlug: Map<string, string>
  /** sorted-surname-set key -> pair_key (for order-insensitive fallback) */
  surnameSetToPairKey: Map<string, string>
}

/** Lowercase, strip diacritics, keep [a-z0-9], collapse to single dashes. */
function normalizeToken(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // strip combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Last whitespace-separated token of a full name, normalized. Falls back to whole name. */
function surnameOf(name: string): string {
  const tokens = name.trim().split(/\s+/)
  const last = tokens.length > 0 ? tokens[tokens.length - 1] : name
  return normalizeToken(last) || normalizeToken(name)
}

/** Build a deterministic pair slug from its players (ordered by player id). */
export function pairSlugFromNames(players: SlugPlayer[]): string {
  return [...players]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((p) => surnameOf(p.name))
    .join('-')
}

/** Sorted set of surnames, used as an order-insensitive fallback key. */
function surnameSetKey(players: SlugPlayer[]): string {
  return players.map((p) => surnameOf(p.name)).sort().join('|')
}

export function buildSlugIndex(rows: SlugRow[], nameById: Map<string, string>): SlugIndex {
  const slugToPairKey = new Map<string, string>()
  const pairKeyToSlug = new Map<string, string>()
  const surnameSetToPairKey = new Map<string, string>()

  for (const row of rows) {
    const players: SlugPlayer[] = row.pair_player_ids.map((id) => ({ id, name: nameById.get(id) ?? id }))
    const slug = pairSlugFromNames(players)
    slugToPairKey.set(slug, row.pair_key)
    pairKeyToSlug.set(row.pair_key, slug)
    surnameSetToPairKey.set(surnameSetKey(players), row.pair_key)
  }

  return { slugToPairKey, pairKeyToSlug, surnameSetToPairKey }
}

export interface ResolvedSlug {
  pairKey: string
  canonicalSlug: string
  /** true when the requested slug differs from canonical (caller should 308-redirect) */
  redirect: boolean
}

/**
 * Resolve a requested slug to a pair.
 *  1. Exact canonical match -> no redirect.
 *  2. Order-insensitive surname-set match -> redirect to canonical.
 *  3. Otherwise null (caller -> notFound()).
 */
export function resolvePairSlug(index: SlugIndex, requestedSlug: string): ResolvedSlug | null {
  const exact = index.slugToPairKey.get(requestedSlug)
  if (exact) {
    return { pairKey: exact, canonicalSlug: requestedSlug, redirect: false }
  }
  const setKey = requestedSlug.split('-').sort().join('|')
  const bySet = index.surnameSetToPairKey.get(setKey)
  if (bySet) {
    return { pairKey: bySet, canonicalSlug: index.pairKeyToSlug.get(bySet)!, redirect: true }
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/projection-slug.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/projection-slug.ts src/lib/__tests__/projection-slug.test.ts
git commit -m "feat(projection): pair URL slug build + canonical resolution"
```

---

## Task 2: Server data helpers

**Files:**
- Create: `src/lib/projection-server.ts`

These wrap the SSR reads so the routes stay thin. No new test file — exercised end-to-end by the route E2E in Task 9 (these are thin Supabase queries; mocking Supabase here adds noise without value).

- [ ] **Step 1: Write the implementation**

```ts
// src/lib/projection-server.ts
// Server-only data access for the projection routes. Uses the service
// client (RLS-bypassing) the rest of the SSR layer uses. Read-only.

import 'server-only'
import { createServerClient } from '@/lib/supabase'
import { fetchFeatureFlag, resolveFlag, FLAG_KEYS } from '@/lib/feature-flags'
import type { ProjectionRow } from '@/lib/projection-types'

export type ProjectionCategory = 'men' | 'women'

export interface ProjectionTournamentMeta {
  id: string
  name: string | null
  country: string | null
  level: string | null
  cover_image_url: string | null
  venue: string | null
  starts_at: string | null
  ends_at: string | null
  round_schedule: Record<string, string> | null
}

const PROJECTION_COLUMNS =
  'tournament_id, category, pair_key, pair_player_ids, tournament_level, status, eliminated_round, champion_prob, finalist_prob, semifinal_prob, rounds, predicted_finish_round, computed_at'

/** Server-side projection feature flag (production column; SSR is treated as production). */
export async function isProjectionEnabledServer(): Promise<boolean> {
  try {
    const supabase = createServerClient()
    const row = await fetchFeatureFlag(supabase, FLAG_KEYS.PROJECTION_ENABLED)
    return resolveFlag(row)
  } catch {
    return false
  }
}

/** All projection rows for a tournament+category, ordered by champion_prob desc. */
export async function fetchProjectionRows(
  tournamentId: string,
  category: ProjectionCategory,
): Promise<ProjectionRow[]> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('tournament_projections')
    .select(PROJECTION_COLUMNS)
    .eq('tournament_id', tournamentId)
    .eq('category', category)
    .order('champion_prob', { ascending: false })
  if (error) {
    console.warn('[projection-server] fetchProjectionRows failed:', error)
    return []
  }
  return (data ?? []) as ProjectionRow[]
}

/** Which categories actually have projection rows (for default-gender + sitemap). */
export async function fetchProjectionCategories(tournamentId: string): Promise<ProjectionCategory[]> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('tournament_projections')
    .select('category')
    .eq('tournament_id', tournamentId)
  if (error || !data) return []
  const set = new Set<ProjectionCategory>()
  for (const r of data as { category: ProjectionCategory }[]) set.add(r.category)
  // men first when both present
  return (['men', 'women'] as ProjectionCategory[]).filter((c) => set.has(c))
}

/** Player display names keyed by id, for the given player ids. */
export async function fetchPlayerNames(playerIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const ids = [...new Set(playerIds)].filter(Boolean)
  if (ids.length === 0) return map
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('players')
    .select('id, name, display_name')
    .in('id', ids)
  if (error || !data) return map
  for (const p of data as { id: string; name: string | null; display_name: string | null }[]) {
    map.set(p.id, p.display_name ?? p.name ?? p.id)
  }
  return map
}

/** Tournament meta for the projection header + metadata. Null when not found. */
export async function fetchProjectionTournamentMeta(
  tournamentId: string,
): Promise<ProjectionTournamentMeta | null> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('tournaments')
    .select('id, name, country, level, cover_image_url, venue, starts_at, ends_at, round_schedule')
    .eq('id', tournamentId)
    .single()
  if (error || !data) return null
  return data as ProjectionTournamentMeta
}
```

- [ ] **Step 2: Verify it typechecks / builds**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i projection-server || echo "no projection-server type errors"`
Expected: `no projection-server type errors`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/projection-server.ts
git commit -m "feat(projection): server-side projection data + flag helpers"
```

---

## Task 3: `ProjectionTab` — `onPairChange` callback

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx`

The route's client wrapper needs to know when the selected pair changes so it can sync the URL. Add an optional callback fired on every `selectedPair` change (mount included — the wrapper de-dupes against the current URL).

- [ ] **Step 1: Add the prop to the component signature**

Find the props block (around line 83-95) and add `onPairChange`:

```tsx
export default function ProjectionTab({
  tournamentId,
  matches,
  category,
  roundSchedule,
  initialPairKey,
  onPairChange,
}: {
  tournamentId: string
  matches: Match[]
  category: 'men' | 'women'
  tournamentLevel: string | null
  roundSchedule: Record<string, string> | null
  initialPairKey?: string | null
  onPairChange?: (pairKey: string | null) => void
}) {
```

- [ ] **Step 2: Fire the callback when the selected pair changes**

Add `useEffect` to the imports (the file already imports from 'react' — ensure `useEffect` is included):

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
```

Immediately after the `selectedPair` state declaration (around line 116), add:

```tsx
  // Notify the route wrapper so it can keep the URL in sync with the
  // visible pair (enables shareable /projection/<slug> links).
  useEffect(() => {
    onPairChange?.(selectedPair)
  }, [selectedPair, onPairChange])
```

- [ ] **Step 3: Verify the existing render still typechecks**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i ProjectionTab || echo "no ProjectionTab type errors"`
Expected: `no ProjectionTab type errors`.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx'
git commit -m "feat(projection): ProjectionTab onPairChange callback for URL sync"
```

---

## Task 4: Server SEO block

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/projection/ProjectionSeoBlock.tsx`

A server component that renders the crawlable projection content as an `sr-only` block (names + champion %, and for a single pair, its road). Mirrors the `sr-only` SEO pattern in `tournaments/[id]/layout.tsx`.

- [ ] **Step 1: Write the component**

```tsx
// src/app/[locale]/(app)/tournaments/[id]/projection/ProjectionSeoBlock.tsx
// Server-rendered, screen-reader-only SEO surface for projection routes.
// ProjectionTab (the visible UI) is a client island whose markup never
// reaches crawlers, so this block carries the indexable text — the same
// approach layout.tsx uses for the tournament <h1>.

import type { ProjectionRow } from '@/lib/projection-types'

function pairLabel(row: ProjectionRow, nameById: Map<string, string>): string {
  return row.pair_player_ids
    .map((id) => {
      const full = nameById.get(id) ?? id
      const tokens = full.trim().split(/\s+/)
      return tokens[tokens.length - 1] || full
    })
    .join(' / ')
}

const pct = (p: number): string => `${Math.round(p * 100)}%`

export function ProjectionSeoBlock({
  tournamentName,
  category,
  rows,
  nameById,
  pairKey,
}: {
  tournamentName: string
  category: 'men' | 'women'
  rows: ProjectionRow[]
  nameById: Map<string, string>
  pairKey?: string | null
}) {
  const single = pairKey ? rows.find((r) => r.pair_key === pairKey) ?? null : null

  if (single) {
    return (
      <section className="sr-only" aria-hidden={false}>
        <h2>
          {pairLabel(single, nameById)} — road to the title at {tournamentName} ({category})
        </h2>
        <p>Champion probability: {pct(single.champion_prob)}. Finalist: {pct(single.finalist_prob)}. Semifinal: {pct(single.semifinal_prob)}.</p>
        <ul>
          {single.rounds.map((rd) => {
            const opp = rd.opponents[0]
            return (
              <li key={rd.round}>
                {rd.round}: reach {pct(rd.reach_prob)}
                {opp ? ` — likely vs ${opp.names.join(' / ')} (win ${pct(opp.win_prob)})` : ''}
              </li>
            )
          })}
        </ul>
      </section>
    )
  }

  return (
    <section className="sr-only" aria-hidden={false}>
      <h2>{tournamentName} projection — {category} road to the title</h2>
      <ul>
        {rows.map((r) => (
          <li key={r.pair_key}>
            {pairLabel(r, nameById)} — {pct(r.champion_prob)} champion, {pct(r.finalist_prob)} finalist
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i ProjectionSeoBlock || echo "no ProjectionSeoBlock type errors"`
Expected: `no ProjectionSeoBlock type errors`.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/[locale]/(app)/tournaments/[id]/projection/ProjectionSeoBlock.tsx'
git commit -m "feat(projection): sr-only SEO block for projection routes"
```

---

## Task 5: Server header component

**Files:**
- Create: `src/components/tournament/TournamentProjectionHeader.tsx`

A lightweight **server** header so the route visually reads as the tournament page: cover image, back link, level pill, flag, title, and M/W toggle rendered as `<Link>`s (server-rendered → both genders crawlable). Reuses existing presentational helpers.

- [ ] **Step 1: Write the component**

```tsx
// src/components/tournament/TournamentProjectionHeader.tsx
// Server-rendered header for the projection routes. Deliberately simpler
// than the main page's collapsing hero (no scroll-collapse) — see the
// plan's "Design §3 deviation" note. M/W are <Link>s so both genders are
// crawlable and switching is a normal navigation.

import { Link } from '@/i18n/navigation'
import Image from 'next/image'
import { FlagImage } from '@/components/FlagImage'
import { getTierPill } from '@/lib/tournament-tier-style'
import { levelLabel } from '@/lib/tournament-labels'
import type { ProjectionTournamentMeta, ProjectionCategory } from '@/lib/projection-server'

const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

export function TournamentProjectionHeader({
  tournament,
  category,
}: {
  tournament: ProjectionTournamentMeta
  category: ProjectionCategory
}) {
  const base = `/tournaments/${tournament.id}/projection`
  const title = tournament.name ?? 'Tournament'

  return (
    <header style={{ position: 'relative', background: '#0A0A0A', overflow: 'hidden' }}>
      {tournament.cover_image_url ? (
        <>
          <Image
            src={tournament.cover_image_url}
            alt=""
            aria-hidden
            fill
            sizes="(max-width: 480px) 100vw, 500px"
            style={{ objectFit: 'cover', objectPosition: 'center top', filter: 'brightness(0.4) saturate(0.7)' }}
          />
          <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'rgba(10,10,10,0.55)' }} />
        </>
      ) : null}

      <div style={{ position: 'relative', zIndex: 2, padding: '14px 16px 16px', minHeight: 120 }}>
        <Link href={`/tournaments/${tournament.id}?tab=overview`} aria-label="Back" style={{ color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>
          ‹ {title}
        </Link>

        {tournament.level ? (() => {
          const pill = getTierPill(tournament.level)
          return (
            <div style={{ marginTop: 10 }}>
              <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 800, color: pill.color, background: pill.background, clipPath: CHUNKY_BADGE, padding: '4px 12px', letterSpacing: 0.7, textTransform: 'uppercase' }}>
                {levelLabel(tournament.level)}
              </span>
            </div>
          )
        })() : null}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          {tournament.country ? <FlagImage country={tournament.country} size={22} /> : null}
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, lineHeight: 1.05, letterSpacing: -0.5, color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,0.45)' }}>
            {title}
          </h1>
        </div>

        {/* M/W as navigations — both crawlable */}
        <div style={{ display: 'inline-flex', gap: 6, marginTop: 12 }}>
          {(['men', 'women'] as ProjectionCategory[]).map((c) => (
            <Link
              key={c}
              href={`${base}?category=${c}`}
              aria-current={category === c ? 'true' : undefined}
              style={{
                fontSize: 11, fontWeight: 800, padding: '5px 12px', textDecoration: 'none',
                clipPath: CHUNKY_BADGE,
                background: category === c ? '#7ED321' : 'rgba(255,255,255,0.08)',
                color: category === c ? '#000' : '#9AAEC4',
              }}
            >
              {c === 'men' ? 'M' : 'W'}
            </Link>
          ))}
        </div>
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i TournamentProjectionHeader || echo "no header type errors"`
Expected: `no header type errors`.

- [ ] **Step 3: Commit**

```bash
git add src/components/tournament/TournamentProjectionHeader.tsx
git commit -m "feat(projection): server-rendered projection header"
```

---

## Task 6: Route client wrapper (tabs + ProjectionTab + URL sync)

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/projection/ProjectionRouteClient.tsx`

Client component that renders the tab strip (reusing `SlidingInkTabs`), mounts `ProjectionTab`, and syncs the selected pair into the URL via `router.replace` (using the server-provided `pairKeyToSlug` map).

- [ ] **Step 1: Write the component**

```tsx
// src/app/[locale]/(app)/tournaments/[id]/projection/ProjectionRouteClient.tsx
'use client'

import { useCallback, useRef } from 'react'
import { useRouter, usePathname } from '@/i18n/navigation'
import SlidingInkTabs from '@/components/SlidingInkTabs'
import { useTranslations } from 'next-intl'
import ProjectionTab from '../ProjectionTab'

type TabKey = 'overview' | 'projection' | 'story' | 'matches' | 'draw'

export default function ProjectionRouteClient({
  tournamentId,
  category,
  initialPairKey,
  tournamentLevel,
  roundSchedule,
  pairKeyToSlug,
  showDrawTab,
}: {
  tournamentId: string
  category: 'men' | 'women'
  initialPairKey: string | null
  tournamentLevel: string | null
  roundSchedule: Record<string, string> | null
  pairKeyToSlug: Record<string, string>
  showDrawTab: boolean
}) {
  const t = useTranslations('tournament')
  const router = useRouter()
  const pathname = usePathname()

  // Base path of THIS route, minus any /<pair> segment, so URL sync targets
  // /tournaments/<id>/projection[/<slug>]. usePathname() is locale-stripped
  // by @/i18n/navigation, so it starts at /tournaments/...
  const projectionBase = `/tournaments/${tournamentId}/projection`

  const lastSyncedRef = useRef<string | null>(initialPairKey ?? null)

  const onPairChange = useCallback((pairKey: string | null) => {
    if (pairKey === lastSyncedRef.current) return
    lastSyncedRef.current = pairKey
    const slug = pairKey ? pairKeyToSlug[pairKey] : null
    const target = slug
      ? `${projectionBase}/${slug}`
      : `${projectionBase}?category=${category}`
    // Avoid redundant navigations when already on target.
    if (pathname !== target.split('?')[0]) {
      router.replace(target, { scroll: false })
    }
  }, [pairKeyToSlug, projectionBase, category, pathname, router])

  const onTabChange = useCallback((key: TabKey) => {
    if (key === 'projection') return
    router.push(`/tournaments/${tournamentId}?tab=${key}`)
  }, [router, tournamentId])

  const tabs = (['overview', 'projection', 'story', 'matches', ...(showDrawTab ? ['draw'] as const : [])] as const)
    .map((key) => ({ key, label: t(key) }))

  return (
    <>
      <SlidingInkTabs
        tabs={tabs}
        activeKey="projection"
        onChange={onTabChange}
        containerStyle={{ position: 'sticky', top: 0, zIndex: 19, background: '#0A0A0A', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      />
      <ProjectionTab
        tournamentId={tournamentId}
        matches={[]}
        category={category}
        tournamentLevel={tournamentLevel}
        roundSchedule={roundSchedule}
        initialPairKey={initialPairKey}
        onPairChange={onPairChange}
      />
    </>
  )
}
```

> Note: `matches={[]}` — ProjectionTab fetches its own projection rows + player images client-side, so it renders names without the heavy matches query. Seed badges (derived from `matches`) won't show on the route; that's an accepted degradation (flag as a follow-up if seeds are wanted here).

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i ProjectionRouteClient || echo "no wrapper type errors"`
Expected: `no wrapper type errors`.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/[locale]/(app)/tournaments/[id]/projection/ProjectionRouteClient.tsx'
git commit -m "feat(projection): route client wrapper with tab strip + URL sync"
```

---

## Task 7: Tournament-level projection route

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/projection/page.tsx`

Server route at `/tournaments/<id>/projection`. Gates on the flag, picks the default category, server-fetches rows + names + meta, emits the SEO block + header + client wrapper, and sets metadata.

- [ ] **Step 1: Check the next-intl server redirect/notFound API**

Read the installed docs so the redirect call matches this next-intl version:

Run: `ls node_modules/next/dist/docs/ 2>/dev/null | head; sed -n '1,40p' src/i18n/navigation.ts`
Confirm `redirect` is exported from `@/i18n/navigation` and accepts a locale. If it instead requires `redirect({ href, locale })`, adjust the call in Step 2 accordingly. `notFound()` is always imported from `next/navigation`.

- [ ] **Step 2: Write the route**

```tsx
// src/app/[locale]/(app)/tournaments/[id]/projection/page.tsx
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo-helpers'
import {
  isProjectionEnabledServer,
  fetchProjectionRows,
  fetchProjectionCategories,
  fetchPlayerNames,
  fetchProjectionTournamentMeta,
  type ProjectionCategory,
} from '@/lib/projection-server'
import { buildSlugIndex } from '@/lib/projection-slug'
import { TournamentProjectionHeader } from '@/components/tournament/TournamentProjectionHeader'
import { ProjectionSeoBlock } from './ProjectionSeoBlock'
import ProjectionRouteClient from './ProjectionRouteClient'

const DRAW_TIERS = new Set(['major', 'p1', 'p2', 'finals', 'fip_bronze', 'fip_silver', 'fip_gold', 'fip_platinum'])

type Props = {
  params: Promise<{ locale: string; id: string }>
  searchParams: Promise<{ category?: string }>
}

async function resolveCategory(id: string, raw: string | undefined): Promise<ProjectionCategory | null> {
  const available = await fetchProjectionCategories(id)
  if (available.length === 0) return null
  if (raw === 'women' && available.includes('women')) return 'women'
  if (raw === 'men' && available.includes('men')) return 'men'
  return available[0]  // default: men first when both present
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { id, locale } = await params
  const { category: rawCategory } = await searchParams
  const meta = await fetchProjectionTournamentMeta(id)
  const category = await resolveCategory(id, rawCategory)

  if (!meta || !meta.name || !category) {
    // No projection / ghost tournament — don't index a hollow page.
    return { title: 'Projection | Padel Nachos', robots: { index: false, follow: false } }
  }

  const t = await getTranslations({ locale, namespace: 'seo.projection' })
  const title = t('title', { name: meta.name })
  const description = t('description', { name: meta.name })
  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary_large_image', title },
    ...buildAlternates(`/tournaments/${id}/projection`, locale),
  }
}

export default async function ProjectionPage({ params, searchParams }: Props) {
  const { id } = await params
  const { category: rawCategory } = await searchParams

  if (!(await isProjectionEnabledServer())) notFound()

  const meta = await fetchProjectionTournamentMeta(id)
  const category = await resolveCategory(id, rawCategory)
  if (!meta || !meta.name) notFound()

  // No projection for this tournament/category yet: render the header + an
  // empty client tab (which shows its own empty state). generateMetadata
  // already set noindex for this case.
  const rows = category ? await fetchProjectionRows(id, category) : []
  const resolvedCategory: ProjectionCategory = category ?? 'men'
  const nameById = await fetchPlayerNames(rows.flatMap((r) => r.pair_player_ids))
  const { pairKeyToSlug } = buildSlugIndex(rows, nameById)
  const showDrawTab = DRAW_TIERS.has(meta.level ?? '')

  return (
    <div style={{ background: '#1A1A1A', minHeight: '100vh' }}>
      <main style={{ maxWidth: 500, margin: '0 auto', background: '#1A1A1A', minHeight: '100vh' }}>
        <TournamentProjectionHeader tournament={meta} category={resolvedCategory} />
        <ProjectionSeoBlock
          tournamentName={meta.name}
          category={resolvedCategory}
          rows={rows}
          nameById={nameById}
        />
        <ProjectionRouteClient
          tournamentId={id}
          category={resolvedCategory}
          initialPairKey={null}
          tournamentLevel={meta.level}
          roundSchedule={meta.round_schedule}
          pairKeyToSlug={Object.fromEntries(pairKeyToSlug)}
          showDrawTab={showDrawTab}
        />
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Add the `seo.projection` translation keys (all 5 locales)**

Add to `src/messages/en.json` under a new top-level `seo.projection` object (the `seo` object already exists — add the `projection` child). English:

```json
"projection": {
  "title": "{name} Projection — Road to the Title | Padel Nachos",
  "description": "Live championship projections for {name}: each pair's road to the title, round-by-round win probabilities."
}
```

Repeat with translated strings for `es.json`, `pt.json`, `it.json`, `fr.json` (place under their existing `seo` object). Spanish example:

```json
"projection": {
  "title": "Proyección de {name} — Camino al Título | Padel Nachos",
  "description": "Proyecciones de campeonato en directo para {name}: el camino al título de cada pareja y las probabilidades ronda a ronda."
}
```

Use natural translations for pt/it/fr (mirror the Spanish meaning).

- [ ] **Step 4: Verify build + manual render**

Run: `npm run build 2>&1 | grep -iE 'projection|error' | head -20`
Expected: no build errors referencing the projection route.

Then start the dev server and verify with the preview workflow (see Task 10) once routes are complete.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/[locale]/(app)/tournaments/[id]/projection/page.tsx' src/messages/*.json
git commit -m "feat(projection): tournament-level /projection server route"
```

---

## Task 8: Per-pair projection route

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/projection/[pair]/page.tsx`

Server route at `/tournaments/<id>/projection/<pair-slug>`. Resolves the slug, 308-redirects stale slugs, `notFound()` on unknown, and renders the same header + SEO block (single-pair variant) + client wrapper pre-selected on the pair.

- [ ] **Step 1: Write the route**

```tsx
// src/app/[locale]/(app)/tournaments/[id]/projection/[pair]/page.tsx
import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo-helpers'
import {
  isProjectionEnabledServer,
  fetchProjectionRows,
  fetchProjectionCategories,
  fetchPlayerNames,
  fetchProjectionTournamentMeta,
  type ProjectionCategory,
} from '@/lib/projection-server'
import { buildSlugIndex, resolvePairSlug } from '@/lib/projection-slug'
import type { ProjectionRow } from '@/lib/projection-types'
import { TournamentProjectionHeader } from '@/components/tournament/TournamentProjectionHeader'
import { ProjectionSeoBlock } from '../ProjectionSeoBlock'
import ProjectionRouteClient from '../ProjectionRouteClient'

const DRAW_TIERS = new Set(['major', 'p1', 'p2', 'finals', 'fip_bronze', 'fip_silver', 'fip_gold', 'fip_platinum'])

type Props = {
  params: Promise<{ locale: string; id: string; pair: string }>
}

/** Find the pair across both categories. Returns the row, category, names, and slug index. */
async function resolvePairAcrossCategories(id: string, pairSlug: string): Promise<{
  row: ProjectionRow
  category: ProjectionCategory
  rows: ProjectionRow[]
  nameById: Map<string, string>
  canonicalSlug: string
  redirect: boolean
} | null> {
  const categories = await fetchProjectionCategories(id)
  for (const category of categories) {
    const rows = await fetchProjectionRows(id, category)
    if (rows.length === 0) continue
    const nameById = await fetchPlayerNames(rows.flatMap((r) => r.pair_player_ids))
    const index = buildSlugIndex(rows, nameById)
    const resolved = resolvePairSlug(index, pairSlug)
    if (resolved) {
      const row = rows.find((r) => r.pair_key === resolved.pairKey)
      if (row) return { row, category, rows, nameById, canonicalSlug: resolved.canonicalSlug, redirect: resolved.redirect }
    }
  }
  return null
}

function pairTitle(row: ProjectionRow, nameById: Map<string, string>): string {
  return row.pair_player_ids
    .map((pid) => {
      const full = nameById.get(pid) ?? pid
      const tk = full.trim().split(/\s+/)
      return tk[tk.length - 1] || full
    })
    .join(' / ')
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, pair, locale } = await params
  const meta = await fetchProjectionTournamentMeta(id)
  const resolved = await resolvePairAcrossCategories(id, pair)

  if (!meta || !meta.name || !resolved) {
    return { title: 'Projection | Padel Nachos', robots: { index: false, follow: false } }
  }

  const t = await getTranslations({ locale, namespace: 'seo.projection' })
  const pairName = pairTitle(resolved.row, resolved.nameById)
  const title = t('pairTitle', { pair: pairName, name: meta.name })
  const description = t('pairDescription', { pair: pairName, name: meta.name })
  // Canonical always points at the canonical slug (handles 308 source URLs).
  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary_large_image', title },
    ...buildAlternates(`/tournaments/${id}/projection/${resolved.canonicalSlug}`, locale),
  }
}

export default async function ProjectionPairPage({ params }: Props) {
  const { id, pair } = await params

  if (!(await isProjectionEnabledServer())) notFound()

  const meta = await fetchProjectionTournamentMeta(id)
  if (!meta || !meta.name) notFound()

  const resolved = await resolvePairAcrossCategories(id, pair)
  if (!resolved) notFound()

  if (resolved.redirect) {
    permanentRedirect(`/tournaments/${id}/projection/${resolved.canonicalSlug}`)
  }

  const { pairKeyToSlug } = buildSlugIndex(resolved.rows, resolved.nameById)
  const showDrawTab = DRAW_TIERS.has(meta.level ?? '')

  return (
    <div style={{ background: '#1A1A1A', minHeight: '100vh' }}>
      <main style={{ maxWidth: 500, margin: '0 auto', background: '#1A1A1A', minHeight: '100vh' }}>
        <TournamentProjectionHeader tournament={meta} category={resolved.category} />
        <ProjectionSeoBlock
          tournamentName={meta.name}
          category={resolved.category}
          rows={resolved.rows}
          nameById={resolved.nameById}
          pairKey={resolved.row.pair_key}
        />
        <ProjectionRouteClient
          tournamentId={id}
          category={resolved.category}
          initialPairKey={resolved.row.pair_key}
          tournamentLevel={meta.level}
          roundSchedule={meta.round_schedule}
          pairKeyToSlug={Object.fromEntries(pairKeyToSlug)}
          showDrawTab={showDrawTab}
        />
      </main>
    </div>
  )
}
```

> `permanentRedirect` and `notFound` both come from `next/navigation` and work in server components. The 308 redirect target is the locale-relative path; Next preserves the active `[locale]` segment.

- [ ] **Step 2: Add the pair-level `seo.projection` keys to all 5 locales**

Extend the `seo.projection` object created in Task 7 with `pairTitle` / `pairDescription`. English:

```json
"pairTitle": "{pair} — Road to the Title at {name} | Padel Nachos",
"pairDescription": "{pair}'s projected path to the {name} title — round-by-round opponents and win probabilities."
```

Spanish:

```json
"pairTitle": "{pair} — Camino al Título en {name} | Padel Nachos",
"pairDescription": "El camino proyectado de {pair} hacia el título de {name}: rivales ronda a ronda y probabilidades de victoria."
```

Add natural pt/it/fr translations.

- [ ] **Step 3: Verify build**

Run: `npm run build 2>&1 | grep -iE 'projection|error' | head -20`
Expected: no errors referencing the projection routes.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/[locale]/(app)/tournaments/[id]/projection/[pair]/page.tsx' src/messages/*.json
git commit -m "feat(projection): per-pair /projection/[pair] server route with canonical redirect"
```

---

## Task 9: Wire the main page's Projection tab to the route

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/page.tsx`

Make the Projection tab navigate to the new route instead of toggling in-page, and remove the now-dead in-page projection render branch.

- [ ] **Step 1: Navigate on Projection tab select**

Find the `SlidingInkTabs` usage (around line 1148-1166). Its `onChange` currently is:

```tsx
          onChange={(key) => { if (key === 'projection') markProjectionSeen(); setPageTab(key) }}
```

Replace with navigation for projection (keep the "seen" marking + keep the existing `genderFilter` so the route opens on the same gender):

```tsx
          onChange={(key) => {
            if (key === 'projection') {
              markProjectionSeen()
              router.push(`/tournaments/${tournamentId}/projection?category=${genderFilter}`)
              return
            }
            setPageTab(key)
          }}
```

- [ ] **Step 2: Remove the dead in-page projection branch**

Find the in-page render block (around line 1351-1359):

```tsx
        {pageTab === 'projection' && activeTournamentObj && showProjectionTab && (
          <ProjectionTab
            tournamentId={tournamentId}
            matches={allMatches.filter(m => (m as { category?: string }).category === genderFilter)}
            category={genderFilter}
            tournamentLevel={activeTournamentObj.level ?? null}
            roundSchedule={(activeTournamentObj as { round_schedule?: Record<string, string> | null }).round_schedule ?? null}
            initialPairKey={paramPair}
          />
        )}
```

Delete this block. The tab now navigates away, so this branch never renders.

- [ ] **Step 3: Handle legacy `?tab=projection` deep links**

Old share links use `?tab=projection`. Redirect them to the new route so they don't render a blank tab. Find the initial `pageTab` state initializer (around line 237-255) — instead of mapping `paramTab === 'projection'` to the `'projection'` state, add an effect near the other mount effects that redirects:

```tsx
  // Legacy ?tab=projection deep links → the dedicated projection route.
  useEffect(() => {
    if (paramTab !== 'projection') return
    const cat = searchParams.get('category') === 'women' ? 'women' : 'men'
    const pairQs = paramPair ? `` : ``  // pair handled by route slug; legacy pair_key not slug-mappable here
    router.replace(`/tournaments/${tournamentId}/projection?category=${cat}${pairQs}`)
  }, [paramTab, paramPair, searchParams, router, tournamentId])
```

Then in the `pageTab` initializer, change the `paramTab === 'projection' ? 'projection'` arm to fall back to `'overview'` (the effect above will redirect before it matters). Remove `'projection'` from the `useState` union ONLY if no other reference remains; otherwise leave the type and just never set it. Leaving the type union intact is safest — do not remove `ProjectionTab` import if still referenced elsewhere; if the import is now unused, remove it to satisfy lint.

- [ ] **Step 4: Verify lint + build**

Run: `npm run lint 2>&1 | grep -iE 'tournaments/\[id\]/page|projection' | head; npm run build 2>&1 | grep -iE 'error' | head`
Expected: no new lint errors for the file; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/[locale]/(app)/tournaments/[id]/page.tsx'
git commit -m "feat(projection): route Projection tab to dedicated URL; redirect legacy ?tab=projection"
```

---

## Task 10: Manual verification in the running app

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Use the preview tooling (`preview_start`). The app runs on `localhost:3002`.

- [ ] **Step 2: Confirm the projection flag is on for local**

The route `notFound()`s when `projection_enabled` is off. Verify the `feature_flags` row has `enabled_local = true` (the projection feature shipped, so it likely is). If a projection-bearing tournament 404s, check this first.

- [ ] **Step 3: Verify tournament-level route renders**

Navigate to a tournament known to have projections (a current Premier event). Open `/tournaments/<id>/projection`. Confirm via `preview_snapshot`:
- Header shows the cover + tournament title.
- The pair list (ProjectionTab) renders with champion %.
- M/W links switch category (URL `?category=` changes).

- [ ] **Step 4: Verify SEO content is in server HTML**

Run: `curl -s "http://localhost:3002/tournaments/<id>/projection" | grep -ci 'champion'`
Expected: ≥ 1 (the sr-only block's "champion" text is present in server HTML, proving crawlable content).

- [ ] **Step 5: Verify per-pair route + pre-selection**

Pick a pair in the UI; confirm the URL changes to `/tournaments/<id>/projection/<slug>` (`preview_eval: window.location.pathname`). Open that URL fresh; confirm ProjectionTab opens on that pair's road (`preview_snapshot`).

- [ ] **Step 6: Verify canonical redirect**

Run: `curl -sI "http://localhost:3002/tournaments/<id>/projection/<reversed-surname-slug>" | grep -iE 'HTTP|location'`
Expected: `308` with `location` pointing at the canonical slug.

- [ ] **Step 7: Verify unknown pair 404s**

Run: `curl -s -o /dev/null -w "%{http_code}" "http://localhost:3002/tournaments/<id>/projection/nobody-here"`
Expected: `404`.

- [ ] **Step 8: Screenshot proof**

`preview_screenshot` the tournament-level and a per-pair route for the PR.

---

## Task 11: Projection sitemap

**Files:**
- Create: `src/app/sitemap-projections.xml/route.ts`
- Modify: `src/app/sitemap.xml/route.ts`

- [ ] **Step 1: Write the child sitemap**

```ts
// src/app/sitemap-projections.xml/route.ts
// Child sitemap — every computed projection (tournament-level + per-pair),
// one <url> per locale. Bounded by tournament_projections (only computed
// tournaments have rows). Emits nothing when the projection flag is off.

import { createServerClient } from '@/lib/supabase'
import { buildUrlSet, expandPathForLocales, xmlResponse, type SitemapUrl } from '@/lib/sitemap-xml'
import { buildSlugIndex } from '@/lib/projection-slug'
import { isProjectionEnabledServer, fetchPlayerNames } from '@/lib/projection-server'
import { paginatedSelect } from '@/lib/db-paginate'

const BASE_URL = 'https://padelnachos.com'
export const revalidate = 3600

interface ProjRow { tournament_id: string; category: 'men' | 'women'; pair_key: string; pair_player_ids: string[]; computed_at: string | null }

export async function GET() {
  if (!(await isProjectionEnabledServer())) {
    return xmlResponse(buildUrlSet([]), revalidate)
  }

  const supabase = createServerClient()
  let rows: ProjRow[]
  try {
    rows = await paginatedSelect<ProjRow>(
      (start, end) => supabase
        .from('tournament_projections')
        .select('tournament_id, category, pair_key, pair_player_ids, computed_at')
        .range(start, end),
      { what: 'tournament_projections sitemap read' },
    )
  } catch {
    return xmlResponse(buildUrlSet([]), revalidate)
  }

  const nameById = await fetchPlayerNames(rows.flatMap((r) => r.pair_player_ids))

  // Tournament-level URLs: one per (tournament, category) present.
  const tournamentCategories = new Set<string>()
  for (const r of rows) tournamentCategories.add(`${r.tournament_id}::${r.category}`)

  const urls: SitemapUrl[] = []
  for (const key of tournamentCategories) {
    const [tid, category] = key.split('::')
    urls.push(...expandPathForLocales(BASE_URL, `/tournaments/${tid}/projection`, {
      changefreq: 'daily',
      priority: 0.6,
    }))
    // category is encoded as a query param on the canonical URL; the bare
    // path is the men/default. Women adds ?category=women.
    if (category === 'women') {
      urls.push(...expandPathForLocales(BASE_URL, `/tournaments/${tid}/projection?category=women`, {
        changefreq: 'daily',
        priority: 0.5,
      }))
    }
  }

  // Per-pair URLs, grouped by tournament so slugs resolve within their set.
  const byTournament = new Map<string, ProjRow[]>()
  for (const r of rows) {
    const arr = byTournament.get(r.tournament_id) ?? []
    arr.push(r)
    byTournament.set(r.tournament_id, arr)
  }
  for (const [tid, tRows] of byTournament) {
    const { pairKeyToSlug } = buildSlugIndex(tRows, nameById)
    for (const r of tRows) {
      const slug = pairKeyToSlug.get(r.pair_key)
      if (!slug) continue
      urls.push(...expandPathForLocales(BASE_URL, `/tournaments/${tid}/projection/${slug}`, {
        lastmod: r.computed_at ? new Date(r.computed_at).toISOString() : undefined,
        changefreq: 'daily',
        priority: 0.5,
      }))
    }
  }

  return xmlResponse(buildUrlSet(urls), revalidate)
}
```

- [ ] **Step 2: Register in the sitemap index**

In `src/app/sitemap.xml/route.ts`, add the projections child to the `buildSitemapIndex([...])` array (after `sitemap-news.xml`):

```tsx
    { loc: `${BASE_URL}/sitemap-projections.xml`, lastmod: now },
```

- [ ] **Step 3: Verify the sitemap renders**

Run: `npm run build && (npm run start &) ; sleep 6 ; curl -s "http://localhost:3002/sitemap-projections.xml" | head -20 ; curl -s "http://localhost:3002/sitemap.xml" | grep -c sitemap-projections`
Expected: child sitemap is valid `<urlset>` XML; index references it once. (Stop the server after.)

> If `npm run start` isn't convenient, instead verify with the dev server already running from Task 10: `curl -s "http://localhost:3002/sitemap-projections.xml" | head`.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/sitemap-projections.xml/route.ts' 'src/app/sitemap.xml/route.ts'
git commit -m "feat(projection): sitemap-projections.xml + index registration"
```

---

## Task 12: E2E coverage (Playwright)

**Files:**
- Create: `tests/e2e/projection-urls.spec.ts` (adjust path to match the repo's existing Playwright test dir — check `playwright.config.*` for `testDir`).

- [ ] **Step 1: Confirm the Playwright test location + a seedable tournament**

Run: `ls playwright.config.* 2>/dev/null; grep -rn 'testDir' playwright.config.* 2>/dev/null; ls tests 2>/dev/null e2e 2>/dev/null`
Use the discovered `testDir`. Pick a tournament id that reliably has projections in the test DB (or document the env var the suite uses for a fixture tournament).

- [ ] **Step 2: Write the spec**

```ts
// tests/e2e/projection-urls.spec.ts
import { test, expect } from '@playwright/test'

// Replace with a tournament id known to have projection rows in the target env.
const TID = process.env.E2E_PROJECTION_TOURNAMENT_ID ?? ''

test.skip(!TID, 'E2E_PROJECTION_TOURNAMENT_ID not set')

test('tournament-level projection renders server SEO content', async ({ page }) => {
  const res = await page.goto(`/tournaments/${TID}/projection`)
  expect(res?.status()).toBe(200)
  // sr-only SEO block is in the DOM (hidden but present)
  await expect(page.locator('section.sr-only', { hasText: 'champion' }).first()).toBeAttached()
})

test('picking a pair updates the URL to a slug route', async ({ page }) => {
  await page.goto(`/tournaments/${TID}/projection`)
  // The first pair row in ProjectionTab's picker list.
  await page.getByRole('button').filter({ hasText: /%/ }).first().click()
  await expect(page).toHaveURL(new RegExp(`/tournaments/${TID}/projection/[a-z0-9-]+`))
})

test('unknown pair slug 404s', async ({ page }) => {
  const res = await page.goto(`/tournaments/${TID}/projection/nobody-here`)
  expect(res?.status()).toBe(404)
})
```

> Selector note: confirm the picker row is a `button` containing `%`; if `ProjectionPickerList` uses a different element/role, adjust the selector after inspecting `preview_snapshot` in Task 10.

- [ ] **Step 3: Run the E2E (against the dev server)**

Run: `E2E_PROJECTION_TOURNAMENT_ID=<id> npx playwright test projection-urls`
Expected: 3 passing (or skipped if no id available — set the id for a real run).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/projection-urls.spec.ts
git commit -m "test(projection): E2E for projection routes (SEO content, pair URL sync, 404)"
```

---

## Task 13: Final verification + branch wrap-up

**Files:** none

- [ ] **Step 1: Full lint + typecheck + unit**

Run: `npm run lint && npx tsc --noEmit && npx vitest run src/lib/__tests__/projection-slug.test.ts`
Expected: all clean / passing.

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: success; the two new routes appear in the build output route list.

- [ ] **Step 3: Re-run the manual SEO proof (Task 10 Steps 4, 6, 7) and capture screenshots for the PR.**

- [ ] **Step 4: Use the finishing-a-development-branch skill** to decide merge/PR/cleanup.

---

## Self-Review (completed during planning)

**Spec coverage:**
- §1 routes → Tasks 7, 8 ✓
- §2 pair slug + canonical redirect → Tasks 1, 8 ✓
- §3 shared chrome → Tasks 5, 6, 9 (pragmatic deviation documented in header + Architecture) ✓
- §4 SEO (metadata, sitemap, noindex empty) → Tasks 7, 8, 11 ✓
- §5 interaction/data flow → Tasks 3, 6 (URL sync), 4 (SSR content) ✓
- §6 feature-flag server gating → Task 2 (`isProjectionEnabledServer`), used in Tasks 7, 8, 11 ✓ (open question resolved: flag IS server-readable)
- §7 error handling (unknown→404, stale→308, empty→noindex, DB-down→safe) → Tasks 2 (try/catch), 7, 8 ✓
- §8 testing (unit slug, E2E, curl SEO proof) → Tasks 1, 10, 12 ✓

**Placeholder scan:** No TBDs. The one prose caveat in Task 9 Step 3 (`pairQs` is intentionally empty — legacy pair_key isn't slug-mappable without the row set, so legacy pair deep links land on the tournament-level route, which is acceptable) is documented, not a gap.

**Type consistency:** `ProjectionCategory`, `ProjectionRow`, `ProjectionTournamentMeta`, `buildSlugIndex`/`resolvePairSlug`/`pairKeyToSlug`, `isProjectionEnabledServer`, `fetchProjectionRows`/`fetchProjectionCategories`/`fetchPlayerNames`/`fetchProjectionTournamentMeta`, and `onPairChange` are used consistently across tasks.
