# Matches Page Full Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Apple-tabs matches page with a swipeable ±14-day date strip, stacked Filters/Live action column, contained tournament cards (circuit logo + city/country/level), and compact 2-row match rows with inline bookmark + notify actions on upcoming matches.

**Architecture:** Layers on top of the shipped Apple-tabs surface. Three new presentational components (`MatchesDateStrip`, `TournamentCard`, `MatchRow`) + one new client hook (`useMatchNotification`) are extracted from `matches/page.tsx` (which drops from ~900 → ~400 lines). `applyFilters` helper and the filter sheet are re-used verbatim. The chip strip is preserved.

**Tech Stack:** Next.js 16, React 19, TypeScript, next-intl, Vitest. Existing `useFollowing` supplies star state; the new `useMatchNotification` hook mirrors its localStorage-MVP pattern until the notifications API endpoint lands.

**Spec:** [docs/superpowers/specs/2026-04-19-matches-page-full-redesign-design.md](../specs/2026-04-19-matches-page-full-redesign-design.md)

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/matches-filters.ts` | **Modify** | Add `computeDayWindow`, `parseDateParam`; widen `tabForLegacyParam` return type |
| `src/lib/__tests__/matches-filters.test.ts` | **Modify** | Tests for new helpers |
| `src/hooks/useMatchNotification.ts` | **Create** | localStorage-backed per-match notify toggle |
| `src/hooks/__tests__/useMatchNotification.test.ts` | **Create** | Tests for hook storage shape |
| `src/components/MatchRow.tsx` | **Create** | 2-row match row with live / finished / upcoming right-side variants |
| `src/components/TournamentCard.tsx` | **Create** | Contained tournament card (logo + city/country/level header + match rows) |
| `src/components/MatchesDateStrip.tsx` | **Create** | Horizontal date strip + stacked Filters/Live action column |
| `src/components/MatchesTabs.tsx` | **Delete** | Replaced by `MatchesDateStrip` |
| `src/app/[locale]/(app)/matches/page.tsx` | **Modify (major)** | State refactor, mount new components, drop inline `V3MatchRow` / `TournamentGroup` / `LiveNowStrip` / `TabPanel` |
| `src/messages/{en,es,pt,it,fr}.json` | **Modify** | New keys: `matches.liveOnly`, `matches.bookmarkMatch`, `matches.notifyOnMatchStart`, `matches.setOrdinal.1`–`5`, `matches.setUnit` |

---

## Task 1: Pure helpers — `computeDayWindow` + `parseDateParam` (TDD)

**Files:**
- Modify: `src/lib/matches-filters.ts`
- Modify: `src/lib/__tests__/matches-filters.test.ts`

- [ ] **Step 1.1: Add failing tests**

At the bottom of `src/lib/__tests__/matches-filters.test.ts`, append:

```ts
import {
  computeDayWindow,
  parseDateParam,
  remapLegacyTab,
} from '../matches-filters'

describe('computeDayWindow', () => {
  it('returns [dayStart, dayEnd) in UTC for offset=0', () => {
    const now = new Date('2026-04-19T10:30:00Z')
    const w = computeDayWindow(now, 'UTC', 0)
    expect(w.dayStart).toBe('2026-04-19T00:00:00.000Z')
    expect(w.dayEnd).toBe('2026-04-20T00:00:00.000Z')
  })

  it('offset=+3 jumps three days forward', () => {
    const now = new Date('2026-04-19T10:30:00Z')
    const w = computeDayWindow(now, 'UTC', 3)
    expect(w.dayStart).toBe('2026-04-22T00:00:00.000Z')
    expect(w.dayEnd).toBe('2026-04-23T00:00:00.000Z')
  })

  it('offset=-7 jumps a week back', () => {
    const now = new Date('2026-04-19T10:30:00Z')
    const w = computeDayWindow(now, 'UTC', -7)
    expect(w.dayStart).toBe('2026-04-12T00:00:00.000Z')
    expect(w.dayEnd).toBe('2026-04-13T00:00:00.000Z')
  })

  it('respects America/New_York (UTC-4 in April)', () => {
    // Apr 19 02:30 UTC = Apr 18 22:30 ET → "today" in ET = Apr 18
    const now = new Date('2026-04-19T02:30:00Z')
    const w = computeDayWindow(now, 'America/New_York', 0)
    expect(w.dayStart).toBe('2026-04-18T04:00:00.000Z')
    expect(w.dayEnd).toBe('2026-04-19T04:00:00.000Z')
  })
})

describe('parseDateParam', () => {
  const today = new Date('2026-04-19T10:00:00Z')

  it('parses valid ISO date to offset', () => {
    expect(parseDateParam('2026-04-22', today, 'UTC')).toBe(3)
    expect(parseDateParam('2026-04-19', today, 'UTC')).toBe(0)
    expect(parseDateParam('2026-04-18', today, 'UTC')).toBe(-1)
  })

  it('clamps out-of-range dates to null', () => {
    expect(parseDateParam('2026-05-15', today, 'UTC')).toBe(null) // > +14
    expect(parseDateParam('2026-04-01', today, 'UTC')).toBe(null) // < -14
  })

  it('returns null for invalid strings', () => {
    expect(parseDateParam('not-a-date', today, 'UTC')).toBe(null)
    expect(parseDateParam('', today, 'UTC')).toBe(null)
    expect(parseDateParam(null, today, 'UTC')).toBe(null)
  })
})

describe('remapLegacyTab', () => {
  it('maps the three legacy tab values', () => {
    expect(remapLegacyTab('live')).toEqual({ dateOffset: 0, liveOnly: true })
    expect(remapLegacyTab('upcoming')).toEqual({ dateOffset: 1, liveOnly: false })
    expect(remapLegacyTab('results')).toEqual({ dateOffset: -1, liveOnly: false })
  })
  it('returns null for unknown / missing values', () => {
    expect(remapLegacyTab(null)).toBe(null)
    expect(remapLegacyTab('foo')).toBe(null)
    expect(remapLegacyTab('today')).toBe(null) // not a legacy value
  })
})
```

- [ ] **Step 1.2: Run tests — expect FAIL**

Run: `npx vitest run src/lib/__tests__/matches-filters.test.ts`
Expected: FAIL — `Cannot find module '../matches-filters'` imports (`computeDayWindow`, `parseDateParam`, `remapLegacyTab`) don't exist.

- [ ] **Step 1.3: Implement `computeDayWindow`**

Append to `src/lib/matches-filters.ts`:

```ts
export interface DayWindow {
  dayStart: string
  dayEnd: string
}

export function computeDayWindow(now: Date, tz: string, dateOffset: number): DayWindow {
  const base = computeDateWindow(now, tz)
  const todayStart = new Date(base.todayStart)
  const dayStart = new Date(todayStart.getTime() + dateOffset * 24 * 60 * 60 * 1000)
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
  return { dayStart: dayStart.toISOString(), dayEnd: dayEnd.toISOString() }
}
```

- [ ] **Step 1.4: Implement `parseDateParam`**

Append to `src/lib/matches-filters.ts`:

```ts
const MAX_OFFSET = 14

export function parseDateParam(raw: string | null, now: Date, tz: string): number | null {
  if (!raw) return null
  // Accept YYYY-MM-DD only
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const parsed = new Date(`${raw}T00:00:00Z`)
  if (isNaN(parsed.getTime())) return null

  const base = computeDateWindow(now, tz)
  const todayStart = new Date(base.todayStart)
  const diffDays = Math.round((parsed.getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000))

  if (diffDays < -MAX_OFFSET || diffDays > MAX_OFFSET) return null
  return diffDays
}
```

- [ ] **Step 1.5: Implement `remapLegacyTab`**

Append to `src/lib/matches-filters.ts`:

```ts
export interface LegacyTabRemap {
  dateOffset: number
  liveOnly: boolean
}

export function remapLegacyTab(value: string | null): LegacyTabRemap | null {
  if (value === 'live')     return { dateOffset: 0,  liveOnly: true  }
  if (value === 'upcoming') return { dateOffset: 1,  liveOnly: false }
  if (value === 'results')  return { dateOffset: -1, liveOnly: false }
  return null
}
```

- [ ] **Step 1.6: Run tests — expect PASS**

Run: `npx vitest run src/lib/__tests__/matches-filters.test.ts`
Expected: PASS — all prior 12 + 10 new = 22 tests green.

- [ ] **Step 1.7: Commit**

```bash
git add src/lib/matches-filters.ts src/lib/__tests__/matches-filters.test.ts
git commit -m "$(cat <<'EOF'
feat(matches): add computeDayWindow + parseDateParam + remapLegacyTab

Pure helpers needed for the date-strip redesign. computeDayWindow
derives a [start,end) window for any dateOffset in the user tz.
parseDateParam validates ?date=YYYY-MM-DD query params within ±14 days.
remapLegacyTab converts ?tab=live|upcoming|results into the new
{ dateOffset, liveOnly } shape.
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

- [ ] **Step 2.1: Add English keys**

In `src/messages/en.json`, inside the top-level `"matches"` object (existing keys kept unchanged), add these keys. They can go at the end of the object alongside the existing keys:

```json
"liveOnly": "Live only",
"bookmarkMatch": "Bookmark match",
"notifyOnMatchStart": "Notify me",
"setUnit": "set",
"setOrdinal": {
  "1": "1st",
  "2": "2nd",
  "3": "3rd",
  "4": "4th",
  "5": "5th"
}
```

- [ ] **Step 2.2: Add Spanish keys (es.json)**

```json
"liveOnly": "Solo en directo",
"bookmarkMatch": "Guardar partido",
"notifyOnMatchStart": "Avisarme",
"setUnit": "set",
"setOrdinal": { "1": "1º", "2": "2º", "3": "3º", "4": "4º", "5": "5º" }
```

- [ ] **Step 2.3: Add Portuguese keys (pt.json)**

```json
"liveOnly": "Só ao vivo",
"bookmarkMatch": "Guardar partida",
"notifyOnMatchStart": "Avisar",
"setUnit": "set",
"setOrdinal": { "1": "1º", "2": "2º", "3": "3º", "4": "4º", "5": "5º" }
```

- [ ] **Step 2.4: Add Italian keys (it.json)**

```json
"liveOnly": "Solo dal vivo",
"bookmarkMatch": "Salva partita",
"notifyOnMatchStart": "Avvisami",
"setUnit": "set",
"setOrdinal": { "1": "1°", "2": "2°", "3": "3°", "4": "4°", "5": "5°" }
```

- [ ] **Step 2.5: Add French keys (fr.json)**

```json
"liveOnly": "En direct seulement",
"bookmarkMatch": "Épingler le match",
"notifyOnMatchStart": "M'avertir",
"setUnit": "set",
"setOrdinal": { "1": "1er", "2": "2e", "3": "3e", "4": "4e", "5": "5e" }
```

- [ ] **Step 2.6: Validate JSON**

Run: `for f in src/messages/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "OK $f"; done`
Expected: 5 × `OK src/messages/XX.json`.

- [ ] **Step 2.7: Commit**

```bash
git add src/messages/
git commit -m "i18n(matches): add liveOnly, bookmarkMatch, notifyOnMatchStart, setOrdinal keys"
```

---

## Task 3: `useMatchNotification` hook

**Files:**
- Create: `src/hooks/useMatchNotification.ts`
- Create: `src/hooks/__tests__/useMatchNotification.test.ts`

- [ ] **Step 3.1: Write test for pure localStorage helper**

Create `src/hooks/__tests__/useMatchNotification.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  readNotifiedMatches,
  writeNotifiedMatches,
  toggleNotifiedMatch,
  NOTIFIED_STORAGE_KEY,
} from '../useMatchNotification'

// Minimal in-memory localStorage polyfill for Node test env
class MemoryStorage {
  store = new Map<string, string>()
  getItem(k: string) { return this.store.get(k) ?? null }
  setItem(k: string, v: string) { this.store.set(k, v) }
  removeItem(k: string) { this.store.delete(k) }
  clear() { this.store.clear() }
}

beforeEach(() => {
  (globalThis as any).localStorage = new MemoryStorage()
})

describe('useMatchNotification — pure helpers', () => {
  it('readNotifiedMatches returns empty set when storage is empty', () => {
    expect(readNotifiedMatches().size).toBe(0)
  })

  it('write then read round-trips', () => {
    const ids = new Set(['m-1', 'm-2'])
    writeNotifiedMatches(ids)
    const read = readNotifiedMatches()
    expect(read.has('m-1')).toBe(true)
    expect(read.has('m-2')).toBe(true)
    expect(read.size).toBe(2)
  })

  it('toggleNotifiedMatch adds then removes an id', () => {
    expect(toggleNotifiedMatch('m-1').has('m-1')).toBe(true)
    expect(toggleNotifiedMatch('m-1').has('m-1')).toBe(false)
  })

  it('toggleNotifiedMatch preserves other ids', () => {
    toggleNotifiedMatch('m-1')
    toggleNotifiedMatch('m-2')
    const afterRemove = toggleNotifiedMatch('m-1')
    expect(afterRemove.has('m-1')).toBe(false)
    expect(afterRemove.has('m-2')).toBe(true)
  })

  it('falls back to empty set when storage is corrupt', () => {
    localStorage.setItem(NOTIFIED_STORAGE_KEY, 'not-json')
    expect(readNotifiedMatches().size).toBe(0)
  })
})
```

- [ ] **Step 3.2: Run — expect FAIL**

Run: `npx vitest run src/hooks/__tests__/useMatchNotification.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement hook + helpers**

Create `src/hooks/useMatchNotification.ts`:

```ts
'use client'

import { useCallback, useEffect, useState } from 'react'

export const NOTIFIED_STORAGE_KEY = 'pn_notified_matches'

export function readNotifiedMatches(): Set<string> {
  try {
    const raw = (typeof localStorage === 'undefined' ? null : localStorage.getItem(NOTIFIED_STORAGE_KEY))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is string => typeof v === 'string'))
  } catch {
    return new Set()
  }
}

export function writeNotifiedMatches(ids: Set<string>): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(NOTIFIED_STORAGE_KEY, JSON.stringify([...ids]))
  } catch {}
}

export function toggleNotifiedMatch(id: string): Set<string> {
  const next = new Set(readNotifiedMatches())
  if (next.has(id)) next.delete(id)
  else next.add(id)
  writeNotifiedMatches(next)
  return next
}

export function useMatchNotification(matchId: string): {
  isNotifying: boolean
  toggleNotify: () => void
} {
  const [ids, setIds] = useState<Set<string>>(() => new Set())

  // Hydrate after mount to avoid SSR/client mismatch
  useEffect(() => { setIds(readNotifiedMatches()) }, [])

  const toggleNotify = useCallback(() => {
    const next = toggleNotifiedMatch(matchId)
    setIds(next)
  }, [matchId])

  return { isNotifying: ids.has(matchId), toggleNotify }
}
```

- [ ] **Step 3.4: Run tests — expect PASS**

Run: `npx vitest run src/hooks/__tests__/useMatchNotification.test.ts`
Expected: 5/5 tests PASS.

- [ ] **Step 3.5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE 'useMatchNotification' || echo "clean"`
Expected: `clean`.

- [ ] **Step 3.6: Commit**

```bash
git add src/hooks/useMatchNotification.ts src/hooks/__tests__/useMatchNotification.test.ts
git commit -m "$(cat <<'EOF'
feat(matches): add useMatchNotification hook

LocalStorage-backed per-match notify toggle. MVP for the redesign —
pure client state until the /api/user/notifications endpoint lands.
Mirrors the useFollowing pattern (readNotifiedMatches +
writeNotifiedMatches + toggleNotifiedMatch pure helpers + useMatchNotification
hook with hydration-safe mount).
EOF
)"
```

---

## Task 4: Extract `MatchRow` component (no visual change)

**Files:**
- Create: `src/components/MatchRow.tsx`
- Modify: `src/app/[locale]/(app)/matches/page.tsx`

This task only *moves* the existing `V3MatchRow` function out of `page.tsx` into its own file — verbatim, with its imports. No redesign yet. Keeps PRs focused.

- [ ] **Step 4.1: Identify the V3MatchRow function in page.tsx**

Run: `grep -n "function V3MatchRow" src/app/[locale]/\(app\)/matches/page.tsx`
You should see a single line around 102.

- [ ] **Step 4.2: Read V3MatchRow + its module-level prerequisites**

Run: `sed -n '85,415p' src/app/[locale]/\(app\)/matches/page.tsx | head -340`
Capture: `PT_ORD`, `_prevScores`, `_finishedAt`, `_prevLiveIds`, `LINGER_MS`, and the full `V3MatchRow` body. Also `pairName`, `parseSetScore`, `parseSetFromGames` imports already in page.tsx.

- [ ] **Step 4.3: Create `MatchRow.tsx` as a verbatim extraction**

Create `src/components/MatchRow.tsx`. Paste:

```tsx
'use client'

import React, { useEffect, useRef, useState, useMemo } from 'react'
import { Link } from '@/i18n/navigation'
import { useFormatter } from 'next-intl'
import { TIME_24H, DATE_SHORT } from '@/lib/format-patterns'
import { Match, pairName, parseSetScore, parseSetFromGames } from '@/types/match'
import FollowButton from '@/components/FollowButton'
import { FlagImage } from '@/components/FlagImage'

// Shared colours — eventually lift to @/lib/brand-colors
const GREEN = '#7ED321'
const LIVE_RED = '#FF4655'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'
const MEN_BLUE = '#4A9EFF'
const WOMEN_PURPLE = '#D966FF'

const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
}

// ── Point ordinal for score-change detection ─────────────────
const PT_ORD: Record<string, number> = { '0': 0, '15': 1, '30': 2, '40': 3, 'AD': 4 }

// Module-level maps so score tracking survives component remounts
const _prevScores = new Map<string, { p1Games: number; p2Games: number; p1Pts: string; p2Pts: string }>()
const _finishedAt = new Map<string, number>()
const _prevLiveIds = new Set<string>()
const LINGER_MS = 2 * 60 * 1000

/* … (paste the EXACT V3MatchRow body from page.tsx here; replace the name with MatchRow) */
```

For the `/* … */` placeholder: open `src/app/[locale]/(app)/matches/page.tsx`, find `function V3MatchRow({ match }: { match: Match }) {`, and copy everything from that line through the matching closing `}` (end of the function). Paste into `MatchRow.tsx` and change the function name from `V3MatchRow` → `MatchRow`. Add a default export at the end:

```tsx
export default MatchRow
```

Keep the module-level maps, constants, and imports defined above the function inside `MatchRow.tsx`.

- [ ] **Step 4.4: Delete the V3MatchRow function + its prerequisites from page.tsx**

In `src/app/[locale]/(app)/matches/page.tsx`:
1. Delete the `V3MatchRow` function (~313 lines from line ~100 to line ~413).
2. Delete the now-orphaned `PT_ORD`, `_prevScores`, `_finishedAt`, `_prevLiveIds`, `LINGER_MS` module-level declarations.
3. At the top of the file, add:

```tsx
import V3MatchRow from '@/components/MatchRow'
```

Replace the `V3MatchRow` function name with the default export throughout the file for now (Task 8 will rename call sites to `MatchRow`).

- [ ] **Step 4.5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE 'matches/page|MatchRow' || echo "clean"`
Expected: `clean`.

- [ ] **Step 4.6: Manually verify the matches page still renders**

Run: `npm run dev` (if not already running), navigate to `/matches`, verify the match rows render identically to before the extraction. Score animations, follow star, live point pulsing — all should work unchanged.

- [ ] **Step 4.7: Commit**

```bash
git add src/components/MatchRow.tsx 'src/app/[locale]/(app)/matches/page.tsx'
git commit -m "refactor(matches): extract V3MatchRow to MatchRow.tsx (verbatim)"
```

---

## Task 5: Redesign `MatchRow` — 2-row layout + right-side variants

**Files:**
- Modify: `src/components/MatchRow.tsx`

Drop the meta-pill row (court / round / status). Replace the current right-side score-column with three variants keyed on match status.

- [ ] **Step 5.1: Import new hook + set up variant dispatch**

At the top of `src/components/MatchRow.tsx`, add:

```tsx
import { useMatchNotification } from '@/hooks/useMatchNotification'
import { useTranslations } from 'next-intl'
```

- [ ] **Step 5.2: Rewrite the component body**

Replace the entire current `function MatchRow({ match })` body with:

```tsx
function MatchRow({ match }: { match: Match }) {
  const format = useFormatter()
  const t = useTranslations('matches')

  const sets = (match.sets ?? []).sort((a, b) => a.set_number - b.set_number)
  const currentSet = sets.find(s => s.is_current)
  const currentGame = currentSet?.games?.find(g => g.is_current)

  const currentPoints = currentGame?.points?.length
    ? currentGame.points[currentGame.points.length - 1]
    : ''
  const pointsParts = (currentPoints ?? '').split(/[:\-]/)
  const p1GamePts = pointsParts[0] ?? ''
  const p2GamePts = pointsParts[1] ?? ''

  const isLive = match.status === 'live'
  const isFinished = ['finished', 'retired', 'walkover'].includes(match.status)
  const category = (match as any).category as string | null
  const genderColor = category === 'women' ? WOMEN_PURPLE : category === 'men' ? MEN_BLUE : MUTED

  const pair1Name = pairName(match.pair1_player1, match.pair1_player2)
  const pair2Name = pairName(match.pair2_player1, match.pair2_player2)

  // ── Score-change flash animation (unchanged from V3MatchRow) ─
  const [flashPair, setFlashPair] = useState<1 | 2 | null>(null)
  const flashKeyRef = useRef(0)
  const p1TotalGames = useMemo(() => sets.reduce((s, st) => s + (st.pair1_games ?? 0), 0), [sets])
  const p2TotalGames = useMemo(() => sets.reduce((s, st) => s + (st.pair2_games ?? 0), 0), [sets])

  useEffect(() => {
    if (!isLive) { _prevScores.delete(match.id); return }
    const cur = { p1Games: p1TotalGames, p2Games: p2TotalGames, p1Pts: p1GamePts, p2Pts: p2GamePts }
    const prev = _prevScores.get(match.id)
    if (prev && (prev.p1Games !== cur.p1Games || prev.p2Games !== cur.p2Games || prev.p1Pts !== cur.p1Pts || prev.p2Pts !== cur.p2Pts)) {
      let scorer: 1 | 2 | null = null
      if (cur.p1Games > prev.p1Games) scorer = 1
      else if (cur.p2Games > prev.p2Games) scorer = 2
      else {
        const curP1 = PT_ORD[cur.p1Pts] ?? 0
        const curP2 = PT_ORD[cur.p2Pts] ?? 0
        const prevP1 = PT_ORD[prev.p1Pts] ?? 0
        const prevP2 = PT_ORD[prev.p2Pts] ?? 0
        if (curP1 > prevP1) scorer = 1
        else if (curP2 > prevP2) scorer = 2
        else if (prevP1 > prevP2 && curP1 <= curP2) scorer = 2
        else if (prevP2 > prevP1 && curP2 <= curP1) scorer = 1
      }
      _prevScores.set(match.id, cur)
      if (scorer) {
        flashKeyRef.current += 1
        setFlashPair(scorer)
        const tout = setTimeout(() => setFlashPair(null), 2800)
        return () => clearTimeout(tout)
      }
    } else {
      _prevScores.set(match.id, cur)
    }
  }, [isLive, match.id, p1TotalGames, p2TotalGames, p1GamePts, p2GamePts])

  return (
    <Link href={`/match/${match.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        alignItems: 'center',
        padding: '12px 14px 12px 17px',
        borderTop: `1px solid ${BORDER}`,
        cursor: 'pointer',
      }}>
        <span style={{
          position: 'absolute', left: 0, top: 8, bottom: 8, width: 3,
          background: genderColor,
        }} />

        {/* ── Pairs (2 rows, one per pair) ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <PairLine pair={match.pair1_player1 ? [match.pair1_player1, match.pair1_player2] : [null, null]} name={pair1Name} isWinner={match.winner_pair === 1 && isFinished} isLoser={match.winner_pair === 2 && isFinished} />
          <PairLine pair={match.pair2_player1 ? [match.pair2_player1, match.pair2_player2] : [null, null]} name={pair2Name} isWinner={match.winner_pair === 2 && isFinished} isLoser={match.winner_pair === 1 && isFinished} />
        </div>

        {/* ── Right side (variant by status) ── */}
        {isLive && (
          <LiveRight
            sets={sets}
            currentSetNumber={currentSet?.set_number ?? sets.length}
            p1Pts={p1GamePts}
            p2Pts={p2GamePts}
            setUnit={t('setUnit')}
            setOrdinal={(n: number) => t(`setOrdinal.${n}` as any)}
          />
        )}
        {isFinished && (
          <FinishedRight sets={sets} winnerPair={match.winner_pair ?? null} label={match.status === 'retired' ? 'RET' : match.status === 'walkover' ? 'W/O' : t('final')} />
        )}
        {!isLive && !isFinished && (
          <UpcomingRight match={match} format={format} t={t} />
        )}
      </div>
    </Link>
  )
}
```

- [ ] **Step 5.3: Add the sub-components below `MatchRow`**

Append to `MatchRow.tsx`:

```tsx
function PairLine({ pair, name, isWinner, isLoser }: {
  pair: [any, any]
  name: string
  isWinner: boolean
  isLoser: boolean
}) {
  const color = isLoser ? 'rgba(156,163,175,0.75)' : '#fff'
  const weight = isWinner ? 800 : 700
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <DualFlag p1={pair[0]} p2={pair[1]} />
      <span style={{ fontSize: 14, fontWeight: weight, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {name}
      </span>
    </div>
  )
}

function DualFlag({ p1, p2 }: { p1: any; p2: any }) {
  return (
    <div style={{ position: 'relative', width: 24, height: 18, flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
        <FlagImage country={p1?.country ?? null} size={14} />
      </div>
      <div style={{ position: 'absolute', top: 5, left: 7, zIndex: 1 }}>
        <FlagImage country={p2?.country ?? null} size={14} />
      </div>
    </div>
  )
}

function LiveRight({ sets, currentSetNumber, p1Pts, p2Pts, setUnit, setOrdinal }: {
  sets: any[]
  currentSetNumber: number
  p1Pts: string
  p2Pts: string
  setUnit: string
  setOrdinal: (n: number) => string
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto auto 1px auto', columnGap: 8, alignItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1, color: LIVE_RED }}>
        <span style={{ fontSize: 12, fontWeight: 900 }}>{setOrdinal(currentSetNumber)}</span>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2, opacity: 0.85 }}>{setUnit}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, fontVariantNumeric: 'tabular-nums' }}>
        {sets.map(s => {
          const parsed = parseSetScore(s.set_score) ?? parseSetFromGames(s.pair1_games, s.pair2_games)
          const p1 = parsed?.p1 ?? s.pair1_games ?? 0
          const p2 = parsed?.p2 ?? s.pair2_games ?? 0
          const isCurrent = s.is_current
          return (
            <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 15, fontWeight: 800, fontFamily: 'monospace', minWidth: 14, textAlign: 'center', color: isCurrent ? GREEN : (p1 > p2 ? '#fff' : 'rgba(156,163,175,0.75)') }}>{p1}</span>
              <span style={{ fontSize: 15, fontWeight: 800, fontFamily: 'monospace', minWidth: 14, textAlign: 'center', color: isCurrent ? GREEN : (p2 > p1 ? '#fff' : 'rgba(156,163,175,0.75)') }}>{p2}</span>
            </div>
          )
        })}
      </div>

      <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.18)' }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 16, fontWeight: 900, color: LIVE_RED, fontFamily: 'monospace', minWidth: 22, textAlign: 'center' }}>{p1Pts || '—'}</span>
        <span style={{ fontSize: 16, fontWeight: 900, color: LIVE_RED, fontFamily: 'monospace', minWidth: 22, textAlign: 'center' }}>{p2Pts || '—'}</span>
      </div>
    </div>
  )
}

function FinishedRight({ sets, winnerPair, label }: {
  sets: any[]
  winnerPair: 1 | 2 | null
  label: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: 0.6, textTransform: 'uppercase', color: MUTED }}>{label}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontVariantNumeric: 'tabular-nums' }}>
        {[1, 2].map(pairNum => (
          <div key={pairNum} style={{ display: 'flex', gap: 6 }}>
            {sets.map(s => {
              const parsed = parseSetScore(s.set_score) ?? parseSetFromGames(s.pair1_games, s.pair2_games)
              const games = pairNum === 1 ? (parsed?.p1 ?? s.pair1_games ?? 0) : (parsed?.p2 ?? s.pair2_games ?? 0)
              const oppGames = pairNum === 1 ? (parsed?.p2 ?? s.pair2_games ?? 0) : (parsed?.p1 ?? s.pair1_games ?? 0)
              const wonSet = games > oppGames
              return (
                <span key={s.id} style={{ fontSize: 15, fontWeight: 800, fontFamily: 'monospace', minWidth: 14, textAlign: 'center', color: wonSet ? '#fff' : 'rgba(156,163,175,0.75)' }}>
                  {games}
                </span>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function UpcomingRight({ match, format, t }: {
  match: Match
  format: ReturnType<typeof useFormatter>
  t: ReturnType<typeof useTranslations>
}) {
  const { isNotifying, toggleNotify } = useMatchNotification(match.id)

  const scheduleDisplay = (() => {
    if (!match.scheduled_at) return { time: '', date: '', approximate: false }
    const d = new Date(match.scheduled_at)
    const hasTime = d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0
    const time = hasTime ? format.dateTime(d, TIME_24H) : ''
    const date = format.dateTime(d, DATE_SHORT)
    const label = (match as any).schedule_label ?? ''
    const approximate = /not before|followed by/i.test(label)
    return { time, date, approximate }
  })()

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
        <FollowButton type="match" targetId={match.id} variant="star" size={14} style={{
          width: 30, height: 30,
          background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          clipPath: CHUNKY.badge,
        }} />
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); toggleNotify() }}
          aria-label={t('notifyOnMatchStart')}
          aria-pressed={isNotifying}
          style={{
            width: 30, height: 30,
            background: isNotifying ? 'rgba(126,211,33,0.14)' : 'rgba(255,255,255,0.04)',
            border: isNotifying ? '1px solid transparent' : `1px solid ${BORDER}`,
            color: isNotifying ? GREEN : 'rgba(156,163,175,0.9)',
            cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            clipPath: CHUNKY.badge,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>
      </div>
      {(scheduleDisplay.date || scheduleDisplay.time) && (
        <div style={{ textAlign: 'right', minWidth: 48 }}>
          <div style={{ fontSize: 10, color: MUTED, fontWeight: 600, letterSpacing: 0.3 }}>{scheduleDisplay.date}</div>
          {scheduleDisplay.time && (
            <div style={{ fontSize: 16, color: GREEN, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
              {scheduleDisplay.time}{scheduleDisplay.approximate ? '*' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5.4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE 'MatchRow' || echo "clean"`
Expected: `clean`.

- [ ] **Step 5.5: Manual verify**

Navigate to `/matches`:
- Live match: vertical divider visible between set scores and live points; `2nd set` stacked in red; current-set score in green; live points in red
- Finished match: tiny `Final` label above score grid (or `RET` / `W/O` when applicable)
- Scheduled match: star + bell column + time block on the right
- Tap bell on a scheduled match → bell turns green; reload → still green (localStorage persisted)

- [ ] **Step 5.6: Commit**

```bash
git add src/components/MatchRow.tsx
git commit -m "$(cat <<'EOF'
refactor(matches): compact 2-row MatchRow layout

Drops the court/round meta pill row above each pair. Each match now
renders as two rows (one per pair) with a status-specific right side:

- Live: stacked "Nth set" label + set columns + 1px divider + live
  point column in brand red
- Finished: "Final" (or RET / W/O) label above set scores
- Upcoming: vertical star + bell action cluster + time/date block

Bell wires to useMatchNotification (localStorage MVP).
EOF
)"
```

---

## Task 6: Extract `TournamentGroup` to `TournamentCard.tsx` (verbatim)

**Files:**
- Create: `src/components/TournamentCard.tsx`
- Modify: `src/app/[locale]/(app)/matches/page.tsx`

Same pattern as Task 4 — move the current `TournamentGroup` function into its own file without changing behaviour.

- [ ] **Step 6.1: Create the new file with the verbatim extraction**

Create `src/components/TournamentCard.tsx`:

```tsx
'use client'

import React from 'react'
import { Link } from '@/i18n/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { DATE_SHORT } from '@/lib/format-patterns'
import { Match } from '@/types/match'
import { FlagImage } from '@/components/FlagImage'
import { mostAdvancedRound } from '@/lib/tournament-labels'
import { ResultCard } from '@/components/ResultCard'
import MatchRow from '@/components/MatchRow'

const GREEN = '#7ED321'
const LIVE_RED = '#FF4655'
const BG_BASE = '#1A1A1A'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'

const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
}

const KEEP_UPPER = new Set(['FIP', 'P1', 'P2', 'WPT', 'APT', 'A1', 'II', 'III', 'IV', 'BNL'])
function titleCase(name: string): string {
  return name.split(' ').map(word => {
    if (KEEP_UPPER.has(word.toUpperCase())) return word.toUpperCase()
    if (word.length <= 1) return word.toUpperCase()
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  }).join(' ')
}

/* PASTE: copy the existing TournamentGroup function body from
   src/app/[locale]/(app)/matches/page.tsx verbatim. Rename the
   function to `TournamentCard`. Tab prop type is already
   'yesterday' | 'today' | 'upcoming' from Task 7 of the Apple-tabs
   plan. */

export default TournamentCard
```

For the `PASTE` placeholder: open `src/app/[locale]/(app)/matches/page.tsx`, find `function TournamentGroup({ tournament, matches, tab }`, and copy through its matching closing `}`. Paste into `TournamentCard.tsx` between the helper imports/constants above and the `export default` line. Rename `TournamentGroup` → `TournamentCard`.

- [ ] **Step 6.2: Delete the original from page.tsx**

In `src/app/[locale]/(app)/matches/page.tsx`:
1. Delete the `TournamentGroup` function entirely.
2. Delete the local `titleCase` helper and the `KEEP_UPPER` set (they now live in TournamentCard.tsx).
3. Add at the top:

```tsx
import TournamentGroup from '@/components/TournamentCard'
```

(Temporarily aliasing the imported `TournamentCard` as `TournamentGroup` so existing call sites keep working. Task 9 cleans this up.)

- [ ] **Step 6.3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE 'matches/page|TournamentCard' || echo "clean"`
Expected: `clean`.

- [ ] **Step 6.4: Manual verify**

Navigate to `/matches` — tournament grouping, header, rows, all look identical to before.

- [ ] **Step 6.5: Commit**

```bash
git add src/components/TournamentCard.tsx 'src/app/[locale]/(app)/matches/page.tsx'
git commit -m "refactor(matches): extract TournamentGroup to TournamentCard.tsx (verbatim)"
```

---

## Task 7: Redesign `TournamentCard` — container + logo + city/country/level

**Files:**
- Modify: `src/components/TournamentCard.tsx`

Replace the current flat light-text header with a chunky-polygon contained card. Header: circuit logo on the left, `City, Country` + level pill + round label on the right.

- [ ] **Step 7.1: Add circuit-logo helper**

At the top of `src/components/TournamentCard.tsx` (below the existing imports, above the `titleCase`), add:

```tsx
const PREMIER_LEVELS = new Set(['p1', 'p2', 'major', 'finals'])

function circuitLogoFor(level: string | null | undefined): string | null {
  if (!level) return null
  if (PREMIER_LEVELS.has(level)) return '/premier-padel-logo.svg'
  if (level.startsWith('fip_')) return '/fip-tour-logo.svg'
  return null
}

function cityCountry(tournament: any): string {
  const city = (tournament.location || tournament.name || '').trim()
  const country = (tournament.country || '').toUpperCase()
  if (city && country) return `${titleCase(city)}, ${country}`
  return titleCase(city || country || '—')
}

function levelTint(level: string | null | undefined): { bg: string; color: string } {
  if (!level) return { bg: 'rgba(255,255,255,0.06)', color: '#9CA3AF' }
  if (level === 'fip_gold')   return { bg: 'rgba(245,166,35,0.14)', color: '#F5A623' }
  if (level === 'fip_silver') return { bg: 'rgba(192,192,192,0.12)', color: '#C0C0C0' }
  if (level === 'fip_bronze') return { bg: 'rgba(205,127,50,0.14)', color: '#CD7F32' }
  if (level === 'major' || level === 'finals') return { bg: 'rgba(245,166,35,0.14)', color: '#F5A623' }
  return { bg: 'rgba(126,211,33,0.14)', color: GREEN }
}

function levelShortLabel(level: string | null | undefined): string {
  if (!level) return '—'
  if (level === 'fip_gold')   return 'FIP Gold'
  if (level === 'fip_silver') return 'FIP Silver'
  if (level === 'fip_bronze') return 'FIP Bronze'
  if (level === 'fip_other')  return 'FIP'
  return level.toUpperCase()
}
```

- [ ] **Step 7.2: Rewrite the `TournamentCard` body**

Replace the entire current `TournamentCard` function with:

```tsx
function TournamentCard({ tournament, matches, tab }: {
  tournament: any
  matches: Match[]
  tab: 'yesterday' | 'today' | 'upcoming'
}) {
  if (!tournament) return null
  const t = useTranslations('matches')

  const stageLabel = mostAdvancedRound(matches)
  const liveCount = matches.filter(m => m.status === 'live').length
  const matchCount = matches.length

  const logoSrc = circuitLogoFor(tournament.level)
  const tint = levelTint(tournament.level)

  return (
    <div style={{
      margin: '14px 12px 0',
      background: '#141414',
      border: '1px solid rgba(255,255,255,0.10)',
      clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
      overflow: 'hidden',
      boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
    }}>
      {/* ── Header ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '72px 1fr auto',
        columnGap: 14,
        alignItems: 'center',
        padding: '14px 14px 12px',
        background: 'rgba(255,255,255,0.02)',
        borderBottom: `1px solid ${BORDER}`,
      }}>
        <div style={{
          width: 72, height: 36,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRight: `1px solid ${BORDER}`,
          paddingRight: 12,
        }}>
          {logoSrc
            ? <img src={logoSrc} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            : <FlagImage country={tournament.country ?? null} size={24} />}
        </div>

        <Link
          href={`/tournaments/${tournament.id}`}
          style={{ minWidth: 0, textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 3 }}
        >
          <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', letterSpacing: -0.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {cityCountry(tournament)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              padding: '2px 8px',
              fontSize: 10, fontWeight: 800,
              clipPath: CHUNKY.badge,
              letterSpacing: 0.4,
              background: tint.bg, color: tint.color,
            }}>
              {levelShortLabel(tournament.level)}
            </span>
            {stageLabel && (
              <span style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                · {stageLabel}
              </span>
            )}
          </div>
        </Link>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
          {liveCount > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 9, fontWeight: 900, letterSpacing: 0.6, textTransform: 'uppercase',
              color: LIVE_RED, padding: '2px 7px',
              background: 'rgba(255,70,85,0.12)',
              clipPath: CHUNKY.badge,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: LIVE_RED, animation: 'v3-scores-pulse 2s infinite' }} />
              {t('live')} · {liveCount}
            </span>
          )}
          <span style={{
            fontSize: 10, fontWeight: 700, color: '#9CA3AF',
            padding: '3px 9px',
            background: 'rgba(255,255,255,0.05)',
            clipPath: CHUNKY.badge,
          }}>
            {matchCount}
          </span>
        </div>
      </div>

      {/* ── Match rows ── */}
      <div>
        {matches.map(m => (
          tab === 'yesterday'
            ? <ResultCard key={m.id} match={m} />
            : <MatchRow key={m.id} match={m} />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 7.3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE 'TournamentCard' || echo "clean"`
Expected: `clean`.

- [ ] **Step 7.4: Manual verify**

- Premier Padel tournament → Premier Padel logo on left
- FIP tournament → FIP Tour logo on left
- City, Country reads correctly
- Level pill colour matches tier (P2 green, Gold amber, Silver grey)
- Live count chip appears only when any match is live
- Card has visible outline + drop shadow — feels like a contained unit

- [ ] **Step 7.5: Commit**

```bash
git add src/components/TournamentCard.tsx
git commit -m "$(cat <<'EOF'
refactor(matches): contained TournamentCard with circuit logo + city/level header

Replaces the flat light-text header with a chunky-polygon contained
card. Left: circuit logo (Premier Padel / FIP Tour SVG), falling back
to country flag. Right: "City, Country" + tinted level pill + round
label + (if any matches are live) an inline "Live · N" chip above the
neutral count badge.
EOF
)"
```

---

## Task 8: Build `MatchesDateStrip` component

**Files:**
- Create: `src/components/MatchesDateStrip.tsx`

This replaces `MatchesTabs.tsx`. Renders a horizontal date strip (±14 days) + stacked Filters/Live action column that share the row height.

- [ ] **Step 8.1: Create the component**

Create `src/components/MatchesDateStrip.tsx`:

```tsx
'use client'

import React, { useEffect, useRef } from 'react'
import { useFormatter, useTranslations } from 'next-intl'

const GREEN = '#7ED321'
const GREEN_DIM = 'rgba(126,211,33,0.14)'
const BG = '#0A0A0A'
const BG_ELEV = '#1E1E1E'
const MUTED = '#6B7280'
const MUTED_2 = '#9CA3AF'
const TEXT = '#FFFFFF'
const BORDER = 'rgba(255,255,255,0.06)'
const LIVE_RED = '#FF4655'
const LIVE_STRONG = 'rgba(255,77,95,0.18)'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

const DATE_RANGE = 14

function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime())
  out.setDate(out.getDate() + days)
  return out
}

export interface DateStripDay {
  offset: number
  date: Date
  weekday: string
  dayNum: string
}

export default function MatchesDateStrip({
  dateOffset,
  onDateChange,
  filterCount,
  onFilterClick,
  liveOnly,
  onLiveToggle,
  liveDisabled,
}: {
  dateOffset: number
  onDateChange: (offset: number) => void
  filterCount: number
  onFilterClick: () => void
  liveOnly: boolean
  onLiveToggle: () => void
  liveDisabled: boolean
}) {
  const t = useTranslations('matches')
  const format = useFormatter()

  // Build the ±14 day strip relative to "today"
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days: DateStripDay[] = []
  for (let offset = -DATE_RANGE; offset <= DATE_RANGE; offset++) {
    const date = addDays(today, offset)
    days.push({
      offset,
      date,
      weekday: format.dateTime(date, { weekday: 'short' }),
      dayNum: format.dateTime(date, { day: '2-digit' }),
    })
  }

  // Scroll the active day into the centre on mount + whenever dateOffset changes
  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!stripRef.current) return
    const btn = stripRef.current.querySelector<HTMLButtonElement>(`[data-offset="${dateOffset}"]`)
    if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [dateOffset])

  return (
    <div style={{
      display: 'flex', alignItems: 'stretch',
      padding: '12px 12px 0',
      borderBottom: `1px solid ${BORDER}`,
      gap: 8,
    }}>
      <div style={{
        flex: 1, position: 'relative',
        display: 'flex', alignItems: 'stretch',
        overflow: 'hidden',
      }}>
        {/* Edge fade masks */}
        <div aria-hidden style={{
          position: 'absolute', top: 12, bottom: 18, left: 0, width: 28,
          pointerEvents: 'none', zIndex: 2,
          background: `linear-gradient(to left, transparent, ${BG} 80%)`,
        }} />
        <div aria-hidden style={{
          position: 'absolute', top: 12, bottom: 18, right: 0, width: 28,
          pointerEvents: 'none', zIndex: 2,
          background: `linear-gradient(to right, transparent, ${BG} 80%)`,
        }} />

        <div
          ref={stripRef}
          role="tablist"
          style={{
            display: 'flex', gap: 4,
            overflowX: 'auto', scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch' as any,
            scrollbarWidth: 'none' as any,
            padding: '0 8px',
            flex: 1,
          }}
        >
          <style dangerouslySetInnerHTML={{ __html: '[data-strip]::-webkit-scrollbar { display: none }' }} />
          {days.map(d => {
            const active = d.offset === dateOffset
            const relative =
              d.offset === 0  ? t('today') :
              d.offset === -1 ? t('yesterday') :
              d.offset === 1  ? t('upcomingTab') : ''
            return (
              <button
                key={d.offset}
                data-offset={d.offset}
                role="tab"
                aria-selected={active}
                onClick={() => onDateChange(d.offset)}
                style={{
                  flex: '0 0 auto',
                  width: 54,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 2,
                  padding: '14px 0 18px',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  scrollSnapAlign: 'center',
                  position: 'relative',
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: MUTED }}>
                  {d.weekday}
                </span>
                <span style={{
                  fontSize: 17, fontWeight: active ? 800 : 700,
                  color: active ? TEXT : MUTED,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {d.dayNum}
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 800,
                  color: active ? GREEN : MUTED,
                  opacity: active ? 1 : 0.6,
                  letterSpacing: 0.5, textTransform: 'uppercase',
                  minHeight: 11,
                }}>
                  {relative || '\u00A0'}
                </span>
                {active && (
                  <span aria-hidden style={{
                    position: 'absolute', bottom: -1, left: '18%', right: '18%', height: 2.5,
                    background: GREEN,
                    clipPath: 'polygon(3% 0%, 97% 0%, 100% 100%, 0% 100%)',
                  }} />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Stacked action column */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 6,
        width: 64, padding: '12px 0 18px', flexShrink: 0,
        alignSelf: 'stretch',
      }}>
        <button
          type="button"
          onClick={onFilterClick}
          aria-label={t('filters.title')}
          style={{
            flex: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            background: filterCount > 0 ? GREEN_DIM : BG_ELEV,
            border: `1px solid ${filterCount > 0 ? 'transparent' : BORDER}`,
            color: filterCount > 0 ? GREEN : MUTED_2,
            cursor: 'pointer', padding: '4px 8px',
            clipPath: CHUNKY_BADGE,
            position: 'relative',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="14" y2="12" />
            <line x1="4" y1="18" x2="10" y2="18" />
            <circle cx="17" cy="12" r="2.2" fill="currentColor" stroke="none" />
            <circle cx="13" cy="18" r="2.2" fill="currentColor" stroke="none" />
          </svg>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.3 }}>{t('filters.title')}</span>
          {filterCount > 0 && (
            <span style={{
              position: 'absolute', top: 2, right: 3,
              minWidth: 14, height: 14, padding: '0 3px',
              background: GREEN, color: '#000',
              fontSize: 9, fontWeight: 900,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              clipPath: CHUNKY_BADGE,
              lineHeight: 1,
            }}>{filterCount}</span>
          )}
        </button>

        <button
          type="button"
          onClick={onLiveToggle}
          aria-pressed={liveOnly}
          aria-label={t('liveOnly')}
          disabled={liveDisabled}
          style={{
            flex: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            background: liveOnly ? LIVE_STRONG : BG_ELEV,
            border: liveOnly ? '1px solid transparent' : `1px solid ${BORDER}`,
            color: liveOnly ? LIVE_RED : MUTED_2,
            cursor: liveDisabled ? 'default' : 'pointer', padding: '4px 8px',
            clipPath: CHUNKY_BADGE,
            opacity: liveDisabled ? 0.5 : 1,
            pointerEvents: liveDisabled ? 'none' : 'auto',
          }}
        >
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: liveOnly ? LIVE_RED : MUTED_2,
            animation: liveOnly ? 'v3-scores-pulse 2s infinite' : 'none',
          }} />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.3 }}>{t('live')}</span>
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 8.2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE 'MatchesDateStrip' || echo "clean"`
Expected: `clean`.

- [ ] **Step 8.3: Commit**

```bash
git add src/components/MatchesDateStrip.tsx
git commit -m "$(cat <<'EOF'
feat(matches): MatchesDateStrip with ±14 day strip + Filters/Live stack

Horizontally scrollable date strip (±14 days) with Today auto-centred
and relative labels (Yesterday/Today/Tomorrow) under days -1/0/+1.
Snap scrolling, edge fade masks, hidden scrollbars. Right-side 64px
action column shares the row height via align-self:stretch and
splits evenly between a Filters button (count badge) and a Live
toggle (disabled when no live matches).
EOF
)"
```

---

## Task 9: Rewire `matches/page.tsx` state + data slicing + mount new components

**Files:**
- Modify: `src/app/[locale]/(app)/matches/page.tsx`

- [ ] **Step 9.1: Swap imports**

Near the top of `src/app/[locale]/(app)/matches/page.tsx`, replace:

```tsx
import MatchesTabs from '@/components/MatchesTabs'
import { applyFilters, computeDateWindow, tabForLegacyParam, type Tab as MatchesTab, type Circuit, type Gender } from '@/lib/matches-filters'
```

with:

```tsx
import MatchesDateStrip from '@/components/MatchesDateStrip'
import TournamentCard from '@/components/TournamentCard'
import {
  applyFilters,
  computeDateWindow,
  computeDayWindow,
  parseDateParam,
  remapLegacyTab,
  type Circuit,
  type Gender,
} from '@/lib/matches-filters'
```

Also remove the temporary alias `import TournamentGroup from '@/components/TournamentCard'` added in Task 6 — replace all `TournamentGroup` call sites with `TournamentCard` directly in this step.

- [ ] **Step 9.2: Replace tab state with `dateOffset` + `liveOnly`**

Find the existing state block (introduced in the Apple-tabs Task 5):

```tsx
const [tab, setTab] = useState<MatchesTab>('today')
const TAB_KEYS = useMemo(() => ['yesterday', 'today', 'upcoming'] as const, [])
const { goTo: swipeGoTo, trackStyle, handlers: swipeHandlers, isDragging } = useSwipeTabs({ ... })
```

Replace with:

```tsx
const [dateOffset, setDateOffset] = useState<number>(0)
const [liveOnly, setLiveOnly] = useState<boolean>(false)
```

Delete the `useSwipeTabs` call entirely (horizontal swipe of 3 panels is gone; each day renders a single flat list of tournament cards).

- [ ] **Step 9.3: Replace the legacy query-param effect**

Find the `useEffect` that calls `tabForLegacyParam(searchParams.get('tab'))`. Replace with:

```tsx
useEffect(() => {
  // Accept ?date=YYYY-MM-DD
  const rawDate = searchParams.get('date')
  if (rawDate) {
    const parsed = parseDateParam(rawDate, new Date(), timezone)
    if (parsed !== null) { setDateOffset(parsed); return }
  }
  // Fall back to legacy ?tab=live|upcoming|results
  const rawTab = searchParams.get('tab')
  const remapped = remapLegacyTab(rawTab)
  if (remapped) {
    setDateOffset(remapped.dateOffset)
    setLiveOnly(remapped.liveOnly)
  }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [searchParams])
```

(This effect depends on `timezone` which is declared further down; the exhaustive-deps suppression is fine because `timezone` is memo-stable per render.)

- [ ] **Step 9.4: Unify the day-slice derivation**

Find the existing block that computes `yesterdayMatches`, `todayMatches`, `upcomingMatches`. Replace with:

```tsx
const dayWindow = useMemo(() => computeDayWindow(new Date(), timezone, dateOffset), [timezone, dateOffset])

const dayMatches = useMemo(() => {
  const { dayStart, dayEnd } = dayWindow
  const within = (ts: string | null | undefined) => !!ts && ts >= dayStart && ts < dayEnd

  if (dateOffset === 0) {
    // Today: live ∪ scheduled-today ∪ finished-today
    const seen = new Set<string>()
    const pool = [
      ...liveMatches,
      ...scheduledMatches.filter(m => within(m.scheduled_at) && hasPlayers(m)),
      ...recentMatches.filter(m => within((m as any).finished_at)),
    ]
    return applyFilters(pool.filter(m => seen.has(m.id) ? false : (seen.add(m.id), true)), filters)
  }
  if (dateOffset < 0) {
    return applyFilters(recentMatches.filter(m => within((m as any).finished_at)), filters)
  }
  return applyFilters(scheduledMatches.filter(m => within(m.scheduled_at) && hasPlayers(m)), filters)
}, [dateOffset, dayWindow, liveMatches, scheduledMatches, recentMatches, filters])

const visibleMatches = useMemo(
  () => liveOnly ? dayMatches.filter(m => m.status === 'live') : dayMatches,
  [dayMatches, liveOnly],
)

const dayGrouped = useMemo(() => groupByTournament(visibleMatches), [visibleMatches])

const liveInDay = useMemo(() => dayMatches.filter(m => m.status === 'live').length, [dayMatches])
```

Delete the old `yesterdayMatches`, `todayMatches`, `upcomingMatches`, `upcomingDate`, `yesterdayGrouped`, `todayGrouped`, `upcomingGrouped`, `liveNowCount` blocks — they're replaced by this unified computation.

- [ ] **Step 9.5: Widen the fetch queries**

In the `fetchData` callback, find the `matches:recent` query (currently uses `Date.now() - 48 * 60 * 60 * 1000`) and replace the `.gte(...)` line with:

```ts
.gte('finished_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
```

Also widen `matches:scheduled` — find `.limit(50)` and change to `.limit(200)`.

- [ ] **Step 9.6: Replace the header JSX**

Find `<MatchesTabs ... />` and replace the whole invocation with:

```tsx
<MatchesDateStrip
  dateOffset={dateOffset}
  onDateChange={(next) => {
    setDateOffset(next)
    router.replace(`/matches${next === 0 ? '' : `?date=${isoDateForOffset(new Date(), timezone, next)}`}`, { scroll: false })
  }}
  filterCount={countAppliedFilters(sheetValue)}
  onFilterClick={() => setFilterSheetOpen(true)}
  liveOnly={liveOnly}
  onLiveToggle={() => setLiveOnly(v => !v)}
  liveDisabled={liveInDay === 0}
/>
```

Add this helper near the other module-scope helpers at the top of the file:

```tsx
function isoDateForOffset(now: Date, tz: string, offset: number): string {
  const w = computeDayWindow(now, tz, offset)
  return w.dayStart.slice(0, 10)   // YYYY-MM-DD
}
```

- [ ] **Step 9.7: Replace the swipe viewport JSX**

Find the block that renders the 3 `<TabPanel>` elements inside the swipe track. Replace the entire swipe-viewport markup (the outer `<div {...swipeHandlers}>` and the three `<TabPanel>`s) with a single-day render:

```tsx
<>
  {liveInDay > 0 && dateOffset === 0 && !liveOnly && (
    <LiveNowStrip count={liveInDay} />
  )}
  {dayGrouped.length === 0
    ? <EmptyState tab={dateOffset < 0 ? 'results' : dateOffset === 0 ? 'live' : 'upcoming'} leagueFilter="all" />
    : dayGrouped.map(g => (
        <TournamentCard
          key={g.tournament?.id ?? 'u'}
          tournament={g.tournament}
          matches={g.matches}
          tab={dateOffset < 0 ? 'yesterday' : dateOffset === 0 ? 'today' : 'upcoming'}
        />
      ))}
</>
```

Keep the `<AppliedFiltersStrip>` render above this block unchanged.

- [ ] **Step 9.8: Update the 30 s auto-refresh gate**

Find `useEffect(() => { if (tab !== 'today') return ...`. Replace `tab !== 'today'` with `dateOffset !== 0`:

```tsx
useEffect(() => {
  if (dateOffset !== 0) return
  const interval = setInterval(() => fetchData(true), 30000)
  return () => clearInterval(interval)
}, [dateOffset, fetchData])
```

- [ ] **Step 9.9: Drop unused inline helpers**

Delete the inline `TabPanel` function defined at module scope — nothing renders it after Step 9.7.

The inline `LiveNowStrip` remains used by the Today-only render in Step 9.7. Keep it.

- [ ] **Step 9.10: Type-check + lint**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE 'matches/page' || echo "clean"`
Expected: `clean`.

Run: `npx eslint 'src/app/[locale]/(app)/matches/page.tsx' 2>&1 | head -30`
Fix any NEW errors referencing undefined variables. Pre-existing project lint issues can stay.

- [ ] **Step 9.11: Commit**

```bash
git add 'src/app/[locale]/(app)/matches/page.tsx'
git commit -m "$(cat <<'EOF'
refactor(matches): swap tab state for dateOffset + liveOnly; unified day slice

- dateOffset: number replaces the 3-value tab enum
- liveOnly: boolean added for the new Live toggle
- Single unified dayMatches derivation covers past/today/future with
  one predicate; today includes finished-today (was missing before)
- Fetch windows widened: scheduled .limit(50)->(200), recent 48h->14d
- Mounts MatchesDateStrip + TournamentCard; drops TabPanel + old
  per-bucket groupings
- Legacy ?tab=live|upcoming|results remapped via remapLegacyTab;
  new ?date=YYYY-MM-DD parsed via parseDateParam
EOF
)"
```

---

## Task 10: Delete `MatchesTabs.tsx`

**Files:**
- Delete: `src/components/MatchesTabs.tsx`

- [ ] **Step 10.1: Verify nothing imports `MatchesTabs`**

Run: `grep -rn "MatchesTabs" src/ 2>&1 | head`
Expected: no matches (the only usages were in `matches/page.tsx`, replaced in Task 9).

If any import remains, fix it by switching to `MatchesDateStrip`.

- [ ] **Step 10.2: Delete the file**

Run: `rm src/components/MatchesTabs.tsx`

- [ ] **Step 10.3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE 'MatchesTabs' || echo "clean"`
Expected: `clean`.

- [ ] **Step 10.4: Commit**

```bash
git add -A src/components/
git commit -m "chore(matches): remove MatchesTabs.tsx (replaced by MatchesDateStrip)"
```

---

## Task 11: Manual preview verification

**Files:** none (verification only)

- [ ] **Step 11.1: Start the dev server**

Use `preview_start` with the `Next.js (frontend)` launch config. Navigate to `/matches`.

- [ ] **Step 11.2: Default load**

- Today is centred + green in the date strip
- Strip shows days from `-14` to `+14`; scroll left/right, snap works
- Match rows render as 2 rows (one pair each)
- Tournament cards have Premier Padel or FIP Tour logo on the left
- Live matches: stacked `2nd set` label, 1-px vertical divider between sets and points, live points in red

- [ ] **Step 11.3: Date navigation**

- Tap day -7 → matches (or empty state) for that day load
- Tap day +3 → scheduled matches for that day load
- URL updates to `/matches?date=2026-04-12` style; reload preserves state
- `?date=2026-05-15` (out of range) ignored, defaults to Today

- [ ] **Step 11.4: Live toggle**

- On Today with live matches: tap Live → list narrows to live-only; tap again → list restores
- On a day with zero live matches (e.g., +7): Live button is disabled (0.5 opacity, no pointer events)

- [ ] **Step 11.5: Bookmark + notify**

- Tap bell on a scheduled match row → bell turns green
- Reload → still green (localStorage persisted)
- Tap again → bell turns grey

- [ ] **Step 11.6: Filter sheet**

- Tap Filters → sheet opens (unchanged from Apple-tabs)
- Select circuit → chip strip below header renders the chip; filter count badge appears on Filters button
- Chip × removes the filter

- [ ] **Step 11.7: Legacy deep-links**

- `/matches?tab=live`    → Today + Live toggle ON
- `/matches?tab=upcoming` → Tomorrow
- `/matches?tab=results` → Yesterday

- [ ] **Step 11.8: Locale switch**

- Switch to `es`: day strip weekdays localise; `Hoy` relative label; filter sheet labels; bell aria-label.

- [ ] **Step 11.9: Screenshots for the PR**

Screenshots at key states: default Today, Live toggle on, upcoming day with bookmarks, filter sheet open, finished day. Attach to the PR description.
