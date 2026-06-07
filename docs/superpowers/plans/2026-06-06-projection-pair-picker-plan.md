# Projection — entry-list pair picker: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `<select>` pair dropdown in the Projection tab with a tappable entry-list picker — top-4 active seeds as big-photo feature cards, everyone else as compact rows, eliminated greyed at the bottom; tap → road, back → list.

**Architecture:** A pure ordering module (`projection-picker.ts`) partitions/sorts the `tournament_projections` rows by seed. A `usePairImages` hook fetches `photo_url`/`avatar_url`. `ProjectionPickerList` renders the list. `ProjectionTab` gains a `list`/`road` view toggle, builds a `resolvePlayer` resolver, removes the dropdown, and adds a back button to the road.

**Tech Stack:** Next.js client components, React 19, TypeScript, Supabase anon client, next-intl, vitest.

**Spec:** `docs/superpowers/specs/2026-06-06-projection-pair-picker-design.md`
**Branch:** `feat/projection-picker` (stacked on `feat/projection-polish` / PR #524).

---

## Key current state (verified)

- `ProjectionTab.tsx` props: `{ tournamentId, matches: Match[], category: 'men'|'women', tournamentLevel, roundSchedule, initialPairKey? }`. It has `rows` (from `useProjection`), `lookup = buildPlayerLookup(matches)`, `selectedPair`/`expanded` state, `activePair`, `row`, `vm`, a loading + empty(locked) early-return, then the `<select>` dropdown (to remove) + the road (`{vm && (…)}`).
- `useProjection(tournamentId, category)` → `{ rows: ProjectionRow[], loading, error }`. `ProjectionRow` has `pair_key`, `pair_player_ids: string[]`, `champion_prob`, `status: 'active'|'eliminated'|'champion'`, `eliminated_round`, `rounds`.
- `Match` (`@/types/match`): `pair1_player1/2`, `pair2_player1/2` (each `Player|null` with `id, name, display_name?, country, avatar_url`), `pair1_seed?: number|null`, `pair2_seed?: number|null`.
- `players` table has `avatar_url` (headshot) + `photo_url` (full image), public-read.
- Helpers in `projection-view.ts`: `buildPlayerLookup`, `buildRoadVM`, `pickDefaultProjectionPair`, `ROUND_LABEL_KEY`, `RoadOpponentVM`. `pickDefaultProjectionPair` becomes unused (list-first); remove its import + the `useFollowing`/`bookmarked`/`defaultPair` in ProjectionTab.
- Design tokens already in ProjectionTab: `CARD, TEXT, MUTED, SECONDARY, LIME, GOLD, LIVE, CHUNK_CARD, MONO`, `winColor`, `pairName`.

---

## Task 1: Pure picker ordering

**Files:**
- Create: `src/lib/projection-picker.ts`
- Test: `src/lib/__tests__/projection-picker.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/__tests__/projection-picker.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import type { Match, Player } from '@/types/match'
import type { ProjectionRow } from '@/lib/projection-types'
import { buildSeedMap, orderPickerPairs, pairKeyFromIds } from '@/lib/projection-picker'

function player(id: string): Player { return { id, external_id: id, name: id, country: 'ES', avatar_url: null } }
function row(key: string, ids: [string, string], champ: number, status: ProjectionRow['status'] = 'active'): ProjectionRow {
  return { tournament_id: 't', category: 'men', pair_key: key, pair_player_ids: ids, tournament_level: 'p1',
    status, eliminated_round: status === 'eliminated' ? 'R16' : null, champion_prob: champ, finalist_prob: 0, semifinal_prob: 0, rounds: [], computed_at: 'now' }
}

describe('buildSeedMap', () => {
  it('maps a pair key to its seed from matches', () => {
    const m = {
      id: 'm', external_id: 'e', status: 'scheduled', coverage: null, pusher_channel: null, round: 'SF',
      court: null, scheduled_at: null, started_at: null, finished_at: null, winner_pair: null,
      pair1_player1: player('a'), pair1_player2: player('b'), pair2_player1: player('c'), pair2_player2: player('d'),
      pair1_seed: 1, pair2_seed: null,
    } as Match
    const map = buildSeedMap([m])
    expect(map.get(pairKeyFromIds('a', 'b'))).toBe(1)
    expect(map.has(pairKeyFromIds('c', 'd'))).toBe(false) // null seed not recorded
  })
})

describe('orderPickerPairs', () => {
  const seed = new Map<string, number>([['s1', 1], ['s2', 2], ['s3', 3], ['s4', 4], ['s5', 5]])
  const rows = [
    row('u1', ['u', '1'], 0.04),                 // unseeded active
    row('s3', ['s', '3'], 0.10),
    row('s1', ['s', '1'], 0.40),
    row('s5', ['s', '5'], 0.02),
    row('s2', ['s', '2'], 0.20),
    row('s4', ['s', '4'], 0.08),
    row('e1', ['e', '1'], 0, 'eliminated'),      // eliminated (seeded)
  ]
  const seedMap = new Map<string, number>([['s1', 1], ['s2', 2], ['s3', 3], ['s4', 4], ['s5', 5], ['e1', 6]])

  it('features the top 4 active by seed; rest after; eliminated at the bottom', () => {
    const { feature, rest, eliminated } = orderPickerPairs(rows, seedMap)
    expect(feature.map(r => r.pair_key)).toEqual(['s1', 's2', 's3', 's4'])
    expect(rest.map(r => r.pair_key)).toEqual(['s5', 'u1']) // seed 5 before unseeded
    expect(eliminated.map(r => r.pair_key)).toEqual(['e1'])
  })

  it('no feature cards when fewer than 2 seeded active pairs', () => {
    const justOne = [row('s1', ['s', '1'], 0.4), row('u1', ['u', '1'], 0.1), row('u2', ['u', '2'], 0.2)]
    const { feature, rest } = orderPickerPairs(justOne, new Map([['s1', 1]]))
    expect(feature).toEqual([])
    expect(rest.map(r => r.pair_key)).toEqual(['s1', 'u2', 'u1']) // seeded first, then unseeded by champ desc
  })
})
```

- [ ] **Step 2: Run, confirm fail**

Run: `npx vitest run src/lib/__tests__/projection-picker.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** `src/lib/projection-picker.ts`:
```ts
import type { Match } from '@/types/match'
import type { ProjectionRow } from '@/lib/projection-types'

/** Order-independent pair key, mirrors the worker/view convention. */
export function pairKeyFromIds(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`
}

/** pair_key → seed, derived from matches (only top 8/16 are seeded). */
export function buildSeedMap(matches: Match[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const m of matches) {
    if (m.pair1_player1?.id && m.pair1_player2?.id && m.pair1_seed != null) {
      map.set(pairKeyFromIds(m.pair1_player1.id, m.pair1_player2.id), m.pair1_seed)
    }
    if (m.pair2_player1?.id && m.pair2_player2?.id && m.pair2_seed != null) {
      map.set(pairKeyFromIds(m.pair2_player1.id, m.pair2_player2.id), m.pair2_seed)
    }
  }
  return map
}

export interface OrderedPicker {
  feature: ProjectionRow[]
  rest: ProjectionRow[]
  eliminated: ProjectionRow[]
}

/** Active pairs by seed (seeded asc, then unseeded by champion desc); the top 4
 *  active become feature cards. Eliminated pairs (greyed) sink to the bottom. */
export function orderPickerPairs(
  rows: ProjectionRow[],
  seedByPair: Map<string, number>,
): OrderedPicker {
  const bySeedThenChamp = (a: ProjectionRow, b: ProjectionRow) => {
    const sa = seedByPair.get(a.pair_key)
    const sb = seedByPair.get(b.pair_key)
    if (sa != null && sb != null) return sa - sb
    if (sa != null) return -1
    if (sb != null) return 1
    return b.champion_prob - a.champion_prob
  }
  const active = rows.filter((r) => r.status !== 'eliminated').sort(bySeedThenChamp)
  const eliminated = rows.filter((r) => r.status === 'eliminated').sort(bySeedThenChamp)

  const seededActive = active.filter((r) => seedByPair.get(r.pair_key) != null).length
  const featureCount = seededActive >= 2 ? Math.min(4, active.length) : 0
  return { feature: active.slice(0, featureCount), rest: active.slice(featureCount), eliminated }
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `npx vitest run src/lib/__tests__/projection-picker.test.ts` → PASS. `npx tsc --noEmit 2>&1 | grep projection-picker || echo CLEAN`.

- [ ] **Step 5: Commit**
```bash
git add src/lib/projection-picker.ts src/lib/__tests__/projection-picker.test.ts
git commit -m "feat(projection-ui): pure picker ordering (seed map + feature/rest/eliminated)"
```

---

## Task 2: `usePairImages` hook

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/usePairImages.ts`

- [ ] **Step 1: Implement**
```ts
'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface PairImage {
  name: string | null
  country: string | null
  avatarUrl: string | null
  photoUrl: string | null
}

/** Fetches name + headshot + full photo for a set of player ids (public read).
 *  Keyed by a sorted-id string so it only refetches when the id set changes. */
export function usePairImages(playerIds: string[]): Map<string, PairImage> {
  const [map, setMap] = useState<Map<string, PairImage>>(new Map())
  const key = [...playerIds].sort().join(',')
  useEffect(() => {
    if (playerIds.length === 0) { setMap(new Map()); return }
    let cancelled = false
    supabase
      .from('players')
      .select('id, name, country, avatar_url, photo_url')
      .in('id', playerIds)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { console.warn('[usePairImages] fetch failed:', error); return }
        const m = new Map<string, PairImage>()
        for (const p of (data ?? []) as Array<{ id: string; name: string | null; country: string | null; avatar_url: string | null; photo_url: string | null }>) {
          m.set(p.id, { name: p.name, country: p.country, avatarUrl: p.avatar_url, photoUrl: p.photo_url })
        }
        setMap(m)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return map
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep usePairImages || echo CLEAN`.
```bash
git add "src/app/[locale]/(app)/tournaments/[id]/usePairImages.ts"
git commit -m "feat(projection-ui): usePairImages hook (headshot + full photo)"
```

---

## Task 3: i18n keys

**Files:**
- Modify: `src/messages/{en,es,pt,it,fr}.json`

- [ ] **Step 1: Add keys to the `projectionTab` namespace in all 5 files**

en: `"pickAPair": "Pick a pair"`, `"pickHint": "Tap a pair to see its road to the trophy"`, `"topSeeds": "Top seeds"`, `"allPairs": "All pairs"`, `"back": "Back"`
es: `"Elige una pareja"`, `"Toca una pareja para ver su camino al título"`, `"Cabezas de serie"`, `"Todas las parejas"`, `"Atrás"`
pt: `"Escolhe uma dupla"`, `"Toque numa dupla para ver o caminho ao título"`, `"Cabeças de série"`, `"Todas as duplas"`, `"Voltar"`
it: `"Scegli una coppia"`, `"Tocca una coppia per vedere la strada verso il titolo"`, `"Teste di serie"`, `"Tutte le coppie"`, `"Indietro"`
fr: `"Choisis une paire"`, `"Touchez une paire pour voir sa route vers le titre"`, `"Têtes de série"`, `"Toutes les paires"`, `"Retour"`

- [ ] **Step 2: Validate + commit**

Run: `node -e "for(const l of ['en','es','pt','it','fr']){const m=require('./src/messages/'+l+'.json');for(const k of ['pickAPair','pickHint','topSeeds','allPairs','back'])if(!m.projectionTab[k])throw new Error(l+' '+k)}console.log('i18n OK')"`
```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "feat(projection-ui): i18n for the pair picker (5 locales)"
```

---

## Task 4: `ProjectionPickerList` component

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/ProjectionPickerList.tsx`

- [ ] **Step 1: Implement** (mirrors the approved mockup; consumes a `resolvePlayer` resolver + `onPick`):
```tsx
'use client'
import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import Avatar from '@/components/Avatar'
import type { ProjectionRow } from '@/lib/projection-types'
import { orderPickerPairs, type OrderedPicker } from '@/lib/projection-picker'

const CARD = 'rgba(255,255,255,0.03)'
const TEXT = '#EEE4CE'
const MUTED = '#6B7280'
const SECONDARY = '#9AAEC4'
const LIME = '#7ED321'
const GOLD = '#F5A623'
const LIVE = '#FF4655'
const CHUNK = 'polygon(0% 4%, 99.5% 0%, 100% 96%, 0.5% 100%)'
const BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'
const MONO = 'ui-monospace, "SF Mono", monospace'

export interface ResolvedPlayer { name: string; country: string | null; avatarUrl: string | null; photoUrl: string | null }

function lastName(name: string): string {
  return name.split(' ').slice(-1)[0] || name
}
function champColor(p: number): string {
  return p >= 0.2 ? LIME : p >= 0.08 ? GOLD : SECONDARY
}

export default function ProjectionPickerList({
  rows,
  seedByPair,
  resolvePlayer,
  onPick,
}: {
  rows: ProjectionRow[]
  seedByPair: Map<string, number>
  resolvePlayer: (id: string) => ResolvedPlayer
  onPick: (pairKey: string) => void
}) {
  const t = useTranslations('projectionTab')
  const ordered: OrderedPicker = useMemo(() => orderPickerPairs(rows, seedByPair), [rows, seedByPair])

  const names = (r: ProjectionRow) => r.pair_player_ids.map((id) => lastName(resolvePlayer(id).name)).join(' / ')
  const seedOf = (r: ProjectionRow) => seedByPair.get(r.pair_key) ?? null

  return (
    <div>
      <div style={{ color: TEXT, fontSize: 14, fontWeight: 800 }}>{t('pickAPair')}</div>
      <div style={{ color: SECONDARY, fontSize: 11, marginTop: 2, marginBottom: 14 }}>{t('pickHint')}</div>

      {ordered.feature.length > 0 && (
        <>
          <div style={{ color: SECONDARY, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.7, margin: '0 0 8px 2px' }}>{t('topSeeds')}</div>
          {ordered.feature.map((r, i) => {
            const [id1, id2] = r.pair_player_ids
            const p1 = resolvePlayer(id1); const p2 = resolvePlayer(id2)
            const lead = i === 0
            return (
              <button key={r.pair_key} onClick={() => onPick(r.pair_key)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer',
                  background: lead ? 'linear-gradient(90deg, rgba(126,211,33,0.10), rgba(255,255,255,0.03))' : CARD,
                  border: `1px solid ${lead ? 'rgba(126,211,33,0.22)' : 'rgba(255,255,255,0.07)'}`,
                  padding: '8px 12px 8px 8px', marginBottom: 8, clipPath: CHUNK }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', flexShrink: 0 }}>
                  <FeaturePhoto p={p1} />
                  <div style={{ marginLeft: -14, borderLeft: '2px solid #1A1A1A', borderRadius: 8 }}><FeaturePhoto p={p2} /></div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {seedOf(r) != null && <span style={{ background: 'rgba(255,255,255,0.1)', color: TEXT, fontSize: 9, fontWeight: 800, padding: '1px 6px', clipPath: BADGE }}>{seedOf(r)}</span>}
                    <span style={{ color: MUTED, fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>{t('topSeeds').slice(0, 0)}seed</span>
                  </div>
                  <div style={{ color: TEXT, fontSize: 14, fontWeight: 800, marginTop: 3 }}>{names(r)}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ color: champColor(r.champion_prob), fontSize: 22, fontWeight: 800, lineHeight: 1, fontFamily: MONO }}>{Math.round(r.champion_prob * 100)}%</div>
                  <div style={{ color: MUTED, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 1 }}>{t('champion')}</div>
                </div>
                <div style={{ color: '#4A6F8E', fontSize: 16 }}>›</div>
              </button>
            )
          })}
        </>
      )}

      {ordered.rest.length > 0 && (
        <div style={{ color: SECONDARY, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.7, margin: '6px 0 8px 2px' }}>{t('allPairs')}</div>
      )}
      {ordered.rest.map((r) => <CompactRow key={r.pair_key} r={r} names={names(r)} seed={seedOf(r)} resolvePlayer={resolvePlayer} onPick={onPick} />)}
      {ordered.eliminated.map((r) => <CompactRow key={r.pair_key} r={r} names={names(r)} seed={seedOf(r)} resolvePlayer={resolvePlayer} onPick={onPick} eliminated />)}
    </div>
  )
}

function FeaturePhoto({ p }: { p: ResolvedPlayer }) {
  const src = p.photoUrl ?? p.avatarUrl
  if (src) {
    return <img src={src} alt={p.name} style={{ width: 48, height: 60, objectFit: 'cover', objectPosition: 'top', borderRadius: 8, background: '#222' }} />
  }
  return <div style={{ width: 48, height: 60, borderRadius: 8, background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontWeight: 800 }}>{p.name?.[0] ?? '?'}</div>
}

function CompactRow({ r, names, seed, resolvePlayer, onPick, eliminated }: {
  r: ProjectionRow; names: string; seed: number | null
  resolvePlayer: (id: string) => ResolvedPlayer; onPick: (k: string) => void; eliminated?: boolean
}) {
  const t = useTranslations('projectionTab')
  const [id1, id2] = r.pair_player_ids
  const p1 = resolvePlayer(id1); const p2 = resolvePlayer(id2)
  const grey = eliminated ? { filter: 'grayscale(1)' as const } : {}
  return (
    <button onClick={() => onPick(r.pair_key)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer',
        background: eliminated ? 'rgba(255,255,255,0.02)' : CARD, border: '1px solid rgba(255,255,255,0.06)',
        padding: '8px 12px', marginBottom: 6, clipPath: CHUNK, opacity: eliminated ? 0.55 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <Avatar src={p1.avatarUrl} alt={p1.name} size={28} fallback={p1.name?.[0]} unoptimized style={{ border: '2px solid var(--bg-card)', ...grey }} />
        <div style={{ marginLeft: -9 }}><Avatar src={p2.avatarUrl} alt={p2.name} size={28} fallback={p2.name?.[0]} unoptimized style={{ border: '2px solid var(--bg-card)', ...grey }} /></div>
      </div>
      <div style={{ flex: 1, color: TEXT, fontSize: 13, fontWeight: 600 }}>
        {names}{seed != null && <span style={{ color: MUTED, fontSize: 9, fontWeight: 700, marginLeft: 6 }}>[{seed}]</span>}
      </div>
      {eliminated
        ? <div style={{ color: LIVE, fontSize: 9, fontWeight: 800, textTransform: 'uppercase' }}>{t('out')}{r.eliminated_round ? ` · ${r.eliminated_round}` : ''}</div>
        : <div style={{ color: champColor(r.champion_prob), fontSize: 14, fontWeight: 800, fontFamily: MONO }}>{Math.round(r.champion_prob * 100)}%</div>}
      <div style={{ color: '#4A6F8E', fontSize: 15 }}>›</div>
    </button>
  )
}
```
NOTE: remove the awkward `{t('topSeeds').slice(0,0)}seed` placeholder — render the literal lowercase word via a dedicated key. Add `"seed": "seed"` to the `projectionTab` namespace (Task 3) and use `{t('seed')}` there. (Update Task 3 to include `seed`/`Cabeza`/`Cabeça`/`Testa`/`Tête` — or keep it simple: en "seed", es "serie", pt "série", it "serie", fr "série". Pick short labels.)

- [ ] **Step 2: Typecheck + lint + commit**

Run: `npx tsc --noEmit 2>&1 | grep ProjectionPickerList || echo CLEAN` and `npx eslint "src/app/[locale]/(app)/tournaments/[id]/ProjectionPickerList.tsx"`.
```bash
git add "src/app/[locale]/(app)/tournaments/[id]/ProjectionPickerList.tsx"
git commit -m "feat(projection-ui): ProjectionPickerList (feature cards + compact rows + eliminated)"
```

---

## Task 5: Wire `ProjectionTab` (view toggle, resolver, remove dropdown, back button)

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx`

- [ ] **Step 1: Imports**

Add:
```ts
import { useCallback } from 'react'   // merge into the existing react import
import ProjectionPickerList, { type ResolvedPlayer } from './ProjectionPickerList'
import { buildSeedMap } from '@/lib/projection-picker'
import { usePairImages } from './usePairImages'
```
Remove the now-unused `useFollowing` import and `pickDefaultProjectionPair` from the `projection-view` import.

- [ ] **Step 2: Replace the state/derivation block**

Replace (current lines ~70-82, the `bookmarked`/`defaultPair`/`activePair` block) with:
```ts
  const lookup = useMemo(() => buildPlayerLookup(matches), [matches])
  const seedByPair = useMemo(() => buildSeedMap(matches), [matches])
  const playerIds = useMemo(
    () => [...new Set(rows.flatMap((r) => r.pair_player_ids))],
    [rows],
  )
  const images = usePairImages(playerIds)
  const resolvePlayer = useCallback((id: string): ResolvedPlayer => {
    const img = images.get(id)
    const p = lookup.get(id)
    return {
      name: img?.name ?? p?.display_name ?? p?.name ?? '',
      country: img?.country ?? p?.country ?? null,
      avatarUrl: img?.avatarUrl ?? p?.avatar_url ?? null,
      photoUrl: img?.photoUrl ?? null,
    }
  }, [images, lookup])

  const [view, setView] = useState<'list' | 'road'>(initialPairKey ? 'road' : 'list')
  const [selectedPair, setSelectedPair] = useState<string | null>(initialPairKey ?? null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const row = useMemo(() => rows.find((r) => r.pair_key === selectedPair) ?? null, [rows, selectedPair])
  const vm = useMemo(() => (row ? buildRoadVM(row, lookup, roundSchedule) : null), [row, lookup, roundSchedule])
```
(`buildPlayerLookup`, `buildRoadVM` imports stay.)

- [ ] **Step 3: Render the list vs road**

Keep the `loading` and `rows.length === 0` early returns. Replace the `return ( … dropdown … {vm && road} … )` with:
```tsx
  // List view (default, or when no valid pair is selected).
  if (view === 'list' || !vm) {
    return (
      <div style={{ padding: '14px 13px 24px' }}>
        <ProjectionPickerList
          rows={rows}
          seedByPair={seedByPair}
          resolvePlayer={resolvePlayer}
          onPick={(key) => { setSelectedPair(key); setExpanded(new Set()); setView('road') }}
        />
      </div>
    )
  }

  // Road view (selected pair) with a back-to-list control.
  return (
    <div style={{ padding: '14px 13px 24px' }}>
      <button onClick={() => setView('list')}
        style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: SECONDARY, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, padding: '0 0 12px 2px' }}>
        ‹ {t('back')}
      </button>
      {/* existing road JSX — the champion hero + PROJECTED PATH + rounds — unchanged */}
      …
    </div>
  )
```
KEEP the existing road JSX (champion hero, progress bar, sparkline, PROJECTED PATH header, the `vm.rounds.map(...)` block, footer) exactly as-is; just move it inside this road-view return, after the back button. Remove the old `<select>` dropdown block entirely.

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit 2>&1 | grep ProjectionTab || echo CLEAN` (the `pairName`/`winColor`/`bookmarked` removals must leave no unused-symbol errors — delete any now-unused local like `pairName` if it's no longer referenced, or keep if the road still uses it). Run `npx eslint "src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx"` and fix unused-import/var warnings (e.g. removed `useFollowing`).

- [ ] **Step 5: Commit**
```bash
git add "src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx"
git commit -m "feat(projection-ui): list/road view toggle — entry-list picker replaces the dropdown"
```

---

## Task 6: Verify live + handle the `seed` label

**Files:** none (verification) — plus confirm the `seed` i18n key from Task 4/3.

- [ ] **Step 1: Ensure the `seed` label key exists**

Confirm `projectionTab.seed` exists in all 5 locales (en `"seed"`, es `"serie"`, pt `"série"`, it `"serie"`, fr `"série"`) and `ProjectionPickerList` uses `{t('seed')}` (not the `.slice(0,0)` placeholder). If missing, add + commit.

- [ ] **Step 2: Run the public app + verify**

Per `memory/feedback_test-locally.md`: `npm run dev` (the `projection_enabled` flag is on for localhost). Open ITALY MAJOR's Projection tab:
- The tab opens on the **picker list** (no dropdown): top-4 seed **feature cards** with big `photo_url` images, compact rows below, eliminated greyed at the bottom, champion % on each.
- **Tap a pair** → its road; the **‹ Back** control returns to the list.
- The **player-card deep-link** (`/player/<id>` → "Road to trophy") still lands directly on the road; Back → list.
Capture console; confirm no errors.

- [ ] **Step 3: Commit any fixes; report**

---

## Self-review (done during authoring)

**Spec coverage:** list/road toggle + back + deep-link → Task 5; top-4 active seeds feature cards w/ photo_url + fallback → Task 4 (`FeaturePhoto`); compact rows + eliminated greyed at bottom → Task 4 (`CompactRow`) + Task 1 ordering; champion % per row → Task 4; seed from matches → Task 1 (`buildSeedMap`); photo_url fetch → Task 2; ordering strictly-by-seed + eliminated-bottom + feature=top-4-active → Task 1 (tested); i18n → Task 3; remove dropdown → Task 5; no worker/migration → confirmed. ✓

**Placeholder scan:** one intentional flag — the `{t('topSeeds').slice(0,0)}seed` stub in Task 4 is explicitly called out and replaced by a `seed` i18n key in Task 6 Step 1 (and Task 3 should include it). Otherwise concrete.

**Type consistency:** `pairKeyFromIds`, `buildSeedMap`, `orderPickerPairs`/`OrderedPicker`, `usePairImages`/`PairImage`, `ProjectionPickerList`/`ResolvedPlayer`, `resolvePlayer`, `view` state used consistently across tasks. `ProjectionRow` fields (`pair_key`, `pair_player_ids`, `champion_prob`, `status`, `eliminated_round`) match the existing type.

## Note
Stacked on `feat/projection-polish` (PR #524). Rebase on `main` after #524 merges.
