# Matches Page — Apple-Sports Tabs + Filter Sheet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the Matches page into three time-based tabs (Yesterday · Today · Upcoming) with inline dates, pull the sub-filters into a bottom sheet behind a filter icon, pin a Live Now strip on Today, and swap the dark tournament header block for a light text header.

**Architecture:** One main page file rewrite (`src/app/[locale]/(app)/matches/page.tsx`) plus two extracted presentational components (`MatchesTabs`, `MatchesFilterSheet`) and one pure-helper lib (`matches-filters.ts`) with unit tests. All filtering is client-side over already-fetched arrays. Date boundaries respect the user's timezone from the `geo-timezone` cookie. No changes to `V3MatchRow`, `ResultCard`, `FlagImage`, `useSwipeTabs`, or `groupByTournament`.

**Tech Stack:** Next.js 16, React 19, TypeScript, next-intl, Tailwind, Vitest for unit tests. The existing `useFollowing()` hook (from `src/hooks/useFollowing.ts`) supplies favourite state for the Favourites-only filter.

**Spec:** [docs/superpowers/specs/2026-04-19-matches-apple-tabs-design.md](../specs/2026-04-19-matches-apple-tabs-design.md)

---

## File structure

| File | Create / Modify | Responsibility |
|---|---|---|
| `src/lib/matches-filters.ts` | **Create** | Pure helpers: date-window calc, filter predicate |
| `src/lib/__tests__/matches-filters.test.ts` | **Create** | Unit tests for the helpers (Vitest) |
| `src/components/MatchesTabs.tsx` | **Create** | Tabs row with stacked label + date + filter icon |
| `src/components/MatchesFilterSheet.tsx` | **Create** | Bottom-sheet filter UI (Circuit / Gender / Level / toggles) |
| `src/app/[locale]/(app)/matches/page.tsx` | **Modify** | Main rewrite: state, slicing, Live Now strip, header, chip strip, back-compat |
| `src/messages/en.json` | **Modify** | New i18n keys under `matches.*` |
| `src/messages/es.json` | **Modify** | Translations |
| `src/messages/pt.json` | **Modify** | Translations |
| `src/messages/it.json` | **Modify** | Translations |
| `src/messages/fr.json` | **Modify** | Translations |

---

## Task 1: Pure helpers + unit tests (TDD)

**Files:**
- Create: `src/lib/matches-filters.ts`
- Create: `src/lib/__tests__/matches-filters.test.ts`

- [ ] **Step 1.1: Write failing tests for date-window helpers**

Create `src/lib/__tests__/matches-filters.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  computeDateWindow,
  tabForLegacyParam,
  applyFilters,
  type MatchFilters,
} from '../matches-filters'

describe('computeDateWindow', () => {
  it('returns yesterday/today/tomorrow boundaries in user tz — UTC', () => {
    const now = new Date('2026-04-19T10:30:00Z')
    const w = computeDateWindow(now, 'UTC')
    expect(w.yesterdayStart).toBe('2026-04-18T00:00:00.000Z')
    expect(w.todayStart).toBe('2026-04-19T00:00:00.000Z')
    expect(w.tomorrowStart).toBe('2026-04-20T00:00:00.000Z')
  })

  it('shifts boundaries for America/New_York (UTC-4 in April)', () => {
    // 2026-04-19 02:30 UTC = 2026-04-18 22:30 ET → "today" in ET is still Apr 18
    const now = new Date('2026-04-19T02:30:00Z')
    const w = computeDateWindow(now, 'America/New_York')
    expect(w.yesterdayStart).toBe('2026-04-17T04:00:00.000Z') // Apr 17 00:00 ET
    expect(w.todayStart).toBe('2026-04-18T04:00:00.000Z')     // Apr 18 00:00 ET
    expect(w.tomorrowStart).toBe('2026-04-19T04:00:00.000Z')  // Apr 19 00:00 ET
  })

  it('falls back to UTC for invalid timezone', () => {
    const now = new Date('2026-04-19T10:30:00Z')
    const w = computeDateWindow(now, 'Not/A_Zone')
    expect(w.todayStart).toBe('2026-04-19T00:00:00.000Z')
  })
})

describe('tabForLegacyParam', () => {
  it('maps legacy tab values to new ones', () => {
    expect(tabForLegacyParam('live')).toBe('today')
    expect(tabForLegacyParam('upcoming')).toBe('upcoming')
    expect(tabForLegacyParam('results')).toBe('yesterday')
  })
  it('passes through new values unchanged', () => {
    expect(tabForLegacyParam('today')).toBe('today')
    expect(tabForLegacyParam('yesterday')).toBe('yesterday')
  })
  it('returns null for unknown values', () => {
    expect(tabForLegacyParam('foo')).toBe(null)
    expect(tabForLegacyParam(null)).toBe(null)
  })
})

describe('applyFilters', () => {
  const baseMatch = (over: any = {}) => ({
    id: 'm1',
    status: 'scheduled',
    category: 'men',
    round: 'Round 16',
    tournament: { id: 't1', level: 'p2' },
    pair1_player1: { id: 'p1' },
    pair1_player2: { id: 'p2' },
    pair2_player1: { id: 'p3' },
    pair2_player2: { id: 'p4' },
    ...over,
  })

  const noFilters: MatchFilters = {
    circuits: new Set(['premier', 'fip']),
    genders: new Set(['men', 'women']),
    levels: new Set(),
    favouritesOnly: false,
    hideQualifiers: false,
    favourites: { matches: new Set(), players: new Set(), tournaments: new Set() },
  }

  it('returns everything when no filters applied', () => {
    const matches = [baseMatch(), baseMatch({ id: 'm2', category: 'women' })]
    expect(applyFilters(matches, noFilters).length).toBe(2)
  })

  it('ANDs across categories, ORs within a category', () => {
    const matches = [
      baseMatch({ id: 'a', category: 'men',   tournament: { level: 'p1' } }),
      baseMatch({ id: 'b', category: 'women', tournament: { level: 'p1' } }),
      baseMatch({ id: 'c', category: 'men',   tournament: { level: 'fip_gold' } }),
    ]
    const f: MatchFilters = {
      ...noFilters,
      circuits: new Set(['premier']),          // excludes c
      genders: new Set(['men', 'women']),      // keeps a, b
    }
    const out = applyFilters(matches, f).map(m => m.id).sort()
    expect(out).toEqual(['a', 'b'])
  })

  it('levels set filters by tournament.level', () => {
    const matches = [
      baseMatch({ id: 'a', tournament: { level: 'p1' } }),
      baseMatch({ id: 'b', tournament: { level: 'p2' } }),
      baseMatch({ id: 'c', tournament: { level: 'fip_gold' } }),
    ]
    const f: MatchFilters = { ...noFilters, levels: new Set(['p1', 'fip_gold']) }
    const out = applyFilters(matches, f).map(m => m.id).sort()
    expect(out).toEqual(['a', 'c'])
  })

  it('hideQualifiers drops matches whose round looks like a qualifier', () => {
    const matches = [
      baseMatch({ id: 'a', round: 'Round 16' }),
      baseMatch({ id: 'b', round: 'Qualifying' }),
      baseMatch({ id: 'c', round: 'Q1' }),
      baseMatch({ id: 'd', round: 'Q2' }),
      baseMatch({ id: 'e', round: null }),
    ]
    const out = applyFilters(matches, { ...noFilters, hideQualifiers: true }).map(m => m.id).sort()
    expect(out).toEqual(['a', 'e'])
  })

  it('favouritesOnly keeps matches whose tournament or any player is followed', () => {
    const matches = [
      baseMatch({ id: 'a', tournament: { id: 't1', level: 'p2' } }),
      baseMatch({ id: 'b', tournament: { id: 't2', level: 'p2' },
                 pair1_player1: { id: 'x' }, pair1_player2: { id: 'y' },
                 pair2_player1: { id: 'z' }, pair2_player2: { id: 'w' } }),
      baseMatch({ id: 'c', tournament: { id: 't3', level: 'p2' },
                 pair1_player1: { id: 'x' }, pair1_player2: { id: 'y' },
                 pair2_player1: { id: 'z' }, pair2_player2: { id: 'q' } }),
    ]
    const f: MatchFilters = {
      ...noFilters,
      favouritesOnly: true,
      favourites: {
        matches: new Set(),
        players: new Set(['q']),       // triggers c
        tournaments: new Set(['t1']),  // triggers a
      },
    }
    const out = applyFilters(matches, f).map(m => m.id).sort()
    expect(out).toEqual(['a', 'c'])
  })

  it('compound filters — all predicates AND together', () => {
    const matches = [
      baseMatch({ id: 'a', category: 'men',   tournament: { level: 'p1' },     round: 'R16' }),
      baseMatch({ id: 'b', category: 'women', tournament: { level: 'p1' },     round: 'R16' }),
      baseMatch({ id: 'c', category: 'men',   tournament: { level: 'p1' },     round: 'Q1'  }),
    ]
    const f: MatchFilters = {
      ...noFilters,
      genders: new Set(['men']),
      levels: new Set(['p1']),
      hideQualifiers: true,
    }
    const out = applyFilters(matches, f).map(m => m.id).sort()
    expect(out).toEqual(['a'])
  })
})
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/matches-filters.test.ts`
Expected: FAIL — "Cannot find module '../matches-filters'"

- [ ] **Step 1.3: Write the helpers module**

Create `src/lib/matches-filters.ts`:

```ts
// Pure helpers for the Matches page: date-window calculation,
// legacy-tab remapping, and the composite filter predicate.
// All functions are deterministic, test-only inputs in/out.

export type Tab = 'yesterday' | 'today' | 'upcoming'
export type Circuit = 'premier' | 'fip'
export type Gender = 'men' | 'women'

export interface MatchFilters {
  circuits: Set<Circuit>
  genders: Set<Gender>
  levels: Set<string>
  favouritesOnly: boolean
  hideQualifiers: boolean
  favourites: {
    matches: Set<string>
    players: Set<string>
    tournaments: Set<string>
  }
}

export interface DateWindow {
  yesterdayStart: string   // ISO UTC for midnight local yesterday
  todayStart: string
  tomorrowStart: string
}

const PREMIER_LEVELS = new Set(['p1', 'p2', 'major', 'finals'])
const QUALIFIER_RE = /^q\d|qualif/i

// ── Date-window computation ──────────────────────────────────
// Find local-midnight boundaries for yesterday / today / tomorrow
// by formatting the input time with the target tz and backing out
// the offset. Falls back to UTC if Intl rejects the tz.
export function computeDateWindow(now: Date, tz: string): DateWindow {
  const ymd = ymdInTz(now, tz)
  const [y, m, d] = ymd.split('-').map(Number)
  const todayUtc = localMidnightToUtc(y, m, d, tz)
  const tomorrowUtc = new Date(todayUtc.getTime() + 24 * 60 * 60 * 1000)
  const yesterdayUtc = new Date(todayUtc.getTime() - 24 * 60 * 60 * 1000)
  return {
    yesterdayStart: yesterdayUtc.toISOString(),
    todayStart: todayUtc.toISOString(),
    tomorrowStart: tomorrowUtc.toISOString(),
  }
}

function ymdInTz(d: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d)
    const y = parts.find(p => p.type === 'year')!.value
    const m = parts.find(p => p.type === 'month')!.value
    const day = parts.find(p => p.type === 'day')!.value
    return `${y}-${m}-${day}`
  } catch {
    // invalid tz — fall through to UTC
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const day = String(d.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
}

function localMidnightToUtc(y: number, m: number, d: number, tz: string): Date {
  // Naive guess: UTC midnight for the given Y-M-D
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
  // Format the guess back in tz; the delta tells us the offset to subtract
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(guess)
    const map: Record<string, string> = {}
    for (const p of parts) map[p.type] = p.value
    const asLocal = Date.UTC(
      Number(map.year), Number(map.month) - 1, Number(map.day),
      Number(map.hour === '24' ? '0' : map.hour),
      Number(map.minute), Number(map.second),
    )
    const offset = asLocal - guess.getTime()
    return new Date(guess.getTime() - offset)
  } catch {
    return guess
  }
}

// ── Legacy tab remap ─────────────────────────────────────────
export function tabForLegacyParam(value: string | null): Tab | null {
  if (value === 'today' || value === 'yesterday' || value === 'upcoming') return value
  if (value === 'live') return 'today'
  if (value === 'results') return 'yesterday'
  return null
}

// ── Filter predicate ─────────────────────────────────────────
export function applyFilters<M extends {
  id: string
  category?: string | null
  round?: string | null
  tournament?: { id?: string | null; level?: string | null } | null
  pair1_player1?: { id?: string | null } | null
  pair1_player2?: { id?: string | null } | null
  pair2_player1?: { id?: string | null } | null
  pair2_player2?: { id?: string | null } | null
}>(matches: M[], f: MatchFilters): M[] {
  return matches.filter(m => {
    // Circuits
    if (f.circuits.size > 0 && f.circuits.size < 2) {
      const level = m.tournament?.level ?? ''
      const circuit: Circuit | 'other' =
        PREMIER_LEVELS.has(level) ? 'premier' :
        level.startsWith('fip_')  ? 'fip' : 'other'
      if (circuit === 'other') return false
      if (!f.circuits.has(circuit)) return false
    }

    // Genders
    if (f.genders.size > 0 && f.genders.size < 2) {
      const g = m.category as Gender | undefined
      if (!g || !f.genders.has(g)) return false
    }

    // Levels
    if (f.levels.size > 0) {
      const lvl = m.tournament?.level
      if (!lvl || !f.levels.has(lvl)) return false
    }

    // Hide qualifiers
    if (f.hideQualifiers) {
      const round = m.round ?? ''
      if (QUALIFIER_RE.test(round)) return false
    }

    // Favourites only
    if (f.favouritesOnly) {
      const tid = m.tournament?.id ?? ''
      const pids = [
        m.pair1_player1?.id, m.pair1_player2?.id,
        m.pair2_player1?.id, m.pair2_player2?.id,
      ].filter(Boolean) as string[]
      const hit =
        f.favourites.matches.has(m.id) ||
        (tid && f.favourites.tournaments.has(tid)) ||
        pids.some(pid => f.favourites.players.has(pid))
      if (!hit) return false
    }

    return true
  })
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/matches-filters.test.ts`
Expected: PASS — all test cases green.

- [ ] **Step 1.5: Commit**

```bash
git add src/lib/matches-filters.ts src/lib/__tests__/matches-filters.test.ts
git commit -m "$(cat <<'EOF'
feat(matches): add matches-filters helpers with unit tests

Adds pure helpers for the Apple-tabs matches-page redesign:
computeDateWindow (tz-aware), tabForLegacyParam (query-param
back-compat), and applyFilters (compound predicate over circuits,
genders, levels, hide-qualifiers, and favourites-only).
EOF
)"
```

---

## Task 2: i18n keys

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

- [ ] **Step 2.1: Add keys under `matches.*` in en.json**

Edit `src/messages/en.json` and replace the `matches` block with:

```json
"matches": {
  "live": "Live",
  "upcoming": "Upcoming",
  "results": "Results",
  "yesterday": "Yesterday",
  "today": "Today",
  "upcomingTab": "Upcoming",
  "liveNow": "Live Now",
  "noLive": "No live matches right now",
  "noUpcoming": "No upcoming matches",
  "noResults": "No recent results",
  "filterHint": "Try switching the league filter to see {league} or All matches.",
  "loadMore": "Load more ({count} remaining)",
  "viewPreviousSeasons": "View previous seasons",
  "filters": {
    "title": "Filters",
    "circuit": "Circuit",
    "gender": "Gender",
    "level": "Level",
    "premierPadel": "Premier Padel",
    "fipTour": "FIP Tour",
    "men": "Men",
    "women": "Women",
    "major": "Major",
    "p1": "P1",
    "p2": "P2",
    "fipGold": "FIP Gold",
    "fipSilver": "FIP Silver",
    "favouritesOnly": "Favourites only",
    "favouritesHint": "Players or tournaments you've starred",
    "hideQualifiers": "Hide qualifiers",
    "hideQualifiersHint": "Show only main-draw matches",
    "reset": "Reset",
    "apply": "Apply",
    "applyCount": "{count, plural, one {# filter} other {# filters}}",
    "clear": "Clear"
  }
}
```

- [ ] **Step 2.2: Add translations to es.json / pt.json / it.json / fr.json**

Open each file in turn and mirror the same keys. Translations:

**es.json**
```json
"yesterday": "Ayer",
"today": "Hoy",
"upcomingTab": "Próximos",
"liveNow": "En directo",
"filters": {
  "title": "Filtros",
  "circuit": "Circuito",
  "gender": "Categoría",
  "level": "Nivel",
  "premierPadel": "Premier Padel",
  "fipTour": "FIP Tour",
  "men": "Hombres",
  "women": "Mujeres",
  "major": "Major",
  "p1": "P1",
  "p2": "P2",
  "fipGold": "FIP Gold",
  "fipSilver": "FIP Silver",
  "favouritesOnly": "Solo favoritos",
  "favouritesHint": "Jugadores o torneos que has marcado",
  "hideQualifiers": "Ocultar clasificatorios",
  "hideQualifiersHint": "Mostrar solo cuadro principal",
  "reset": "Restablecer",
  "apply": "Aplicar",
  "applyCount": "{count, plural, one {# filtro} other {# filtros}}",
  "clear": "Limpiar"
}
```

**pt.json**
```json
"yesterday": "Ontem",
"today": "Hoje",
"upcomingTab": "Próximos",
"liveNow": "Ao vivo",
"filters": {
  "title": "Filtros",
  "circuit": "Circuito",
  "gender": "Categoria",
  "level": "Nível",
  "premierPadel": "Premier Padel",
  "fipTour": "FIP Tour",
  "men": "Homens",
  "women": "Mulheres",
  "major": "Major",
  "p1": "P1",
  "p2": "P2",
  "fipGold": "FIP Gold",
  "fipSilver": "FIP Silver",
  "favouritesOnly": "Só favoritos",
  "favouritesHint": "Jogadores ou torneios marcados",
  "hideQualifiers": "Ocultar qualifiers",
  "hideQualifiersHint": "Mostrar só o quadro principal",
  "reset": "Repor",
  "apply": "Aplicar",
  "applyCount": "{count, plural, one {# filtro} other {# filtros}}",
  "clear": "Limpar"
}
```

**it.json**
```json
"yesterday": "Ieri",
"today": "Oggi",
"upcomingTab": "Prossimi",
"liveNow": "Dal vivo",
"filters": {
  "title": "Filtri",
  "circuit": "Circuito",
  "gender": "Categoria",
  "level": "Livello",
  "premierPadel": "Premier Padel",
  "fipTour": "FIP Tour",
  "men": "Uomini",
  "women": "Donne",
  "major": "Major",
  "p1": "P1",
  "p2": "P2",
  "fipGold": "FIP Gold",
  "fipSilver": "FIP Silver",
  "favouritesOnly": "Solo preferiti",
  "favouritesHint": "Giocatori o tornei salvati",
  "hideQualifiers": "Nascondi qualifier",
  "hideQualifiersHint": "Mostra solo il tabellone principale",
  "reset": "Reimposta",
  "apply": "Applica",
  "applyCount": "{count, plural, one {# filtro} other {# filtri}}",
  "clear": "Pulisci"
}
```

**fr.json**
```json
"yesterday": "Hier",
"today": "Aujourd'hui",
"upcomingTab": "À venir",
"liveNow": "En direct",
"filters": {
  "title": "Filtres",
  "circuit": "Circuit",
  "gender": "Catégorie",
  "level": "Niveau",
  "premierPadel": "Premier Padel",
  "fipTour": "FIP Tour",
  "men": "Hommes",
  "women": "Femmes",
  "major": "Major",
  "p1": "P1",
  "p2": "P2",
  "fipGold": "FIP Gold",
  "fipSilver": "FIP Silver",
  "favouritesOnly": "Favoris uniquement",
  "favouritesHint": "Joueurs ou tournois épinglés",
  "hideQualifiers": "Masquer les qualifs",
  "hideQualifiersHint": "Afficher uniquement le tableau principal",
  "reset": "Réinitialiser",
  "apply": "Appliquer",
  "applyCount": "{count, plural, one {# filtre} other {# filtres}}",
  "clear": "Effacer"
}
```

- [ ] **Step 2.3: Validate JSON**

Run: `for f in src/messages/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo OK $f; done`
Expected: `OK src/messages/en.json` (and the other four) — no parse errors.

- [ ] **Step 2.4: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "$(cat <<'EOF'
i18n(matches): add tab + filter-sheet keys across 5 locales

New keys: matches.yesterday/today/upcomingTab, matches.liveNow, and
matches.filters.* (circuit, gender, level, toggles, reset/apply/clear).
Existing live/upcoming/results keys kept for back-compat.
EOF
)"
```

---

## Task 3: `MatchesFilterSheet` component

**Files:**
- Create: `src/components/MatchesFilterSheet.tsx`

- [ ] **Step 3.1: Create the component shell**

Create `src/components/MatchesFilterSheet.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { Circuit, Gender } from '@/lib/matches-filters'

const GREEN = '#7ED321'
const GREEN_DIM = 'rgba(126,211,33,0.12)'
const MEN_BLUE = '#4A9EFF'
const MEN_DIM = 'rgba(74,158,255,0.14)'
const WOMEN_PURPLE = '#D966FF'
const WOMEN_DIM = 'rgba(217,102,255,0.14)'
const BG_CARD = '#141414'
const BG_ELEV = '#1E1E1E'
const MUTED = '#6B7280'
const MUTED_2 = '#9CA3AF'
const BORDER = 'rgba(255,255,255,0.06)'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'
const CHUNKY_BTN   = 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)'

export interface FilterSheetValue {
  circuits: Set<Circuit>
  genders: Set<Gender>
  levels: Set<string>
  favouritesOnly: boolean
  hideQualifiers: boolean
}

const LEVEL_KEYS = ['major', 'p1', 'p2', 'fip_gold', 'fip_silver'] as const
type LevelKey = typeof LEVEL_KEYS[number]

export default function MatchesFilterSheet({
  open,
  initial,
  onApply,
  onClose,
}: {
  open: boolean
  initial: FilterSheetValue
  onApply: (next: FilterSheetValue) => void
  onClose: () => void
}) {
  const t = useTranslations('matches.filters')
  // Local draft so the sheet can be cancelled without mutating parent state.
  const [draft, setDraft] = useState<FilterSheetValue>(initial)
  // Resync draft whenever the sheet re-opens with new initial state
  useEffect(() => { if (open) setDraft({
    circuits: new Set(initial.circuits),
    genders: new Set(initial.genders),
    levels: new Set(initial.levels),
    favouritesOnly: initial.favouritesOnly,
    hideQualifiers: initial.hideQualifiers,
  }) }, [open, initial])

  if (!open) return null

  const toggleInSet = <T,>(set: Set<T>, v: T): Set<T> => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v); else next.add(v)
    return next
  }

  const countApplied = countAppliedFilters(draft)

  const reset: FilterSheetValue = {
    circuits: new Set(['premier', 'fip']),
    genders: new Set(['men', 'women']),
    levels: new Set(),
    favouritesOnly: false,
    hideQualifiers: false,
  }

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(3px)',
        zIndex: 400,
        animation: 'pn-sheet-fade 0.2s ease',
      }} />
      <div role="dialog" aria-modal="true" style={{
        position: 'fixed',
        left: '50%', bottom: 0,
        transform: 'translateX(-50%)',
        width: '100%', maxWidth: 500,
        background: BG_CARD,
        borderTop: '1px solid rgba(255,255,255,0.12)',
        padding: '18px 18px 24px',
        zIndex: 401,
        boxShadow: '0 -12px 40px rgba(0,0,0,0.5)',
        animation: 'pn-sheet-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}>
        <div style={{ width: 44, height: 4, background: 'rgba(255,255,255,0.2)', margin: '0 auto 16px' }} />

        {/* Circuit */}
        <SheetSection title={t('circuit')}>
          <PillRow>
            <Pill on={draft.circuits.has('premier')} onClick={() => setDraft({ ...draft, circuits: toggleInSet(draft.circuits, 'premier') })}>{t('premierPadel')}</Pill>
            <Pill on={draft.circuits.has('fip')} onClick={() => setDraft({ ...draft, circuits: toggleInSet(draft.circuits, 'fip') })}>{t('fipTour')}</Pill>
          </PillRow>
        </SheetSection>

        {/* Gender */}
        <SheetSection title={t('gender')}>
          <PillRow>
            <Pill tint={{ on: MEN_DIM, color: MEN_BLUE }} on={draft.genders.has('men')} onClick={() => setDraft({ ...draft, genders: toggleInSet(draft.genders, 'men') })}>{t('men')}</Pill>
            <Pill tint={{ on: WOMEN_DIM, color: WOMEN_PURPLE }} on={draft.genders.has('women')} onClick={() => setDraft({ ...draft, genders: toggleInSet(draft.genders, 'women') })}>{t('women')}</Pill>
          </PillRow>
        </SheetSection>

        {/* Level */}
        <SheetSection title={t('level')}>
          <PillRow>
            {LEVEL_KEYS.map(k => {
              const labelKey = k === 'fip_gold' ? 'fipGold' : k === 'fip_silver' ? 'fipSilver' : k
              return (
                <Pill key={k} on={draft.levels.has(k)} onClick={() => setDraft({ ...draft, levels: toggleInSet(draft.levels, k) })}>
                  {t(labelKey as any)}
                </Pill>
              )
            })}
          </PillRow>
        </SheetSection>

        {/* Toggles */}
        <SheetSection>
          <ToggleRow
            name={t('favouritesOnly')}
            sub={t('favouritesHint')}
            on={draft.favouritesOnly}
            onChange={v => setDraft({ ...draft, favouritesOnly: v })}
          />
          <ToggleRow
            name={t('hideQualifiers')}
            sub={t('hideQualifiersHint')}
            on={draft.hideQualifiers}
            onChange={v => setDraft({ ...draft, hideQualifiers: v })}
          />
        </SheetSection>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button onClick={() => onApply(reset)} style={{
            flex: 1, padding: 14, cursor: 'pointer', border: `1px solid ${BORDER}`,
            background: BG_ELEV, color: MUTED_2,
            fontSize: 13, fontWeight: 900, letterSpacing: 0.5, textTransform: 'uppercase',
            clipPath: CHUNKY_BTN,
          }}>
            {t('reset')}
          </button>
          <button onClick={() => onApply(draft)} style={{
            flex: 1, padding: 14, cursor: 'pointer', border: 'none',
            background: GREEN, color: '#0A0A0A',
            fontSize: 13, fontWeight: 900, letterSpacing: 0.5, textTransform: 'uppercase',
            clipPath: CHUNKY_BTN,
          }}>
            {t('apply')}
            {countApplied > 0 && (
              <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.7 }}>
                · {t('applyCount', { count: countApplied })}
              </span>
            )}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes pn-sheet-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes pn-sheet-in  { from { transform: translate(-50%, 100%); opacity: 0 } to { transform: translate(-50%, 0); opacity: 1 } }
      `}</style>
    </>
  )
}

// ── Sub-components ──────────────────────────────────────

function SheetSection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      {title && (
        <h4 style={{ margin: '0 0 10px', fontSize: 10, fontWeight: 900, letterSpacing: 1, textTransform: 'uppercase', color: MUTED }}>
          {title}
        </h4>
      )}
      {children}
    </div>
  )
}

function PillRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>
}

function Pill({ on, onClick, children, tint }: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
  tint?: { on: string; color: string }
}) {
  const activeBg = tint?.on ?? GREEN_DIM
  const activeColor = tint?.color ?? GREEN
  return (
    <button onClick={onClick} style={{
      padding: '8px 14px',
      fontSize: 12, fontWeight: 800,
      background: on ? activeBg : BG_ELEV,
      color: on ? activeColor : MUTED_2,
      border: on ? '1px solid transparent' : `1px solid ${BORDER}`,
      clipPath: CHUNKY_BADGE,
      cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      {on && <span aria-hidden style={{ fontSize: 11, fontWeight: 900 }}>✓</span>}
      {children}
    </button>
  )
}

function ToggleRow({ name, sub, on, onChange }: {
  name: string
  sub: string
  on: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 0', borderTop: `1px solid ${BORDER}`,
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{name}</div>
        <div style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>{sub}</div>
      </div>
      <button role="switch" aria-checked={on} onClick={() => onChange(!on)} style={{
        width: 44, height: 26, position: 'relative',
        background: on ? GREEN : BG_ELEV,
        border: on ? '1px solid transparent' : `1px solid ${BORDER}`,
        cursor: 'pointer', padding: 0,
        transition: 'background 0.2s',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: on ? 20 : 2,
          width: 20, height: 20,
          background: on ? '#0A0A0A' : '#fff',
          transition: 'left 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }} />
      </button>
    </div>
  )
}

// Exported so the page can badge the filter trigger.
// Only `size === 1` counts as a filter; size 0 ("nothing selected") and
// size 2 ("everything selected") are both treated as "no constraint" by
// applyFilters, so the badge stays quiet in either case.
export function countAppliedFilters(v: FilterSheetValue): number {
  return (
    (v.circuits.size === 1 ? 1 : 0) +
    (v.genders.size === 1 ? 1 : 0) +
    v.levels.size +
    (v.favouritesOnly ? 1 : 0) +
    (v.hideQualifiers ? 1 : 0)
  )
}
```

- [ ] **Step 3.2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors in the new file.

- [ ] **Step 3.3: Commit**

```bash
git add src/components/MatchesFilterSheet.tsx
git commit -m "$(cat <<'EOF'
feat(matches): add MatchesFilterSheet bottom-sheet component

Presentational bottom sheet with Circuit / Gender / Level multi-select
pills and Favourites-only / Hide-qualifiers toggles. Holds a local draft
until Apply; Reset uses the all-on defaults. Exposes countAppliedFilters
helper so the page can badge the trigger icon.
EOF
)"
```

---

## Task 4: `MatchesTabs` component

**Files:**
- Create: `src/components/MatchesTabs.tsx`

- [ ] **Step 4.1: Create the component**

Create `src/components/MatchesTabs.tsx`:

```tsx
'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { DATE_SHORT } from '@/lib/format-patterns'
import type { Tab } from '@/lib/matches-filters'

const GREEN = '#7ED321'
const GREEN_DIM = 'rgba(126,211,33,0.12)'
const BG_ELEV = '#1E1E1E'
const MUTED = '#6B7280'
const MUTED_2 = '#9CA3AF'
const TEXT = '#FFFFFF'
const BORDER = 'rgba(255,255,255,0.06)'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

export default function MatchesTabs({
  tab,
  onTabChange,
  dates,
  filterCount,
  onFilterClick,
}: {
  tab: Tab
  onTabChange: (tab: Tab) => void
  dates: {
    yesterday: Date
    today: Date
    upcoming: Date | null   // null when there are no scheduled matches beyond today
  }
  filterCount: number
  onFilterClick: () => void
}) {
  const t = useTranslations('matches')
  const format = useFormatter()

  const upcomingLabel = dates.upcoming
    ? `${format.dateTime(dates.upcoming, DATE_SHORT)}+`
    : '—'

  const tabs: { key: Tab; label: string; date: string }[] = [
    { key: 'yesterday', label: t('yesterday'),   date: format.dateTime(dates.yesterday, DATE_SHORT) },
    { key: 'today',     label: t('today'),       date: format.dateTime(dates.today, DATE_SHORT) },
    { key: 'upcoming',  label: t('upcomingTab'), date: upcomingLabel },
  ]

  return (
    <div style={{
      display: 'flex', alignItems: 'stretch',
      padding: '14px 14px 0',
      borderBottom: `1px solid ${BORDER}`,
      gap: 4,
    }}>
      <div style={{ display: 'flex', flex: '1 1 auto', justifyContent: 'space-around' }}>
        {tabs.map(tb => {
          const active = tab === tb.key
          return (
            <button
              key={tb.key}
              onClick={() => onTabChange(tb.key)}
              aria-pressed={active}
              style={{
                flex: 1,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                padding: '6px 0 12px',
                background: 'transparent', border: 'none', cursor: 'pointer',
                position: 'relative',
              }}
            >
              <span style={{
                fontSize: 15,
                fontWeight: active ? 800 : 700,
                color: active ? TEXT : MUTED,
                letterSpacing: -0.1,
              }}>{tb.label}</span>
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: active ? GREEN : MUTED,
                opacity: active ? 1 : 0.65,
                letterSpacing: 0.3,
                fontVariantNumeric: 'tabular-nums',
              }}>{tb.date}</span>
              {active && (
                <span aria-hidden style={{
                  position: 'absolute',
                  left: '18%', right: '18%', bottom: -1, height: 2.5,
                  background: GREEN,
                  clipPath: 'polygon(3% 0%, 97% 0%, 100% 100%, 0% 100%)',
                }} />
              )}
            </button>
          )
        })}
      </div>

      <button
        onClick={onFilterClick}
        aria-label="Filters"
        style={{
          position: 'relative',
          width: 38, height: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: filterCount > 0 ? GREEN_DIM : BG_ELEV,
          border: `1px solid ${filterCount > 0 ? 'transparent' : BORDER}`,
          color: filterCount > 0 ? GREEN : MUTED_2,
          cursor: 'pointer',
          clipPath: CHUNKY_BADGE,
          margin: '4px 0 8px',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="6" x2="20" y2="6"/>
          <line x1="4" y1="12" x2="14" y2="12"/>
          <line x1="4" y1="18" x2="10" y2="18"/>
          <circle cx="17" cy="12" r="2.2" fill="currentColor" stroke="none"/>
          <circle cx="13" cy="18" r="2.2" fill="currentColor" stroke="none"/>
        </svg>
        {filterCount > 0 && (
          <span style={{
            position: 'absolute', top: 3, right: 3,
            minWidth: 14, height: 14, padding: '0 3px',
            background: GREEN, color: '#000',
            fontSize: 9, fontWeight: 900,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            clipPath: CHUNKY_BADGE,
            lineHeight: 1,
          }}>{filterCount}</span>
        )}
      </button>
    </div>
  )
}
```

- [ ] **Step 4.2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 4.3: Commit**

```bash
git add src/components/MatchesTabs.tsx
git commit -m "$(cat <<'EOF'
feat(matches): add MatchesTabs component

Presentational tabs row (Yesterday / Today / Upcoming) with stacked
label + date. Active tab underlined in brand green; filter icon at the
end carries a count badge when filters are applied. Dates are localised
via next-intl using the existing DATE_SHORT token.
EOF
)"
```

---

## Task 5: Page integration — state refactor + mount new components

**Files:**
- Modify: `src/app/[locale]/(app)/matches/page.tsx`

- [ ] **Step 5.1: Add the new imports near the top of the file**

In `src/app/[locale]/(app)/matches/page.tsx`, locate the existing import block (lines ~6-21 today) and add/modify to include:

```tsx
import MatchesTabs from '@/components/MatchesTabs'
import MatchesFilterSheet, { countAppliedFilters, type FilterSheetValue } from '@/components/MatchesFilterSheet'
import { applyFilters, computeDateWindow, tabForLegacyParam, type Tab as MatchesTab, type Circuit, type Gender } from '@/lib/matches-filters'
import { useFollowing } from '@/hooks/useFollowing'
```

- [ ] **Step 5.2: Replace the tab/filter state block**

Inside `V3ScoresPage()`, find the block that declares `tab`, `TAB_KEYS`, `swipeGoTo`, `genderFilter`, `leagueFilter` (around line 645-656 today) and replace with:

```tsx
const [tab, setTab] = useState<MatchesTab>('today')
const TAB_KEYS = useMemo(() => ['yesterday', 'today', 'upcoming'] as const, [])

const { goTo: swipeGoTo, trackStyle, handlers: swipeHandlers, isDragging } = useSwipeTabs({
  count: 3,
  initial: TAB_KEYS.indexOf(tab),
  onTabChange: (idx) => setTab(TAB_KEYS[idx]),
})

const [circuits, setCircuits] = useState<Set<Circuit>>(new Set(['premier', 'fip']))
const [genders, setGenders]   = useState<Set<Gender>>(new Set(['men', 'women']))
const [levels, setLevels]     = useState<Set<string>>(new Set())
const [favouritesOnly, setFavouritesOnly] = useState(false)
const [hideQualifiers, setHideQualifiers] = useState(false)
const [filterSheetOpen, setFilterSheetOpen] = useState(false)
const [searchOpen, setSearchOpen] = useState(false)

const { getFollowed } = useFollowing()
```

- [ ] **Step 5.3: Map legacy query-param tab values**

Below the state block, add:

```tsx
// Legacy /matches?tab=live|upcoming|results → new tabs
useEffect(() => {
  const raw = searchParams.get('tab')
  const mapped = tabForLegacyParam(raw)
  if (mapped && mapped !== tab) {
    setTab(mapped)
    swipeGoTo(TAB_KEYS.indexOf(mapped))
  }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [searchParams])
```

- [ ] **Step 5.4: Delete the old auto-tab-pick logic**

In `fetchData`, remove the block that currently auto-picks the initial tab based on data presence (around lines 716-724). The auto-pick is no longer needed — we default to `today`. Keep the rest of `fetchData` intact.

- [ ] **Step 5.5: Delete the obsolete single-value filter helpers**

Inside the render body, delete the `gf`, `lf`, `PREMIER_LEVELS`, `isFipLevel`, `matchLeague`, `liveFiltered`, `upcomingFiltered`, `resultsFiltered`, `liveGrouped`, `upcomingGrouped`, `resultsGrouped`, and `liveCount` lines (around lines 802-833). They're replaced in the next task.

Also delete the old `tabs: { key: typeof tab; ... }` array and the old "League filter chips" JSX block further down. We'll render the new tabs component instead.

- [ ] **Step 5.6: Mount new components above the swipe viewport**

Where the old tabs + league-filter-chips used to live, put:

```tsx
<MatchesTabs
  tab={tab}
  onTabChange={(next) => { setTab(next); swipeGoTo(TAB_KEYS.indexOf(next)) }}
  dates={/* computed in Task 6 */}
  filterCount={countAppliedFilters({ circuits, genders, levels, favouritesOnly, hideQualifiers })}
  onFilterClick={() => setFilterSheetOpen(true)}
/>

<MatchesFilterSheet
  open={filterSheetOpen}
  initial={{ circuits, genders, levels, favouritesOnly, hideQualifiers }}
  onApply={(next) => {
    setCircuits(next.circuits)
    setGenders(next.genders)
    setLevels(next.levels)
    setFavouritesOnly(next.favouritesOnly)
    setHideQualifiers(next.hideQualifiers)
    setFilterSheetOpen(false)
  }}
  onClose={() => setFilterSheetOpen(false)}
/>
```

(The `dates` prop gets its values in Task 6. For now, pass a placeholder to keep the file compiling:)

```tsx
dates={{ yesterday: new Date(), today: new Date(), upcoming: null }}
```

- [ ] **Step 5.7: Type-check + lint**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: no new errors. The file compiles but the tab slicing is still broken — we fix that in Task 6.

- [ ] **Step 5.8: Commit**

```bash
git add src/app/[locale]/(app)/matches/page.tsx
git commit -m "$(cat <<'EOF'
refactor(matches): swap tab/filter state, mount new tabs + sheet

Replaces single-value tab/gender/league state with the new Tab type
and Set-backed circuits/genders/levels plus favouritesOnly +
hideQualifiers + filterSheetOpen booleans. Mounts MatchesTabs and
MatchesFilterSheet. Legacy /matches?tab=live|upcoming|results values
are remapped to today/upcoming/yesterday.

Data slicing is broken at this commit; Task 6 re-wires it.
EOF
)"
```

---

## Task 6: Page integration — data slicing + date window

**Files:**
- Modify: `src/app/[locale]/(app)/matches/page.tsx`

- [ ] **Step 6.1: Compute the date window and tab-specific slices**

Inside `V3ScoresPage()`, below the realtime subscription `useEffect`, add:

```tsx
// Read the user's timezone from the geo-timezone cookie (set by proxy).
const timezone = useMemo(() => {
  if (typeof document === 'undefined') return 'UTC'
  const m = document.cookie.match(/(?:^|; )geo-timezone=([^;]+)/)
  try {
    return m ? decodeURIComponent(m[1]) : Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}, [])

const dateWindow = useMemo(() => computeDateWindow(new Date(), timezone), [timezone])
const yesterdayDate = useMemo(() => new Date(dateWindow.yesterdayStart), [dateWindow])
const todayDate     = useMemo(() => new Date(dateWindow.todayStart), [dateWindow])
```

- [ ] **Step 6.2: Build the filter object + compound slices**

Add below:

```tsx
const favourites = useMemo(() => ({
  matches: new Set(getFollowed('match')),
  players: new Set(getFollowed('player')),
  tournaments: new Set(getFollowed('tournament')),
}), [getFollowed])

const filters = useMemo(() => ({
  circuits, genders, levels, favouritesOnly, hideQualifiers, favourites,
}), [circuits, genders, levels, favouritesOnly, hideQualifiers, favourites])

// Yesterday = finished in [yesterdayStart, todayStart)
const yesterdayMatches = useMemo(() => {
  const start = dateWindow.yesterdayStart, end = dateWindow.todayStart
  return applyFilters(
    recentMatches.filter(m => {
      const fin = (m as any).finished_at
      return fin && fin >= start && fin < end
    }),
    filters,
  )
}, [recentMatches, dateWindow, filters])

// Today = all live UNION scheduled with scheduled_at in [todayStart, tomorrowStart)
const todayMatches = useMemo(() => {
  const start = dateWindow.todayStart, end = dateWindow.tomorrowStart
  const todaysScheduled = scheduledMatches.filter(m => {
    const s = m.scheduled_at
    return s && s >= start && s < end
  })
  const combined = [...liveMatches, ...todaysScheduled.filter(hasPlayers)]
  // De-duplicate in case a match appears in both arrays (unlikely but safe)
  const seen = new Set<string>()
  const unique = combined.filter(m => {
    if (seen.has(m.id)) return false
    seen.add(m.id)
    return true
  })
  return applyFilters(unique, filters)
}, [liveMatches, scheduledMatches, dateWindow, filters])

// Upcoming = scheduled with scheduled_at >= tomorrowStart
const upcomingMatches = useMemo(() => {
  const start = dateWindow.tomorrowStart
  return applyFilters(
    scheduledMatches.filter(m => m.scheduled_at && m.scheduled_at >= start && hasPlayers(m)),
    filters,
  )
}, [scheduledMatches, dateWindow, filters])

// Upcoming date = earliest scheduled_at beyond today (or null if none)
const upcomingDate = useMemo(() => {
  if (upcomingMatches.length === 0) return null
  const earliest = upcomingMatches.reduce<string | null>((acc, m) => {
    const s = m.scheduled_at
    if (!s) return acc
    return !acc || s < acc ? s : acc
  }, null)
  return earliest ? new Date(earliest) : null
}, [upcomingMatches])

// Group each slice by tournament (reuses existing sort: live-first, then date desc)
const yesterdayGrouped = useMemo(() => groupByTournament(yesterdayMatches), [yesterdayMatches])
const todayGrouped     = useMemo(() => groupByTournament(todayMatches), [todayMatches])
const upcomingGrouped  = useMemo(() => groupByTournament(upcomingMatches), [upcomingMatches])

// Live count for the "Live Now · N" strip (Today only)
const liveNowCount = useMemo(() => todayMatches.filter(m => m.status === 'live').length, [todayMatches])
```

- [ ] **Step 6.3: Pass the real dates into `MatchesTabs`**

Replace the placeholder `dates` prop from Task 5 with:

```tsx
dates={{ yesterday: yesterdayDate, today: todayDate, upcoming: upcomingDate }}
```

- [ ] **Step 6.4: Tighten the `recentMatches` fetch window to 48h**

Inside `fetchData`, locate the `matches:recent` query (around lines 692-697) and replace:

```ts
wrap(supabase.from('matches').select(matchSelectLean)
  .in('status', ['finished', 'retired', 'walkover'])
  .not('finished_at', 'is', null)
  .gte('finished_at', `${new Date().getFullYear()}-01-01`)
  .order('finished_at', { ascending: false }) as any, 'matches:recent'),
```

with:

```ts
wrap(supabase.from('matches').select(matchSelectLean)
  .in('status', ['finished', 'retired', 'walkover'])
  .not('finished_at', 'is', null)
  .gte('finished_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
  .order('finished_at', { ascending: false }) as any, 'matches:recent'),
```

- [ ] **Step 6.5: Wire the three slices into the swipe viewport**

Find the existing JSX for the three tab panels (around the swipe track, where `liveGrouped`, `upcomingGrouped`, `resultsGrouped` used to render). Replace the three panel bodies with the new slices. The general shape is:

```tsx
<div {...swipeHandlers} style={{ overflow: 'hidden' }}>
  <div style={{ ...trackStyle, display: 'flex', width: '300%' }}>
    <TabPanel>
      {yesterdayGrouped.length === 0
        ? <EmptyState tab="results" leagueFilter={circuits.size === 2 ? 'all' : [...circuits][0] ?? 'all'} />
        : yesterdayGrouped.map(g => <TournamentGroup key={g.tournament?.id ?? 'u'} tournament={g.tournament} matches={g.matches} defaultOpen tab="results" />)}
    </TabPanel>

    <TabPanel>
      {liveNowCount > 0 && <LiveNowStrip count={liveNowCount} />}
      {todayGrouped.length === 0
        ? <EmptyState tab="live" leagueFilter="all" />
        : todayGrouped.map(g => <TournamentGroup key={g.tournament?.id ?? 'u'} tournament={g.tournament} matches={g.matches} defaultOpen tab="live" />)}
    </TabPanel>

    <TabPanel>
      {upcomingGrouped.length === 0
        ? <EmptyState tab="upcoming" leagueFilter="all" />
        : upcomingGrouped.map(g => <TournamentGroup key={g.tournament?.id ?? 'u'} tournament={g.tournament} matches={g.matches} defaultOpen tab="upcoming" />)}
    </TabPanel>
  </div>
</div>
```

Define `<TabPanel>` inline above `V3ScoresPage` (or at module top):

```tsx
function TabPanel({ children }: { children: React.ReactNode }) {
  return <div style={{ width: '33.3333%', flexShrink: 0, paddingBottom: 24 }}>{children}</div>
}
```

And the tiny inline `<LiveNowStrip>`:

```tsx
function LiveNowStrip({ count }: { count: number }) {
  const t = useTranslations('matches')
  return (
    <div style={{
      padding: '12px 14px',
      background: 'linear-gradient(180deg, rgba(255,70,85,0.06) 0%, transparent 100%)',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        fontSize: 9, fontWeight: 900, letterSpacing: 1.2,
        textTransform: 'uppercase', color: '#FF4655',
      }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: '#FF4655',
          animation: 'v3-scores-pulse 2s infinite',
        }} />
        {t('liveNow')} · {count}
      </span>
    </div>
  )
}
```

- [ ] **Step 6.6: Remove the now-unused auto-refresh "live tab" hook**

Delete the effect that was gated on `tab === 'live'` (around lines 757-761). Replace it with one keyed to the new `today` tab that still refreshes every 30 s when the user is looking at it:

```tsx
useEffect(() => {
  if (tab !== 'today') return
  const interval = setInterval(() => fetchData(true), 30000)
  return () => clearInterval(interval)
}, [tab, fetchData])
```

- [ ] **Step 6.7: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 6.8: Commit**

```bash
git add src/app/[locale]/(app)/matches/page.tsx
git commit -m "$(cat <<'EOF'
refactor(matches): slice by Yesterday/Today/Upcoming + Live Now strip

Pulls in the user's tz from the geo-timezone cookie, computes the three
date-window boundaries, and splits fetched matches into three
applyFilters-processed slices. Adds inline LiveNowStrip on the Today
panel when any match is live. Tightens the recentMatches query to the
last 48h now that only yesterday's results are needed.
EOF
)"
```

---

## Task 7: Tournament header rewrite (light text, no bar, no chevron)

**Files:**
- Modify: `src/app/[locale]/(app)/matches/page.tsx`

- [ ] **Step 7.1: Replace the `TournamentGroup` component body**

Find `function TournamentGroup({ tournament, matches, defaultOpen, tab })` (around lines 435-564) and replace the entire body with:

```tsx
function TournamentGroup({ tournament, matches, tab }: {
  tournament: any
  matches: Match[]
  defaultOpen?: boolean   // kept for API compat; ignored
  tab: 'yesterday' | 'today' | 'upcoming'
}) {
  const format = useFormatter()
  const badge = tournament?.level ? levelLabel(tournament.level) : null

  const dateRange = tournament?.starts_at
    ? format.dateTime(new Date(tournament.starts_at), DATE_SHORT)
      + (tournament.ends_at ? ` \u2013 ${format.dateTime(new Date(tournament.ends_at), DATE_SHORT)}` : '')
    : ''

  const stageLabel = mostAdvancedRound(matches)
  const anyLive = matches.some(m => m.status === 'live')
  const matchCount = matches.length

  if (!tournament) return null

  return (
    <div>
      {/* Light text header — no dark block, no 2px accent bar, no chevron */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '16px 14px 8px',
        background: BG_BASE,
      }}>
        {tournament.country && <FlagImage country={tournament.country} size={16} />}
        <Link
          href={`/tournaments/${tournament.id}`}
          style={{
            flex: 1, minWidth: 0, textDecoration: 'none', color: 'inherit',
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          }}
        >
          <span style={{
            fontSize: 11, fontWeight: 800, color: '#fff',
            letterSpacing: 0.5, textTransform: 'uppercase',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {titleCase(tournament.name)}
          </span>
          {stageLabel && (
            <>
              <span style={{ margin: '0 4px', color: MUTED, fontSize: 10 }}>·</span>
              <span style={{
                fontSize: 10, fontWeight: 700, color: MUTED,
                letterSpacing: 0.3, textTransform: 'uppercase',
              }}>
                {stageLabel}
              </span>
            </>
          )}
          {anyLive && (
            <span aria-label="live" style={{
              width: 5, height: 5, borderRadius: '50%',
              background: LIVE_RED,
              marginLeft: 4,
              animation: 'v3-scores-pulse 2s infinite',
            }} />
          )}
        </Link>
        <span style={{
          fontSize: 9, fontWeight: 700, color: '#9CA3AF',
          padding: '2px 7px',
          background: 'rgba(255,255,255,0.04)',
          clipPath: CHUNKY.badge,
        }}>
          {matchCount}
        </span>
      </div>

      {/* Match rows — always visible, no collapse */}
      <div style={{ background: BG_CARD }}>
        {matches.map(m => (
          tab === 'yesterday'
            ? <ResultCard key={m.id} match={m} />
            : <V3MatchRow key={m.id} match={m} />
        ))}
      </div>
    </div>
  )
}
```

The signature change: `defaultOpen` is optional and ignored (kept so existing call sites compile until removed).

- [ ] **Step 7.2: Remove `defaultOpen` from call sites**

In the JSX panels from Task 6, drop the `defaultOpen` prop from every `<TournamentGroup ... />` invocation:

```tsx
<TournamentGroup key={g.tournament?.id ?? 'u'} tournament={g.tournament} matches={g.matches} tab="today" />
```

And drop the `defaultOpen?: boolean` line from the signature once all call sites are clean.

- [ ] **Step 7.3: Remove the now-unused `tab === 'results'` "See all" link**

The old body had a "See all N matches →" link that only rendered in results. The new body doesn't — `<ResultCard>` handles rendering just the same. Verify no lint error about unused `matchCount` there.

- [ ] **Step 7.4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors. If `tab` union is now `yesterday|today|upcoming`, the `tournamentStatus` call that used `tab === 'live' | 'upcoming' | 'results'` may need updating — it only matters if it's still referenced. If unused after the rewrite, delete the `const status = tournamentStatus(...)` line.

- [ ] **Step 7.5: Commit**

```bash
git add src/app/[locale]/(app)/matches/page.tsx
git commit -m "$(cat <<'EOF'
refactor(matches): light-text tournament header, drop accent bar

Rewrites TournamentGroup to render a flat light-text header (flag +
tournament · round + inline live pulse dot + count badge) on the page
background instead of the former dark BG_ELEV block with a 2px coloured
top bar. Removes the chevron + collapse/expand behavior; match rows
are always visible. ResultCard still drives yesterday rendering;
V3MatchRow drives today/upcoming.
EOF
)"
```

---

## Task 8: Active-filter chip strip

**Files:**
- Modify: `src/app/[locale]/(app)/matches/page.tsx`

- [ ] **Step 8.1: Add inline `<AppliedFiltersStrip>` component at the top of the file**

Above `V3ScoresPage`, add:

```tsx
function AppliedFiltersStrip({
  circuits, genders, levels, favouritesOnly, hideQualifiers,
  onRemove, onClear,
}: {
  circuits: Set<Circuit>
  genders: Set<Gender>
  levels: Set<string>
  favouritesOnly: boolean
  hideQualifiers: boolean
  onRemove: (kind: 'circuit' | 'gender' | 'level' | 'favouritesOnly' | 'hideQualifiers', value?: string) => void
  onClear: () => void
}) {
  const t = useTranslations('matches.filters')
  const chips: { key: string; label: string; tint?: string; color?: string; onX: () => void }[] = []

  if (circuits.size === 1) {
    const v = [...circuits][0]
    chips.push({ key: `c-${v}`, label: v === 'premier' ? t('premierPadel') : t('fipTour'), onX: () => onRemove('circuit', v) })
  }
  if (genders.size === 1) {
    const v = [...genders][0]
    chips.push({
      key: `g-${v}`, label: v === 'men' ? t('men') : t('women'),
      tint: v === 'men' ? 'rgba(74,158,255,0.14)' : 'rgba(217,102,255,0.14)',
      color: v === 'men' ? MEN_BLUE : WOMEN_PURPLE,
      onX: () => onRemove('gender', v),
    })
  }
  for (const lvl of levels) {
    const label = lvl === 'fip_gold' ? t('fipGold') : lvl === 'fip_silver' ? t('fipSilver') : t(lvl as any)
    chips.push({ key: `l-${lvl}`, label, onX: () => onRemove('level', lvl) })
  }
  if (favouritesOnly) chips.push({ key: 'fav', label: t('favouritesOnly'), onX: () => onRemove('favouritesOnly') })
  if (hideQualifiers) chips.push({ key: 'hq', label: t('hideQualifiers'), onX: () => onRemove('hideQualifiers') })

  if (chips.length === 0) return null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '10px 16px',
      borderBottom: `1px solid ${BORDER}`,
      overflowX: 'auto',
    }}>
      {chips.map(c => (
        <span key={c.key} style={{
          flex: '0 0 auto',
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '4px 8px 4px 10px',
          background: c.tint ?? GREEN_DIM,
          color: c.color ?? GREEN,
          fontSize: 10, fontWeight: 700,
          clipPath: CHUNKY.badge,
          whiteSpace: 'nowrap',
        }}>
          {c.label}
          <button onClick={c.onX} aria-label="Remove filter" style={{
            background: 'none', border: 'none', padding: 0, marginLeft: 2,
            color: 'inherit', cursor: 'pointer', fontSize: 12, lineHeight: 1, opacity: 0.7,
          }}>×</button>
        </span>
      ))}
      <button onClick={onClear} style={{
        marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 10, fontWeight: 700, color: '#9CA3AF',
        textTransform: 'uppercase', letterSpacing: 0.4,
      }}>
        {t('clear')}
      </button>
    </div>
  )
}
```

Use the existing constants (`MEN_BLUE`, `WOMEN_PURPLE`, `GREEN`, `GREEN_DIM`, `BORDER`, `CHUNKY`) already defined at the top of the file.

- [ ] **Step 8.2: Render the strip below `<MatchesTabs>`**

After the `<MatchesTabs ... />` element, add:

```tsx
<AppliedFiltersStrip
  circuits={circuits}
  genders={genders}
  levels={levels}
  favouritesOnly={favouritesOnly}
  hideQualifiers={hideQualifiers}
  onRemove={(kind, value) => {
    if (kind === 'circuit' && value) setCircuits(new Set(['premier', 'fip']))
    else if (kind === 'gender' && value) setGenders(new Set(['men', 'women']))
    else if (kind === 'level' && value) setLevels(prev => { const n = new Set(prev); n.delete(value); return n })
    else if (kind === 'favouritesOnly') setFavouritesOnly(false)
    else if (kind === 'hideQualifiers') setHideQualifiers(false)
  }}
  onClear={() => {
    setCircuits(new Set(['premier', 'fip']))
    setGenders(new Set(['men', 'women']))
    setLevels(new Set())
    setFavouritesOnly(false)
    setHideQualifiers(false)
  }}
/>
```

- [ ] **Step 8.3: Type-check + lint**

Run: `npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: no new errors.

- [ ] **Step 8.4: Commit**

```bash
git add src/app/[locale]/(app)/matches/page.tsx
git commit -m "$(cat <<'EOF'
feat(matches): applied-filter chip strip under tabs

Inline strip renders one removable chunky-polygon chip per active filter
(gender/circuit tinted to match the gender/brand palette) plus a Clear
button aligned right. Hidden when no filters are applied.
EOF
)"
```

---

## Task 9: Manual verification

**Files:** none (verification only)

- [ ] **Step 9.1: Start the dev server via preview**

Use the `mcp__Claude_Preview__preview_start` tool with the `Next.js (frontend)` launch config. Navigate to `/matches`.

- [ ] **Step 9.2: Verify the Today default**

- Open the page cold (no query params) → lands on Today.
- If the DB has live matches: `Live Now · N` strip renders above the list.
- If the DB has no live matches: strip is hidden; scheduled-today list shows.

- [ ] **Step 9.3: Verify the other two tabs**

- Tap Yesterday → finished-matches list for yesterday only (not the full year).
- Tap Upcoming → scheduled matches from tomorrow onward, with the tab's date showing `MMM dd+`.
- Swipe left/right also moves between tabs.

- [ ] **Step 9.4: Verify the filter sheet**

- Tap the filter icon → sheet slides up.
- Toggle Premier Padel off → pill clears; tap Apply → chip strip shows `FIP Tour ×`; icon shows count badge `1`.
- Re-open → FIP Tour reflected as active.
- Toggle Women off so only Men remains → Apply → strip shows `Men ×` tinted blue. (Turning BOTH off also shows all matches — no chip, no badge — because "nothing selected" is treated as "no filter.")
- Add Level P1 → Apply → strip gains `P1`.
- Flip Favourites only (requires user to have starred ≥1 player/tournament) → Apply → strip gains `Favourites only`.
- Tap `Reset` inside the sheet → everything clears.
- Tap × on a chip → that filter removes, strip rerenders.
- Tap `Clear` on the strip → all filters clear, strip hides.

- [ ] **Step 9.5: Verify tournament header**

- No dark block behind the header.
- No 2px accent bar at the top.
- No chevron; no collapse interaction.
- Live pulse dot only on tournaments where any match is live.

- [ ] **Step 9.6: Verify back-compat**

- Navigate to `/matches?tab=live` → app snaps to Today.
- Navigate to `/matches?tab=upcoming` → stays on Upcoming.
- Navigate to `/matches?tab=results` → snaps to Yesterday.

- [ ] **Step 9.7: Verify locale**

- Switch locale to `es` (via the picker) → tabs render as `Ayer · Hoy · Próximos`, sheet headings as `Circuito / Categoría / Nivel`.

- [ ] **Step 9.8: Screenshot for the PR**

Take one `mcp__Claude_Preview__preview_screenshot` of the default Today view and one of the filter sheet open. Attach to the PR description.

---

## Post-implementation

- [ ] **Final: Update the session memory**

Once merged, add a short entry to `memory/` documenting "Matches page moved to Apple-tabs model (Yesterday/Today/Upcoming)" so future sessions don't propose the old three-tab structure.
