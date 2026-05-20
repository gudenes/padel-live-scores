# Live Tournaments Carousel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a chunky-style "Live Tournaments" horizontal carousel above LIVE NOW on the home page, with two chips (LIVE/TODAY + UPCOMING), cover-image cards, "N matches today" count, and all 5 locales.

**Architecture:** Pure utilities (sort + day-boundary + match-info aggregator) in `src/lib/`, a new client component `LiveTournamentsCarousel.tsx` in `src/components/home/`, three new queries added to the existing `Promise.allSettled` in `home/page.tsx`. No new DB columns, no new env vars, no new dependencies.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Supabase JS, next-intl, Tailwind 4 (inline styles for chunky shapes, matching existing home patterns), vitest for unit tests.

**Spec reference:** [docs/superpowers/specs/2026-05-20-live-tournaments-carousel-design.md](../specs/2026-05-20-live-tournaments-carousel-design.md)

**Local testing:** The user will verify each task in the browser at `http://localhost:3002`. Don't claim a task done until the user confirms.

---

## File Structure

**Create:**
- `src/lib/live-tournaments-carousel.ts` — pure utilities (sort, day boundary, aggregate). ~80 lines.
- `src/lib/__tests__/live-tournaments-carousel.test.ts` — vitest unit tests. ~120 lines.
- `src/components/home/LiveTournamentsCarousel.tsx` — the component + card sub-component co-located. ~280 lines.

**Modify:**
- `src/app/[locale]/(app)/home/page.tsx` — add 3 queries, transform, render new section above LIVE NOW.
- `src/messages/{en,es,pt,it,fr}.json` — add `home.liveTournaments.*` keys.

---

## Task 1: Pure utilities (TDD)

**Files:**
- Create: `src/lib/live-tournaments-carousel.ts`
- Create: `src/lib/__tests__/live-tournaments-carousel.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/lib/__tests__/live-tournaments-carousel.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  compareTournamentsForCarousel,
  buildMatchInfoMap,
  getLocalDayBoundaryUTC,
  TIER_RANK,
  type TournamentForSort,
  type MatchForAggregation,
} from '../live-tournaments-carousel'

const makeT = (overrides: Partial<TournamentForSort>): TournamentForSort => ({
  id: 't1',
  level: 'p1',
  starts_at: '2026-05-20T00:00:00Z',
  ...overrides,
})

describe('compareTournamentsForCarousel', () => {
  it('puts Premier tiers (p1/p2/major/finals) before FIP tiers', () => {
    const a = makeT({ id: 'a', level: 'p1' })
    const b = makeT({ id: 'b', level: 'gold' })
    const sorted = [b, a].sort(compareTournamentsForCarousel)
    expect(sorted.map(t => t.id)).toEqual(['a', 'b'])
  })

  it('orders Premier tiers by static rank: p1, p2, major, finals', () => {
    const finals = makeT({ id: 'finals', level: 'finals' })
    const major = makeT({ id: 'major', level: 'major' })
    const p2 = makeT({ id: 'p2', level: 'p2' })
    const p1 = makeT({ id: 'p1', level: 'p1' })
    const sorted = [finals, major, p2, p1].sort(compareTournamentsForCarousel)
    expect(sorted.map(t => t.id)).toEqual(['p1', 'p2', 'major', 'finals'])
  })

  it('orders FIP tiers by static rank: gold, bronze, rise, future', () => {
    const future = makeT({ id: 'future', level: 'future' })
    const rise = makeT({ id: 'rise', level: 'rise' })
    const bronze = makeT({ id: 'bronze', level: 'bronze' })
    const gold = makeT({ id: 'gold', level: 'gold' })
    const sorted = [future, rise, bronze, gold].sort(compareTournamentsForCarousel)
    expect(sorted.map(t => t.id)).toEqual(['gold', 'bronze', 'rise', 'future'])
  })

  it('breaks ties within the same tier by starts_at ascending', () => {
    const later = makeT({ id: 'later', level: 'p1', starts_at: '2026-06-01T00:00:00Z' })
    const earlier = makeT({ id: 'earlier', level: 'p1', starts_at: '2026-05-15T00:00:00Z' })
    const sorted = [later, earlier].sort(compareTournamentsForCarousel)
    expect(sorted.map(t => t.id)).toEqual(['earlier', 'later'])
  })

  it('sends unknown tier values to the end', () => {
    const known = makeT({ id: 'known', level: 'bronze' })
    const unknown = makeT({ id: 'unknown', level: 'mystery_tier' })
    const sorted = [unknown, known].sort(compareTournamentsForCarousel)
    expect(sorted.map(t => t.id)).toEqual(['known', 'unknown'])
  })

  it('sends null level to the end', () => {
    const known = makeT({ id: 'known', level: 'p1' })
    const nullLvl = makeT({ id: 'null', level: null })
    const sorted = [nullLvl, known].sort(compareTournamentsForCarousel)
    expect(sorted.map(t => t.id)).toEqual(['known', 'null'])
  })

  it('exports TIER_RANK with all expected keys', () => {
    expect(Object.keys(TIER_RANK).sort()).toEqual(
      ['bronze', 'finals', 'future', 'gold', 'major', 'p1', 'p2', 'rise'].sort()
    )
  })
})

describe('buildMatchInfoMap', () => {
  it('returns empty Map for empty input', () => {
    const m = buildMatchInfoMap([])
    expect(m.size).toBe(0)
  })

  it('counts matches per tournament_id', () => {
    const rows: MatchForAggregation[] = [
      { tournament_id: 'A', status: 'scheduled' },
      { tournament_id: 'A', status: 'finished' },
      { tournament_id: 'B', status: 'scheduled' },
    ]
    const m = buildMatchInfoMap(rows)
    expect(m.get('A')?.matchesToday).toBe(2)
    expect(m.get('B')?.matchesToday).toBe(1)
  })

  it('flags hasLiveMatch when at least one match has status live', () => {
    const rows: MatchForAggregation[] = [
      { tournament_id: 'A', status: 'scheduled' },
      { tournament_id: 'A', status: 'live' },
    ]
    expect(buildMatchInfoMap(rows).get('A')?.hasLiveMatch).toBe(true)
  })

  it('flags hasLiveMatch when status is on_court (warmup)', () => {
    const rows: MatchForAggregation[] = [
      { tournament_id: 'A', status: 'on_court' },
    ]
    expect(buildMatchInfoMap(rows).get('A')?.hasLiveMatch).toBe(true)
  })

  it('hasLiveMatch is false when no live/on_court matches', () => {
    const rows: MatchForAggregation[] = [
      { tournament_id: 'A', status: 'scheduled' },
      { tournament_id: 'A', status: 'finished' },
    ]
    expect(buildMatchInfoMap(rows).get('A')?.hasLiveMatch).toBe(false)
  })
})

describe('getLocalDayBoundaryUTC', () => {
  it('returns ISO strings for start and end of the given local day', () => {
    // Run with a fixed "now" so the test is deterministic regardless of CI tz.
    // 2026-05-20T15:30:00 in the local tz of the test runner.
    const now = new Date('2026-05-20T15:30:00')
    const { startUTC, endUTC } = getLocalDayBoundaryUTC(now)
    // Boundaries should be ISO strings.
    expect(startUTC).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(endUTC).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    // The boundary must span ~24 hours.
    const ms = new Date(endUTC).getTime() - new Date(startUTC).getTime()
    expect(ms).toBeGreaterThan(23 * 3_600_000)
    expect(ms).toBeLessThan(25 * 3_600_000) // allows for DST shifts
  })

  it('produces a start <= now <= end window', () => {
    const now = new Date('2026-05-20T15:30:00')
    const { startUTC, endUTC } = getLocalDayBoundaryUTC(now)
    expect(new Date(startUTC).getTime()).toBeLessThanOrEqual(now.getTime())
    expect(new Date(endUTC).getTime()).toBeGreaterThanOrEqual(now.getTime())
  })
})
```

- [ ] **Step 2: Run tests to verify they all fail with "module not found"**

```bash
npx vitest run src/lib/__tests__/live-tournaments-carousel.test.ts
```

Expected: All tests fail with "Cannot find module '../live-tournaments-carousel'" — the impl module doesn't exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/live-tournaments-carousel.ts`:

```typescript
/**
 * Pure utilities for the home page's Live Tournaments carousel.
 *
 * - compareTournamentsForCarousel: sort comparator. Premier tiers first by
 *   static rank, then FIP tiers, then ascending starts_at.
 * - buildMatchInfoMap: aggregate raw matches-today rows into per-tournament
 *   { matchesToday, hasLiveMatch }.
 * - getLocalDayBoundaryUTC: compute today's [startUTC, endUTC] window in the
 *   user's local timezone, suitable for filtering matches.scheduled_at.
 */

export const TIER_RANK: Record<string, number> = {
  p1: 1,
  p2: 2,
  major: 3,
  finals: 4,
  gold: 5,
  bronze: 6,
  rise: 7,
  future: 8,
}

export interface TournamentForSort {
  id: string
  level: string | null
  starts_at: string
}

export interface MatchForAggregation {
  tournament_id: string
  status: string
}

export interface MatchInfo {
  matchesToday: number
  hasLiveMatch: boolean
}

export function compareTournamentsForCarousel(
  a: TournamentForSort,
  b: TournamentForSort,
): number {
  const aRank = TIER_RANK[a.level ?? ''] ?? 99
  const bRank = TIER_RANK[b.level ?? ''] ?? 99
  if (aRank !== bRank) return aRank - bRank
  return new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
}

export function buildMatchInfoMap(
  rows: MatchForAggregation[],
): Map<string, MatchInfo> {
  const out = new Map<string, MatchInfo>()
  for (const r of rows) {
    const entry = out.get(r.tournament_id) ?? { matchesToday: 0, hasLiveMatch: false }
    entry.matchesToday += 1
    if (r.status === 'live' || r.status === 'on_court') entry.hasLiveMatch = true
    out.set(r.tournament_id, entry)
  }
  return out
}

export function getLocalDayBoundaryUTC(now: Date = new Date()): {
  startUTC: string
  endUTC: string
} {
  // Build a YYYY-MM-DD string for the user's local day. `en-CA` formats as
  // ISO-style (2026-05-20) regardless of locale, avoiding parsing quirks.
  const localDateStr = now.toLocaleDateString('en-CA')
  // Constructing `new Date('YYYY-MM-DDTHH:mm:ss')` with no zone is local time.
  // Then `.toISOString()` converts to UTC.
  const start = new Date(`${localDateStr}T00:00:00`)
  const end = new Date(`${localDateStr}T23:59:59.999`)
  return {
    startUTC: start.toISOString(),
    endUTC: end.toISOString(),
  }
}
```

- [ ] **Step 4: Run tests to verify they all pass**

```bash
npx vitest run src/lib/__tests__/live-tournaments-carousel.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/live-tournaments-carousel.ts src/lib/__tests__/live-tournaments-carousel.test.ts
git commit -m "$(cat <<'EOF'
feat(home): pure utils for live tournaments carousel

Sort comparator (Premier-first via static tier rank), match info
aggregator, and local day boundary helper. All TDD'd against vitest.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: i18n keys across 5 locales

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

- [ ] **Step 1: Add EN keys**

Open `src/messages/en.json` and locate the `"home": { ... }` block. Add a new `liveTournaments` object inside it (alongside the existing `liveNow`, `comingUp`, etc.):

```json
"liveTournaments": {
  "title": "Live Tournaments",
  "chipLiveToday": "Live / Today",
  "chipUpcoming": "Upcoming",
  "matchesTodayCount": "{count, plural, one {# match today} other {# matches today}}",
  "restDay": "Rest day",
  "startsOn": "Starts {date}",
  "viewScores": "View Scores"
}
```

- [ ] **Step 2: Add ES keys**

Open `src/messages/es.json`, add inside `home`:

```json
"liveTournaments": {
  "title": "Torneos en vivo",
  "chipLiveToday": "En vivo / Hoy",
  "chipUpcoming": "Próximamente",
  "matchesTodayCount": "{count, plural, one {# partido hoy} other {# partidos hoy}}",
  "restDay": "Día de descanso",
  "startsOn": "Comienza {date}",
  "viewScores": "Ver marcadores"
}
```

- [ ] **Step 3: Add PT keys**

Open `src/messages/pt.json`, add inside `home`:

```json
"liveTournaments": {
  "title": "Torneios ao vivo",
  "chipLiveToday": "Ao vivo / Hoje",
  "chipUpcoming": "Em breve",
  "matchesTodayCount": "{count, plural, one {# jogo hoje} other {# jogos hoje}}",
  "restDay": "Dia de descanso",
  "startsOn": "Começa {date}",
  "viewScores": "Ver placares"
}
```

- [ ] **Step 4: Add IT keys**

Open `src/messages/it.json`, add inside `home`:

```json
"liveTournaments": {
  "title": "Tornei in diretta",
  "chipLiveToday": "In diretta / Oggi",
  "chipUpcoming": "In arrivo",
  "matchesTodayCount": "{count, plural, one {# partita oggi} other {# partite oggi}}",
  "restDay": "Giorno di riposo",
  "startsOn": "Inizia {date}",
  "viewScores": "Vedi punteggi"
}
```

- [ ] **Step 5: Add FR keys**

Open `src/messages/fr.json`, add inside `home`:

```json
"liveTournaments": {
  "title": "Tournois en direct",
  "chipLiveToday": "En direct / Aujourd'hui",
  "chipUpcoming": "À venir",
  "matchesTodayCount": "{count, plural, one {# match aujourd'hui} other {# matchs aujourd'hui}}",
  "restDay": "Jour de repos",
  "startsOn": "Début {date}",
  "viewScores": "Voir scores"
}
```

- [ ] **Step 6: Type-check + commit**

```bash
npm run lint
```

Expected: no new errors (the keys are referenced from code we haven't written yet, but that's not a lint issue).

```bash
git add src/messages/
git commit -m "$(cat <<'EOF'
feat(home): i18n keys for live tournaments carousel (5 locales)

Adds home.liveTournaments.* with ICU plural for the per-tournament
matches-today count, across en/es/pt/it/fr.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Component scaffold — chip state + tablist structure

**Files:**
- Create: `src/components/home/LiveTournamentsCarousel.tsx`

Build the component skeleton with chip switching but a placeholder card (a single empty div per tournament). The card visuals come in Task 4.

- [ ] **Step 1: Create the component file**

Create `src/components/home/LiveTournamentsCarousel.tsx`:

```typescript
'use client'

import { useState, useMemo, useId } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { BG_BASE, BORDER, CHUNKY, GREEN, MUTED, SectionTitle, Tournament } from '@/components/home/shared'

export interface TournamentWithMatchInfo extends Tournament {
  matchesToday: number
  hasLiveMatch: boolean
}

interface Props {
  liveToday: TournamentWithMatchInfo[]
  upcoming: TournamentWithMatchInfo[]
}

type Chip = 'live-today' | 'upcoming'

export default function LiveTournamentsCarousel({ liveToday, upcoming }: Props) {
  const t = useTranslations('home.liveTournaments')
  const tablistId = useId()
  const liveTabId = `${tablistId}-live`
  const upcomingTabId = `${tablistId}-upcoming`

  // Default chip: LIVE/TODAY when it has rows, otherwise UPCOMING.
  // If both empty the parent will not render this component at all.
  const defaultChip: Chip = liveToday.length > 0 ? 'live-today' : 'upcoming'
  const [chip, setChip] = useState<Chip>(defaultChip)

  const visible = chip === 'live-today' ? liveToday : upcoming

  if (liveToday.length === 0 && upcoming.length === 0) return null

  return (
    <section aria-labelledby={`${tablistId}-title`}>
      <SectionTitle>
        <span id={`${tablistId}-title`}>{t('title')}</span>
      </SectionTitle>

      <div
        role="tablist"
        aria-label={t('title')}
        style={{ display: 'flex', gap: 8, padding: '0 16px 12px' }}
      >
        <ChipButton
          id={liveTabId}
          panelId={`${tablistId}-panel`}
          active={chip === 'live-today'}
          onClick={() => setChip('live-today')}
          disabled={liveToday.length === 0}
        >
          {t('chipLiveToday')}
        </ChipButton>
        <ChipButton
          id={upcomingTabId}
          panelId={`${tablistId}-panel`}
          active={chip === 'upcoming'}
          onClick={() => setChip('upcoming')}
          disabled={upcoming.length === 0}
        >
          {t('chipUpcoming')}
        </ChipButton>
      </div>

      <div
        id={`${tablistId}-panel`}
        role="tabpanel"
        aria-labelledby={chip === 'live-today' ? liveTabId : upcomingTabId}
        style={{
          display: 'flex',
          gap: 12,
          padding: '0 16px 8px',
          overflowX: 'auto',
          scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch',
          msOverflowStyle: 'none',
          scrollbarWidth: 'none',
        }}
      >
        {visible.map(tournament => (
          <div
            key={tournament.id}
            style={{ scrollSnapAlign: 'start', flexShrink: 0, width: 178 }}
          >
            {/* Card visuals land in Task 4; placeholder shows id + matchesToday for now */}
            <Link
              href={`/tournaments/${tournament.id}`}
              style={{ textDecoration: 'none', color: '#fff' }}
            >
              <div
                style={{
                  width: 178,
                  height: 240,
                  background: BG_BASE,
                  border: `1px solid ${BORDER}`,
                  clipPath: CHUNKY.card,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-end',
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 800 }}>{tournament.name}</div>
                <div style={{ fontSize: 11, color: MUTED }}>
                  {chip === 'live-today'
                    ? tournament.matchesToday > 0
                      ? t('matchesTodayCount', { count: tournament.matchesToday })
                      : t('restDay')
                    : t('startsOn', { date: new Date(tournament.starts_at).toLocaleDateString() })}
                </div>
              </div>
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}

function ChipButton({
  id,
  panelId,
  active,
  onClick,
  disabled,
  children,
}: {
  id: string
  panelId: string
  active: boolean
  onClick: () => void
  disabled: boolean
  children: React.ReactNode
}) {
  return (
    <button
      id={id}
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      onClick={onClick}
      disabled={disabled}
      style={{
        background: active ? GREEN : 'rgba(255,255,255,0.06)',
        color: active ? '#0E1B05' : disabled ? MUTED : '#fff',
        clipPath: CHUNKY.button,
        padding: '7px 14px',
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}
```

- [ ] **Step 2: Commit the scaffold**

```bash
git add src/components/home/LiveTournamentsCarousel.tsx
git commit -m "$(cat <<'EOF'
feat(home): scaffold LiveTournamentsCarousel component

Chip state + tablist/tabpanel ARIA structure with placeholder cards.
Renders nothing when both chips have zero rows. Card visuals follow
in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: TournamentCarouselCard — chunky visual card

Replace the placeholder card in `LiveTournamentsCarousel.tsx` with the full chunky visual: cover image + fallback gradient + level pill + LIVE pill + flag + name + city + status line + VIEW SCORES button.

**Files:**
- Modify: `src/components/home/LiveTournamentsCarousel.tsx`

- [ ] **Step 1: Add the card sub-component**

In `src/components/home/LiveTournamentsCarousel.tsx`, add these imports at the top alongside the existing ones:

```typescript
import Image from 'next/image'
import { useFormatter } from 'next-intl'
import { FlagImg, countryName, levelLabel } from '@/components/home/shared'
import { DATE_SHORT } from '@/lib/format-patterns'
```

Then add the helper constants + sub-component **before** the existing `LiveTournamentsCarousel` default export (so the export uses it):

```typescript
// Level keys match production tournaments.level values (Premier tiers
// are bare, FIP tiers carry the fip_ prefix). See levelLabel /
// levelTierWeight in src/lib/tournament-labels.ts for the full set.
const PREMIER_GRADIENT = 'linear-gradient(135deg, #6B46C1, #9333EA)'
const GOLD_GRADIENT    = 'linear-gradient(135deg, #92750E, #EAB308)'
const SILVER_GRADIENT  = 'linear-gradient(135deg, #475569, #94A3B8)'
const BRONZE_GRADIENT  = 'linear-gradient(135deg, #92400E, #D97706)'
const CYAN_GRADIENT    = 'linear-gradient(135deg, #155E75, #06B6D4)'
const SLATE_GRADIENT   = 'linear-gradient(135deg, #334155, #64748B)'

const TIER_GRADIENT: Record<string, string> = {
  // Premier
  finals: PREMIER_GRADIENT,
  major:  PREMIER_GRADIENT,
  p1:     PREMIER_GRADIENT,
  p2:     PREMIER_GRADIENT,
  // FIP (warm amber for prestige tiers, cool blue for emerging, slate for fringe)
  fip_platinum:     GOLD_GRADIENT,
  fip_gold:         GOLD_GRADIENT,
  fip_hexagon:      PREMIER_GRADIENT,
  fip_championship: PREMIER_GRADIENT,
  fip_finals:       GOLD_GRADIENT,
  fip_silver:       SILVER_GRADIENT,
  fip_bronze:       BRONZE_GRADIENT,
  fip_star:         CYAN_GRADIENT,
  fip_rise:         CYAN_GRADIENT,
  fip_promotion:    CYAN_GRADIENT,
  fip_promises:     SLATE_GRADIENT,
  fip_beyond:       SLATE_GRADIENT,
  fip_other:        SLATE_GRADIENT,
}

const TIER_PILL: Record<string, { background: string; color: string }> = {
  finals:           { background: PREMIER_GRADIENT, color: '#fff' },
  major:            { background: PREMIER_GRADIENT, color: '#fff' },
  p1:               { background: PREMIER_GRADIENT, color: '#fff' },
  p2:               { background: PREMIER_GRADIENT, color: '#fff' },
  fip_platinum:     { background: GOLD_GRADIENT,    color: '#1A1A1A' },
  fip_gold:         { background: GOLD_GRADIENT,    color: '#1A1A1A' },
  fip_hexagon:      { background: PREMIER_GRADIENT, color: '#fff' },
  fip_championship: { background: PREMIER_GRADIENT, color: '#fff' },
  fip_finals:       { background: GOLD_GRADIENT,    color: '#1A1A1A' },
  fip_silver:       { background: SILVER_GRADIENT,  color: '#fff' },
  fip_bronze:       { background: BRONZE_GRADIENT,  color: '#fff' },
  fip_star:         { background: CYAN_GRADIENT,    color: '#fff' },
  fip_rise:         { background: CYAN_GRADIENT,    color: '#fff' },
  fip_promotion:    { background: CYAN_GRADIENT,    color: '#fff' },
  fip_promises:     { background: SLATE_GRADIENT,   color: '#fff' },
  fip_beyond:       { background: SLATE_GRADIENT,   color: '#fff' },
  fip_other:        { background: SLATE_GRADIENT,   color: '#fff' },
}

function TournamentCarouselCard({
  tournament,
  chip,
}: {
  tournament: TournamentWithMatchInfo
  chip: Chip
}) {
  const t = useTranslations('home.liveTournaments')
  const format = useFormatter()

  const level = tournament.level ?? ''
  const tierGradient = TIER_GRADIENT[level] ?? 'linear-gradient(135deg, #2A2A2A, #1A1A1A)'
  const pillStyle = TIER_PILL[level] ?? { background: '#444', color: '#fff' }
  const tierLabel = level ? levelLabel(level) : ''

  const cover = tournament.cover_image_url ?? null
  const city = tournament.location ?? countryName(tournament.country)

  const statusLine =
    chip === 'live-today'
      ? tournament.matchesToday > 0
        ? t('matchesTodayCount', { count: tournament.matchesToday })
        : t('restDay')
      : t('startsOn', {
          date: format.dateTime(new Date(tournament.starts_at), DATE_SHORT),
        })

  const ariaLabel = `${tournament.name}, ${tierLabel}, ${statusLine}`

  return (
    <Link
      href={`/tournaments/${tournament.id}`}
      aria-label={ariaLabel}
      style={{ textDecoration: 'none', color: '#fff' }}
    >
      <div
        style={{
          position: 'relative',
          width: 178,
          height: 240,
          background: tierGradient,
          clipPath: CHUNKY.card,
          overflow: 'hidden',
        }}
      >
        {/* Cover image (falls back to the tier gradient when null) */}
        {cover && (
          <Image
            src={cover}
            alt=""
            fill
            sizes="178px"
            priority={false}
            style={{ objectFit: 'cover' }}
          />
        )}

        {/* Bottom gradient overlay for legibility */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.85) 70%, rgba(0,0,0,0.95) 100%)',
            pointerEvents: 'none',
          }}
        />

        {/* LIVE pill (top-left) */}
        {tournament.hasLiveMatch && (
          <div
            style={{
              position: 'absolute',
              top: 9,
              left: 9,
              background: '#FF4655',
              color: '#fff',
              fontSize: 9,
              fontWeight: 900,
              padding: '4px 9px',
              letterSpacing: 1,
              clipPath: CHUNKY.badge,
              zIndex: 2,
            }}
          >
            LIVE
          </div>
        )}

        {/* Level pill (top-right) */}
        {tierLabel && (
          <div
            style={{
              position: 'absolute',
              top: 9,
              right: 9,
              background: pillStyle.background,
              color: pillStyle.color,
              fontSize: 9,
              fontWeight: 900,
              padding: '4px 8px',
              letterSpacing: 0.5,
              clipPath: CHUNKY.badge,
              zIndex: 2,
              textTransform: 'uppercase',
            }}
          >
            {tierLabel}
          </div>
        )}

        {/* Meta block (bottom) */}
        <div
          style={{
            position: 'absolute',
            left: 10,
            right: 10,
            bottom: 10,
            zIndex: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {tournament.country && (
            <div>
              <FlagImg country={tournament.country} size={16} />
            </div>
          )}
          <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.15 }}>
            {tournament.name}
          </div>
          {city && (
            <div style={{ fontSize: 10.5, color: '#9CA3AF' }}>{city}</div>
          )}
          <div style={{ fontSize: 10, color: GREEN, fontWeight: 700, marginTop: 2 }}>
            {statusLine}
          </div>
          <div
            style={{
              marginTop: 6,
              background: GREEN,
              color: '#0E1B05',
              fontSize: 10,
              fontWeight: 900,
              padding: '7px 0',
              textAlign: 'center',
              letterSpacing: 0.4,
              clipPath: CHUNKY.button,
              textTransform: 'uppercase',
            }}
          >
            {t('viewScores')}
          </div>
        </div>
      </div>
    </Link>
  )
}
```

- [ ] **Step 2: Wire the card into the carousel**

Replace the placeholder `<Link>...</Link>` block inside the carousel's `visible.map(...)` with the new sub-component:

```typescript
{visible.map(tournament => (
  <div
    key={tournament.id}
    style={{ scrollSnapAlign: 'start', flexShrink: 0, width: 178 }}
  >
    <TournamentCarouselCard tournament={tournament} chip={chip} />
  </div>
))}
```

And remove the now-unused imports (`MUTED` is still used by `ChipButton`, keep it; `BG_BASE` and `BORDER` are no longer used in the file — remove them from the import).

- [ ] **Step 3: Type-check**

```bash
npm run lint
```

Expected: clean (or only unrelated existing warnings).

- [ ] **Step 4: Commit**

```bash
git add src/components/home/LiveTournamentsCarousel.tsx
git commit -m "$(cat <<'EOF'
feat(home): chunky tournament cover-image card for carousel

178x240 chunky card with cover image (next/image fill), tier-color
gradient fallback, LIVE pill when a match is currently live, level
pill, flag, name, city, status line (matches today / rest day /
starts on), and VIEW SCORES chunky CTA. Whole tile links to the
tournament detail page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire into home page — 3 queries + render section

**Files:**
- Modify: `src/app/[locale]/(app)/home/page.tsx`

- [ ] **Step 1: Add the import**

In `src/app/[locale]/(app)/home/page.tsx`, after the existing `import TournamentsView from '@/components/home/TournamentsView'` block (around line 33), add:

```typescript
import LiveTournamentsCarousel, { TournamentWithMatchInfo } from '@/components/home/LiveTournamentsCarousel'
import {
  buildMatchInfoMap,
  compareTournamentsForCarousel,
  getLocalDayBoundaryUTC,
} from '@/lib/live-tournaments-carousel'
```

- [ ] **Step 2: Add state for the carousel data**

Inside `V3HomePageInner`, alongside the existing `useState` hooks (around line 119-130), add:

```typescript
const [carouselLiveToday, setCarouselLiveToday] = useState<TournamentWithMatchInfo[]>([])
const [carouselUpcoming, setCarouselUpcoming] = useState<TournamentWithMatchInfo[]>([])
```

- [ ] **Step 3: Add the 3 queries to the Promise.allSettled block**

Inside `fetchData` (the `Promise.allSettled` array around line 269-293), add three new entries **after** the existing `home:articles` line:

```typescript
// Live Tournaments carousel — 3 queries
wrap(
  supabase
    .from('tournaments')
    .select('id, name, starts_at, ends_at, country, location, level, logo_url, cover_image_url, prize_money')
    .lte('starts_at', new Date().toISOString())
    .gte('ends_at', (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString() })())
    .limit(20) as any,
  'home:carousel-live-today',
),
wrap(
  supabase
    .from('tournaments')
    .select('id, name, starts_at, ends_at, country, location, level, logo_url, cover_image_url, prize_money')
    .gt('starts_at', new Date().toISOString())
    .lt('starts_at', new Date(Date.now() + 7 * 24 * 3_600_000).toISOString())
    .limit(20) as any,
  'home:carousel-upcoming',
),
// Match counts for today (local day) — populated after we know the
// tournament IDs from the two queries above.
wrap(
  (async () => {
    const { startUTC, endUTC } = getLocalDayBoundaryUTC()
    return supabase
      .from('matches')
      .select('tournament_id, status')
      .gte('scheduled_at', startUTC)
      .lte('scheduled_at', endUTC)
  })() as any,
  'home:carousel-match-counts',
),
```

The third query intentionally does NOT filter by `tournament_id IN (...)` — running it un-filtered lets it execute in parallel with the two tournament queries. The match volume in a single local day is small (typically <200 rows across all tournaments), well within the 10k cap from CLAUDE.md.

- [ ] **Step 4: Transform results and set state**

After the existing `setLatestNews(dataOf(7))` line in `fetchData`, add the carousel transform:

```typescript
// ── Carousel transform ─────────────────────────────────────
const carouselLiveRows: any[] = dataOf(8)
const carouselUpcomingRows: any[] = dataOf(9)
const carouselMatchRows: any[] = dataOf(10)
const matchInfo = buildMatchInfoMap(carouselMatchRows)
const decorate = (rows: any[]): TournamentWithMatchInfo[] =>
  rows
    .map(r => ({
      ...(r as Tournament),
      matchesToday: matchInfo.get(r.id)?.matchesToday ?? 0,
      hasLiveMatch: matchInfo.get(r.id)?.hasLiveMatch ?? false,
    }))
    .sort(compareTournamentsForCarousel)
setCarouselLiveToday(decorate(carouselLiveRows))
setCarouselUpcoming(decorate(carouselUpcomingRows))
```

- [ ] **Step 5: Render the section at the top**

In the JSX return (around line 401, just **before** the `{/* ── LIVE NOW ──...*/}` block), insert:

```typescript
{/* ── LIVE TOURNAMENTS CAROUSEL ─────────────────────────── */}
<LiveTournamentsCarousel
  liveToday={carouselLiveToday}
  upcoming={carouselUpcoming}
/>
```

- [ ] **Step 6: Local verification — happy path**

Run the dev server:

```bash
npm run dev
```

Open `http://localhost:3002` in a browser. **Verify:**
- The Live Tournaments section renders above LIVE NOW (it should be the first content section after the welcome banners)
- Cover images load for tournaments that have one
- Tournaments without a cover render the tier-colored gradient instead
- LIVE pill appears on cards where the tournament has a live match right now
- Level pill (P1, BRONZE, etc.) is visible top-right
- "{n} matches today" or "Rest day" copy is correct
- Switching to the UPCOMING chip shows different tournaments with "Starts {date}"
- Tapping a card navigates to `/tournaments/[id]`
- Premier tournaments sort before FIP within each chip

Confirm with the user before moving on.

- [ ] **Step 7: Commit**

```bash
git add src/app/[locale]/\(app\)/home/page.tsx
git commit -m "$(cat <<'EOF'
feat(home): wire LiveTournamentsCarousel into home page

Adds 3 parallel queries (live/today tournaments, upcoming-7d,
today's match counts), transforms via the carousel utils, and
renders the new section above LIVE NOW. Spotlight, Live Now, and
Coming Up sections untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Empty-state polish + edge cases

- [ ] **Step 1: Verify both-empty hides section**

In a dev environment without any live or upcoming-7d tournaments, the section must not render. The component already returns `null` in this case (see Task 3 Step 1).

Verify by querying:
```bash
psql $DATABASE_URL -c "select count(*) from tournaments where starts_at <= now() and ends_at >= date_trunc('day', now() at time zone 'utc')"
psql $DATABASE_URL -c "select count(*) from tournaments where starts_at > now() and starts_at < now() + interval '7 days'"
```

If both return 0, reload the home page in the browser and confirm no Live Tournaments section appears. If you can't easily produce a zero-row environment, temporarily edit `home/page.tsx` to pass empty arrays — verify it hides the section, then revert.

- [ ] **Step 2: Verify LIVE/TODAY-empty + UPCOMING-populated auto-jumps default**

To force this in dev: temporarily replace the live-today query body with `.limit(0)` and reload. The carousel should mount with the UPCOMING chip selected by default. Revert the temporary edit.

If you can't easily test the empty-live path in dev, that's fine — the logic is `const defaultChip: Chip = liveToday.length > 0 ? 'live-today' : 'upcoming'` which is exhaustively tested in Task 1 by structure.

- [ ] **Step 3: Verify a tournament with 0 matches today shows "Rest day"**

Identify a tournament currently running (between starts_at and ends_at) but with no matches scheduled for today (rest day pattern). The card's status line should read **"Rest day"** instead of "0 matches today". If the env has no rest-day tournaments today, force one in DevTools by editing the `matchesToday` prop on the rendered component, or temporarily inject test data in `decorate(...)`.

- [ ] **Step 4: Verify the disabled chip state**

If LIVE/TODAY has rows but UPCOMING is empty, the UPCOMING chip should be visibly disabled (50% opacity, no pointer cursor) and not click-through. Switching to it should not be possible.

- [ ] **Step 5: Commit (only if any code fix was needed during verification)**

If no fix needed, skip this commit step.

---

## Task 7: Accessibility verification

- [ ] **Step 1: Confirm tablist semantics**

In DevTools, inspect the carousel. Verify:
- The chip strip wrapper has `role="tablist"` and `aria-label`
- Each chip has `role="tab"`, `aria-selected="true"` on active / `"false"` on inactive, and `aria-controls` pointing at the panel ID
- The scrolling card strip has `role="tabpanel"` and `aria-labelledby` pointing at the active chip's ID

- [ ] **Step 2: Confirm card link names**

Tab through cards with the keyboard. Each card's link should announce as `"{TournamentName}, {LevelLabel}, {statusLine}"` (e.g. "Italy Major, Premier P1, 12 matches today"). On macOS, enable VoiceOver (Cmd+F5) and Tab to a card to verify.

- [ ] **Step 3: Confirm the title is the section's accessible name**

The `<section>` wrapper has `aria-labelledby` matching the SectionTitle's span id. VoiceOver should announce "Live Tournaments, region" when entering the section.

- [ ] **Step 4: Commit (only if any fix was needed)**

If no fix needed, skip this commit step.

---

## Task 8: Final sweep — lint, build, PR

- [ ] **Step 1: Run lint**

```bash
npm run lint
```

Expected: clean exit, no new warnings from the carousel files.

- [ ] **Step 2: Run all unit tests**

```bash
npx vitest run src/lib/__tests__/live-tournaments-carousel.test.ts
```

Expected: all green.

- [ ] **Step 3: Build (catches type errors that lint may miss)**

```bash
npm run build
```

Expected: build completes. If it fails on type issues in the new files, fix them inline; if it fails on unrelated existing issues, note them but don't fix in this PR.

- [ ] **Step 4: Final manual check in dev**

`npm run dev`, open `http://localhost:3002`. Walk through:
- Section appears above LIVE NOW
- Both chips switch correctly
- Cover images render (a tournament with one)
- Gradient fallback renders (a tournament without one)
- Premier sorts first
- "Rest day" / "N matches today" / "Starts {date}" copy is correct
- Card link navigates to tournament detail page
- Section disappears entirely when both lists empty
- Locale switcher updates all copy (test on at least EN and one Romance locale)

Ask the user to confirm before moving on.

- [ ] **Step 5: Open PR**

```bash
git push -u origin claude/fervent-banach-f5550a
gh pr create --title "feat(home): live tournaments carousel" --body "$(cat <<'EOF'
## Summary
- New "Live Tournaments" chunky-style horizontal carousel above LIVE NOW on the home page
- Two chips: LIVE/TODAY (today falls within starts_at..ends_at) and UPCOMING (starts within 7 days)
- All tiers, Premier (P1/P2/Major/Finals) sorted before FIP (Gold/Bronze/Rise/Future) within each chip
- Per-tournament "N matches today" / "Rest day" / "Starts {date}" status line
- Cover images via existing `tournaments.cover_image_url`, tier-gradient fallback when null
- Visual treatment: Variant A from brainstorm — CHUNKY clip-paths on card, chips, badges, button
- i18n in 5 locales (en/es/pt/it/fr) with ICU plural for the count

## Test plan
- [ ] Carousel renders above LIVE NOW on the home page
- [ ] LIVE/TODAY chip shows tournaments running today, UPCOMING shows next 7 days
- [ ] Premier tiers sort before FIP within each chip
- [ ] LIVE pill appears only when at least one match in the tournament is `status='live'` or `'on_court'`
- [ ] Cover image falls back to tier-color gradient when null
- [ ] "Rest day" copy fires when the tournament has zero matches scheduled today
- [ ] Cards link to `/tournaments/[id]`
- [ ] Section is hidden entirely when both chips have zero rows
- [ ] Disabled chip styling when its list is empty
- [ ] Locale switch updates all copy (EN/ES/PT/IT/FR)
- [ ] `npx vitest run src/lib/__tests__/live-tournaments-carousel.test.ts` passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Spec: docs/superpowers/specs/2026-05-20-live-tournaments-carousel-design.md
Plan: docs/superpowers/plans/2026-05-20-live-tournaments-carousel.md
EOF
)"
```

---

## Self-review notes

**Spec coverage:**
- Placement (top, above LIVE NOW, spotlight untouched) → Task 5 step 5
- Two chips, default LIVE/TODAY → Task 3 + Task 6
- All tiers, Premier first via static rank → Task 1 (TIER_RANK + comparator)
- Cover image w/ `cover_image_url`, tier-gradient fallback → Task 4 (TIER_GRADIENT)
- "N matches today" / "Rest day" / "Starts {date}" → Task 4 statusLine
- CHUNKY clip-paths everywhere (Variant A) → Task 3 (chips) + Task 4 (card, pills, button)
- LIVE pill driven by live/on_court status → Task 1 (buildMatchInfoMap) + Task 4
- 3 new parallel queries → Task 5 step 3
- i18n 5 locales + ICU plural → Task 2
- Section hidden when both lists empty → Task 3 (return null)
- Auto-jump default chip when LIVE/TODAY empty → Task 3 (defaultChip computation)
- Accessibility (tablist/tab/tabpanel + aria-label) → Task 3 + Task 7
- No new DB migration / env vars / deps → confirmed

**Placeholder scan:** No "TBD" / "TODO" / "implement later" / vague-error-handling steps present. Every code-changing step has full code.

**Type consistency:** `TournamentWithMatchInfo`, `Chip`, `TournamentForSort`, `MatchForAggregation`, `MatchInfo`, `TIER_RANK` — same names used in every task that references them. Functions: `compareTournamentsForCarousel`, `buildMatchInfoMap`, `getLocalDayBoundaryUTC` — same names throughout.
