# Entry List Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat entry-list row renderer on the tournament detail page Overview tab with a hero-row treatment for seeds 1–8 (big dual avatars with flag overlays, ranking badges, clickable players, right-aligned points + debut pill), compact rows for seeds 9+, and two filter chips (`Fresh partners`, `New this season`).

**Architecture:** New shared component `src/components/EntryList.tsx` + extended data fetching in `V3Overview` inside `src/app/(app)/tournaments/[id]/page.tsx`. Pure client-side rendering and computation — no backend changes.

**Spec:** `docs/superpowers/specs/2026-04-08-entry-list-redesign-design.md`

---

## File Structure

**New files:**
- `src/components/EntryList.tsx` — shared entry list component with hero rows, compact rows, filter chips, and debut status rendering

**Modified files:**
- `src/app/(app)/tournaments/[id]/page.tsx` — extend `fetchDrawEntries` to hydrate player avatars/rankings and compute debut status; replace the inline Entry List JSX with a call to the new component

---

## Task 1: Create EntryList component with new UI + player data hydration

**Rationale:** This is the core visual redesign. Before wiring debut detection, get the hero/compact rendering right with real player avatars and rankings. Filter chips render but default to "All" with no fresh/season counts yet — we add those in Task 2.

**Files:**
- Create: `src/components/EntryList.tsx`
- Modify: `src/app/(app)/tournaments/[id]/page.tsx`

### Step 1: Create the EntryList component shell

- [ ] Create `src/components/EntryList.tsx` with this content:

```tsx
'use client'
// src/components/EntryList.tsx
//
// Tournament entry list: hero rows for seeds 1–8 (big avatars,
// flag overlays, ranking badges, right-aligned points + debut pill)
// and compact rows for seeds 9+. Includes filter chips for Fresh
// partners and New this season.

import Link from 'next/link'

// ── Brand colors ───────────────────────────────────────────────
const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const YELLOW = '#FFD166'
const MUTED = '#6B7280'
const BG_CARD = '#141414'
const BORDER = 'rgba(255,255,255,0.06)'

// ── Chunky clip-path presets ───────────────────────────────────
const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  button: 'polygon(4% 10%, 96% 0%, 100% 90%, 0% 100%)',
}

// ── Types ──────────────────────────────────────────────────────

export interface DrawEntry {
  draw_position: number
  seed: number | null
  marker: string | null
  category: 'men' | 'women'
  round?: string | null
  player1_name: string | null
  player1_country: string | null
  player1_id: string | null
  player2_name: string | null
  player2_country: string | null
  player2_id: string | null
  team_points: number | null
}

export type DebutStatus = 'fresh' | 'newThisSeason' | null

export interface PlayerHydration {
  avatar_url: string | null
  ranking: number | null
}

interface EntryListProps {
  entries: DrawEntry[]
  playerMap: Record<string, PlayerHydration>
  debutStatusMap: Record<string, DebutStatus>
  genderFilter: 'men' | 'women'
}

// ── Helpers ────────────────────────────────────────────────────

// Build a stable sorted key from two player IDs for debut status lookup.
// Returns null if either id is missing.
export function debutKey(id1: string | null, id2: string | null): string | null {
  if (!id1 || !id2) return null
  return id1 < id2 ? `${id1}|${id2}` : `${id2}|${id1}`
}

// Flag image — same implementation used elsewhere in the app.
function FlagImg({ country, size = 16 }: { country: string | null; size?: number }) {
  if (!country) return <span style={{ width: size, height: size * 0.75, display: 'inline-block' }} />
  const code = country.toLowerCase()
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/w40/${code}.png`}
      alt={country}
      width={size}
      height={size * 0.75}
      style={{ objectFit: 'cover', display: 'block', flexShrink: 0 }}
    />
  )
}

// Avatar with flag overlay in bottom-right corner.
function AvatarWithFlag({ avatarUrl, country, size = 42 }: {
  avatarUrl: string | null
  country: string | null
  size?: number
}) {
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          width={size}
          height={size}
          style={{
            width: size, height: size,
            borderRadius: '50%',
            border: `2px solid ${BG_CARD}`,
            objectFit: 'cover',
            background: '#1a1a2a',
          }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      ) : (
        <div style={{
          width: size, height: size,
          borderRadius: '50%',
          border: `2px solid ${BG_CARD}`,
          background: 'linear-gradient(135deg, #3a3a4a, #1a1a2a)',
        }} />
      )}
      <div style={{
        position: 'absolute',
        bottom: -1, right: -1,
        width: Math.round(size * 0.4),
        height: Math.round(size * 0.28),
        border: `1.5px solid ${BG_CARD}`,
        borderRadius: 2,
        overflow: 'hidden',
        zIndex: 3,
      }}>
        <FlagImg country={country} size={Math.round(size * 0.4)} />
      </div>
    </div>
  )
}

// Player name as a Link when ID is resolved, plain span otherwise.
function PlayerLink({
  id, name, ranking, muted,
}: {
  id: string | null
  name: string | null
  ranking: number | null
  muted?: boolean
}) {
  const content = (
    <>
      {ranking != null && (
        <span style={{
          display: 'inline-block',
          fontSize: 8, fontWeight: 800,
          color: GREEN, background: 'rgba(126,211,33,0.12)',
          padding: '1px 4px', marginRight: 4,
          clipPath: CHUNKY.badge,
        }}>
          #{ranking}
        </span>
      )}
      {name ?? '—'}
    </>
  )

  const baseStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    color: muted ? 'rgba(255,255,255,0.75)' : '#fff',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: 'block',
    textDecoration: 'none',
  }

  if (id) {
    return (
      <Link
        href={`/player/${id}`}
        style={baseStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </Link>
    )
  }
  return <span style={baseStyle}>{content}</span>
}

// Status pill — fresh or new-this-season.
function StatusPill({ kind, short }: { kind: 'fresh' | 'newThisSeason'; short?: boolean }) {
  const isFresh = kind === 'fresh'
  const color = isFresh ? GREEN : YELLOW
  const bg = isFresh ? 'rgba(126,211,33,0.15)' : 'rgba(255,209,102,0.15)'
  const label = short
    ? (isFresh ? 'Fresh' : 'New')
    : (isFresh ? 'Fresh partners' : 'New this season')
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 6px',
      fontSize: 8, fontWeight: 800,
      color, background: bg,
      textTransform: 'uppercase', letterSpacing: 0.4,
      clipPath: CHUNKY.badge,
      lineHeight: 1.4,
      whiteSpace: 'nowrap',
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: '50%',
        background: color, display: 'inline-block',
      }} />
      {label}
    </span>
  )
}

// ── Main component ─────────────────────────────────────────────

type Filter = 'all' | 'fresh' | 'newThisSeason'

export function EntryList({ entries, playerMap, debutStatusMap, genderFilter }: EntryListProps) {
  const [filter, setFilter] = React.useState<Filter>('all')

  // Scope to current gender
  const genderEntries = entries.filter(e => e.category === genderFilter)

  // Compute debut status for each entry
  const withStatus = genderEntries.map(e => {
    const key = debutKey(e.player1_id, e.player2_id)
    const status: DebutStatus = key ? (debutStatusMap[key] ?? null) : null
    return { ...e, debutStatus: status }
  })

  const freshCount = withStatus.filter(e => e.debutStatus === 'fresh').length
  const seasonCount = withStatus.filter(e => e.debutStatus === 'newThisSeason').length

  // Apply filter
  const filtered = withStatus.filter(e => {
    if (filter === 'fresh') return e.debutStatus === 'fresh'
    if (filter === 'newThisSeason') return e.debutStatus === 'newThisSeason'
    return true
  })

  if (filtered.length === 0 && filter === 'all') return null

  // Split hero (seeds 1–8 or draw_position ≤ 8 when seed missing) vs compact (rest)
  const isHero = (e: DrawEntry) => (e.seed != null && e.seed <= 8) || (e.seed == null && e.draw_position <= 8)
  const heroEntries = filtered.filter(isHero)
  const compactEntries = filtered.filter(e => !isHero(e))

  // Chip click: toggle or switch
  const clickChip = (next: Filter) => setFilter(prev => prev === next ? 'all' : next)

  return (
    <>
      {/* Section header with total count */}
      <div style={{
        fontSize: 9, fontWeight: 800, color: ORANGE,
        textTransform: 'uppercase', letterSpacing: 1,
        margin: '18px 0 10px',
      }}>
        Entry List ({genderEntries.length} pairs)
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <button
          onClick={() => setFilter('all')}
          style={chipStyle(filter === 'all', ORANGE)}
        >
          All <span style={{ opacity: 0.7, fontSize: 9, marginLeft: 3 }}>{genderEntries.length}</span>
        </button>
        <button
          onClick={() => clickChip('fresh')}
          style={chipStyle(filter === 'fresh', GREEN)}
        >
          Fresh partners <span style={{ opacity: 0.7, fontSize: 9, marginLeft: 3 }}>{freshCount}</span>
        </button>
        <button
          onClick={() => clickChip('newThisSeason')}
          style={chipStyle(filter === 'newThisSeason', YELLOW)}
        >
          New this season <span style={{ opacity: 0.7, fontSize: 9, marginLeft: 3 }}>{seasonCount}</span>
        </button>
      </div>

      {/* Hero rows */}
      {heroEntries.length > 0 && (
        <div style={{
          background: BG_CARD,
          clipPath: CHUNKY.card,
          border: `1px solid ${BORDER}`,
          padding: '10px 12px',
          marginBottom: 12,
        }}>
          <div style={{
            fontSize: 9, fontWeight: 700, color: MUTED,
            textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
          }}>
            Top Seeds
          </div>
          {heroEntries.map(e => {
            const p1Info = e.player1_id ? playerMap[e.player1_id] : undefined
            const p2Info = e.player2_id ? playerMap[e.player2_id] : undefined
            const seedLabel = e.seed != null ? String(e.seed) : e.marker || '—'

            return (
              <div
                key={e.draw_position}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  background: 'rgba(255,255,255,0.03)',
                  clipPath: CHUNKY.card,
                  padding: '10px 12px',
                  marginBottom: 6,
                }}
              >
                {/* Seed number */}
                <div style={{
                  fontSize: 22, fontWeight: 900, color: ORANGE,
                  fontFamily: 'var(--font-mono), monospace',
                  width: 28, textAlign: 'center', flexShrink: 0,
                  lineHeight: 1,
                }}>
                  {seedLabel}
                </div>

                {/* Avatars */}
                <div style={{ display: 'flex', flexShrink: 0 }}>
                  <div style={{ marginRight: -8, zIndex: 2, position: 'relative' }}>
                    <AvatarWithFlag avatarUrl={p1Info?.avatar_url ?? null} country={e.player1_country} size={42} />
                  </div>
                  <div style={{ zIndex: 1, position: 'relative' }}>
                    <AvatarWithFlag avatarUrl={p2Info?.avatar_url ?? null} country={e.player2_country} size={42} />
                  </div>
                </div>

                {/* Body: names on left, meta on right */}
                <div style={{
                  flex: 1, minWidth: 0,
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  columnGap: 10,
                  alignItems: 'center',
                }}>
                  {/* Names */}
                  <div style={{ minWidth: 0 }}>
                    <PlayerLink
                      id={e.player1_id}
                      name={e.player1_name}
                      ranking={p1Info?.ranking ?? null}
                    />
                    <div style={{ marginTop: 3 }}>
                      <PlayerLink
                        id={e.player2_id}
                        name={e.player2_name}
                        ranking={p2Info?.ranking ?? null}
                        muted
                      />
                    </div>
                  </div>

                  {/* Meta: points + pill stacked right-aligned */}
                  <div style={{
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'flex-end', gap: 3,
                    flexShrink: 0,
                  }}>
                    {e.team_points != null ? (
                      <div style={{
                        fontSize: 13, fontWeight: 800,
                        fontFamily: 'var(--font-mono), monospace',
                        color: '#fff', lineHeight: 1.1,
                      }}>
                        {e.team_points.toLocaleString()}
                        <span style={{ fontSize: 8, color: MUTED, fontWeight: 700, marginLeft: 3 }}>PTS</span>
                      </div>
                    ) : (
                      <div style={{ height: 14 }} />
                    )}
                    {e.debutStatus ? (
                      <StatusPill kind={e.debutStatus} />
                    ) : (
                      <div style={{ height: 14 }} />
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Compact rows — seeds 9+ */}
      {compactEntries.length > 0 && (
        <div style={{
          background: BG_CARD,
          clipPath: CHUNKY.card,
          border: `1px solid ${BORDER}`,
          padding: '4px 14px',
          marginBottom: 16,
        }}>
          <div style={{
            fontSize: 9, fontWeight: 700, color: MUTED,
            textTransform: 'uppercase', letterSpacing: 1,
            padding: '8px 0 4px',
          }}>
            Draw
          </div>
          {compactEntries.map((e, i) => {
            const p1Info = e.player1_id ? playerMap[e.player1_id] : undefined
            const p2Info = e.player2_id ? playerMap[e.player2_id] : undefined

            return (
              <div
                key={e.draw_position}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 0',
                  borderBottom: i < compactEntries.length - 1 ? `0.5px solid ${BORDER}` : 'none',
                }}
              >
                <span style={{
                  fontSize: 10, fontWeight: 800, color: MUTED,
                  width: 20, textAlign: 'center', flexShrink: 0,
                }}>
                  {e.draw_position}
                </span>
                {e.seed != null && (
                  <span style={{
                    fontSize: 9, fontWeight: 800, color: ORANGE,
                    background: 'rgba(245,166,35,0.12)',
                    padding: '1px 5px',
                    clipPath: CHUNKY.badge,
                    flexShrink: 0,
                  }}>
                    {e.seed}
                  </span>
                )}
                {e.marker && (
                  <span style={{
                    fontSize: 8, fontWeight: 800, color: YELLOW,
                    background: 'rgba(255,209,102,0.12)',
                    padding: '1px 4px',
                    clipPath: CHUNKY.badge,
                    flexShrink: 0,
                  }}>
                    {e.marker}
                  </span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <PlayerLink
                    id={e.player1_id}
                    name={e.player1_name}
                    ranking={p1Info?.ranking ?? null}
                  />
                  <div style={{ marginTop: 1 }}>
                    <PlayerLink
                      id={e.player2_id}
                      name={e.player2_name}
                      ranking={p2Info?.ranking ?? null}
                      muted
                    />
                  </div>
                </div>
                {e.debutStatus && <StatusPill kind={e.debutStatus} short />}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

function chipStyle(active: boolean, activeColor: string): React.CSSProperties {
  return {
    padding: '5px 11px',
    fontSize: 10, fontWeight: 800,
    textTransform: 'uppercase', letterSpacing: 0.3,
    background: active ? activeColor : 'rgba(255,255,255,0.06)',
    color: active ? '#000' : '#8a8f98',
    clipPath: CHUNKY.button,
    border: 'none', cursor: 'pointer',
    fontFamily: 'inherit',
  }
}

// Need to import React for useState — add at the top of the file too
import * as React from 'react'
```

**Note:** When you write the file, put `import * as React from 'react'` at the very top of the imports (not at the bottom). The bottom-of-file import above is a placement mistake in the plan — the actual file must have React imported at the top with the other imports. Correct imports order:

```tsx
'use client'
import * as React from 'react'
import Link from 'next/link'
// ... rest of file
```

### Step 2: Update V3Overview to hydrate player data and use EntryList

- [ ] Open `src/app/(app)/tournaments/[id]/page.tsx`. At the top of the file, add the import:

```tsx
import { EntryList } from '@/components/EntryList'
```

Place it alphabetically with other `@/components/*` imports.

- [ ] Find the page-level state declarations (around line 134):

```tsx
  const [drawEntries, setDrawEntries] = useState<any[]>([])
```

Add two new state pieces right after it:

```tsx
  const [drawEntries, setDrawEntries] = useState<any[]>([])
  const [playerMap, setPlayerMap] = useState<Record<string, { avatar_url: string | null; ranking: number | null }>>({})
  const [debutStatusMap, setDebutStatusMap] = useState<Record<string, 'fresh' | 'newThisSeason' | null>>({})
```

- [ ] Find the `fetchDrawEntries` callback (around line 203). Replace it entirely with:

```tsx
  // Fetch entry list / draw data + player hydration (avatars, rankings)
  const fetchDrawEntries = useCallback(async () => {
    const { data: drawData } = await supabase
      .from('tournament_draws')
      .select('draw_position, seed, marker, category, round, player1_name, player1_country, player1_id, player2_name, player2_country, player2_id, team_points')
      .eq('tournament_id', tournamentId)
      .order('draw_position', { ascending: true })

    if (!drawData) return
    setDrawEntries(drawData)

    // Collect unique resolved player IDs
    const playerIds = new Set<string>()
    for (const d of drawData as any[]) {
      if (d.player1_id) playerIds.add(d.player1_id)
      if (d.player2_id) playerIds.add(d.player2_id)
    }
    if (playerIds.size === 0) return

    // Hydrate player avatars + rankings
    const { data: playerData } = await supabase
      .from('players')
      .select('id, avatar_url, ranking')
      .in('id', Array.from(playerIds))

    if (playerData) {
      const map: Record<string, { avatar_url: string | null; ranking: number | null }> = {}
      for (const p of playerData as any[]) {
        map[p.id] = { avatar_url: p.avatar_url ?? null, ranking: p.ranking ?? null }
      }
      setPlayerMap(map)
    }

    // Debut status computation stays empty for Task 1 — Task 2 wires it.
    setDebutStatusMap({})
  }, [tournamentId])
```

- [ ] Find the Entry List rendering block inside `V3Overview` (around lines 1425–1486 — the `{/* Entry List from tournament_draws */}` comment and the IIFE below it):

```tsx
      {/* Entry List from tournament_draws */}
      {(() => {
        const genderDraws = drawEntries.filter((d: any) => d.category === genderFilter)
        if (genderDraws.length === 0) return null
        return (
          <>
            <SectionHeader label={`Entry List (${genderDraws.length} pairs)`} />
            <div style={{
              background: BG_CARD,
              clipPath: CHUNKY.card,
              border: `1px solid ${BORDER}`,
              padding: '4px 14px', marginBottom: 16,
              maxHeight: 400, overflowY: 'auto',
            }}>
              {genderDraws.map((d: any, i: number) => (
                // ... entire row render ...
              ))}
            </div>
          </>
        )
      })()}
```

Replace that entire block with:

```tsx
      {/* Entry List — hero rows for top seeds + compact for rest */}
      <EntryList
        entries={drawEntries as any}
        playerMap={playerMap}
        debutStatusMap={debutStatusMap}
        genderFilter={genderFilter}
      />
```

- [ ] `V3Overview` receives `drawEntries` as a prop. You ALSO need to pass `playerMap` and `debutStatusMap` as props to it. Find the `V3Overview` prop interface (around line 1044):

```tsx
function V3Overview({ tournament, allMatches, genderFilter, genderColor, availableRounds, roundDates, drawEntries }: {
  // ...
  drawEntries: any[]
})
```

Extend it:

```tsx
function V3Overview({ tournament, allMatches, genderFilter, genderColor, availableRounds, roundDates, drawEntries, playerMap, debutStatusMap }: {
  // ...
  drawEntries: any[]
  playerMap: Record<string, { avatar_url: string | null; ranking: number | null }>
  debutStatusMap: Record<string, 'fresh' | 'newThisSeason' | null>
})
```

- [ ] Find the call site of `V3Overview` (around lines 809 and 816 — there are two in the tournament detail page, one per gender filter branch). Both look roughly like:

```tsx
<V3Overview
  tournament={activeTournamentObj}
  allMatches={allMatches}
  genderFilter={genderFilter}
  genderColor={genderColor}
  availableRounds={availableRounds}
  roundDates={roundDates}
  drawEntries={drawEntries}
/>
```

Add the two new props to BOTH call sites:

```tsx
<V3Overview
  tournament={activeTournamentObj}
  allMatches={allMatches}
  genderFilter={genderFilter}
  genderColor={genderColor}
  availableRounds={availableRounds}
  roundDates={roundDates}
  drawEntries={drawEntries}
  playerMap={playerMap}
  debutStatusMap={debutStatusMap}
/>
```

### Step 3: Typecheck

- [ ] Run: `npx tsc --noEmit 2>&1 | grep -E "(tournaments/\[id\]/page|EntryList)"` — expected: no NEW errors.

### Step 4: Lint

- [ ] Run: `npm run lint -- "src/components/EntryList.tsx" "src/app/(app)/tournaments/[id]/page.tsx" 2>&1 | tail -30` — expected: no new errors.

### Step 5: Visual verification

- [ ] The dev server is running on port 3000 (verify via `mcp__Claude_Preview__preview_list`). Navigate to a tournament detail page known to have drawEntries (e.g. Miami P1 2026 or FIP Gold Almaty):

```
mcp__Claude_Preview__preview_eval with:
  window.location.href = '/tournaments/d3d73d56-eea4-4ebb-8715-58fa87751a52'
```

Wait ~1500ms, then ensure the Overview tab is active (it's the default). Scroll to the entry list section:

```
mcp__Claude_Preview__preview_eval with:
  (async () => {
    await new Promise(r => setTimeout(r, 1500));
    const headings = [...document.querySelectorAll('div')].filter(el => /Entry List \(/.test(el.textContent || ''));
    if (headings[0]) headings[0].scrollIntoView({ block: 'start' });
    await new Promise(r => setTimeout(r, 400));
    return 'ready';
  })()
```

Screenshot. Verify:
- Filter chips row: All / Fresh partners / New this season (counts: All shows total, others show 0 at this point — debut not yet computed)
- Hero section "Top Seeds" with cards for seeds 1–8 (or fewer if tournament has fewer pairs)
- Each hero card has: big seed number, two overlapping 42px avatars with flag overlays bottom-right, player names with green ranking badges, right-aligned points
- Debut pill area is empty (no fresh/season dots yet — expected for Task 1)
- Compact section "Draw" below with rows for seeds 9+

- [ ] Click a player name in a hero row — should navigate to `/player/{id}`. Verify navigation happens.

- [ ] Navigate back and verify you return to the tournament detail Overview.

- [ ] Console check: `mcp__Claude_Preview__preview_console_logs` with `level: 'error'` — expected: no new errors.

### Step 6: Commit Task 1

- [ ] Commit:

```bash
git add src/components/EntryList.tsx "src/app/(app)/tournaments/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
feat(tournaments): redesign entry list with hero rows + player avatars

Replace the flat-list entry list on the tournament Overview tab
with a shared EntryList component that renders:

- Seeds 1-8 as hero rows: big monospace seed number, two
  overlapping 42px avatars with country flag overlays in the
  bottom-right corner, green ranking badges next to each name,
  right-aligned team points, and a (for-now-empty) slot for the
  debut pill
- Seeds 9+ as compact rows (similar to today but with clickable
  player names)
- Filter chips at the top: All / Fresh partners / New this season
  (counts are zero until the next commit wires debut detection)

Player avatars and rankings are now hydrated via a lightweight
join against the players table keyed by player1_id / player2_id.
Player names become <Link> elements when the ID is resolved,
plain text otherwise.

Spec: docs/superpowers/specs/2026-04-08-entry-list-redesign-design.md
EOF
)"
```

---

## Task 2: Compute debut status + wire filter chips

**Rationale:** With the UI and data hydration in place, add the historical-match query and compute `fresh` vs `newThisSeason` per pair. Fill in the `debutStatusMap` and watch the filter chips come to life.

**Files:**
- Modify: `src/app/(app)/tournaments/[id]/page.tsx`

### Step 1: Add the debut detection logic to fetchDrawEntries

- [ ] Open `src/app/(app)/tournaments/[id]/page.tsx`. Find `fetchDrawEntries` (inside `V3ScoresPageContent` or similar — whatever the component is named — around line 203 after Task 1).

- [ ] Inside `fetchDrawEntries`, right after the player hydration block and before `setDebutStatusMap({})`, insert the debut detection logic:

```tsx
    // ── Compute debut status (fresh partners / new this season) ──
    // For each entry with both player IDs resolved, look at historical
    // finished matches (excluding this tournament) and count whether
    // they've played together, and whether any of those matches are
    // in the current calendar year.
    const idList = Array.from(playerIds)
    const orClause =
      `pair1_player1_id.in.(${idList.join(',')}),` +
      `pair1_player2_id.in.(${idList.join(',')}),` +
      `pair2_player1_id.in.(${idList.join(',')}),` +
      `pair2_player2_id.in.(${idList.join(',')})`

    const { data: histMatches } = await supabase
      .from('matches')
      .select('pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, finished_at')
      .in('status', ['finished', 'retired', 'walkover'])
      .neq('tournament_id', tournamentId)
      .or(orClause)
      .limit(5000)

    // Build a map: pairKey → { hasPast: boolean, hasThisYear: boolean }
    const pairStats: Record<string, { hasPast: boolean; hasThisYear: boolean }> = {}
    const currentYear = new Date().getFullYear()

    const makeKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`

    for (const m of (histMatches ?? []) as any[]) {
      // For each match, check both pair slots. If both IDs in a slot
      // are members of our playerIds set, record them as a played-together pair.
      const pairs: Array<[string | null, string | null]> = [
        [m.pair1_player1_id, m.pair1_player2_id],
        [m.pair2_player1_id, m.pair2_player2_id],
      ]
      for (const [a, b] of pairs) {
        if (!a || !b) continue
        if (!playerIds.has(a) || !playerIds.has(b)) continue
        const key = makeKey(a, b)
        const year = m.finished_at ? new Date(m.finished_at).getFullYear() : 0
        const existing = pairStats[key] ?? { hasPast: false, hasThisYear: false }
        existing.hasPast = true
        if (year === currentYear) existing.hasThisYear = true
        pairStats[key] = existing
      }
    }

    // Map each current-tournament entry to a debut status.
    const statusMap: Record<string, 'fresh' | 'newThisSeason' | null> = {}
    for (const d of drawData as any[]) {
      if (!d.player1_id || !d.player2_id) continue
      const key = makeKey(d.player1_id, d.player2_id)
      const stats = pairStats[key]
      if (!stats || !stats.hasPast) {
        statusMap[key] = 'fresh'
      } else if (!stats.hasThisYear) {
        statusMap[key] = 'newThisSeason'
      } else {
        statusMap[key] = null // established
      }
    }
    setDebutStatusMap(statusMap)
```

- [ ] Delete the now-redundant `setDebutStatusMap({})` line that was added in Task 1.

### Step 2: Typecheck

- [ ] Run: `npx tsc --noEmit 2>&1 | grep "tournaments/\[id\]/page"` — expected: no NEW errors.

### Step 3: Lint

- [ ] Run: `npm run lint -- "src/app/(app)/tournaments/[id]/page.tsx" 2>&1 | tail -20` — expected: no new errors.

### Step 4: Visual verification

- [ ] Navigate to the tournament detail page:

```
mcp__Claude_Preview__preview_eval with:
  window.location.href = '/tournaments/d3d73d56-eea4-4ebb-8715-58fa87751a52'
```

Wait ~2 seconds (the historical match fetch takes longer than before).

- [ ] Scroll to the entry list:

```
mcp__Claude_Preview__preview_eval with:
  (async () => {
    await new Promise(r => setTimeout(r, 2000));
    const headings = [...document.querySelectorAll('div')].filter(el => /Entry List \(/.test(el.textContent || ''));
    if (headings[0]) headings[0].scrollIntoView({ block: 'start' });
    await new Promise(r => setTimeout(r, 400));
    return 'ready';
  })()
```

Screenshot. Verify:
- The filter chip counts are non-zero (unless the tournament genuinely has no fresh or new-this-season pairs)
- At least one hero card shows a `● Fresh partners` or `● New this season` pill in the bottom-right area (if applicable)
- At least one compact row shows a right-aligned `Fresh` or `New` pill (if applicable)

- [ ] Click the "Fresh partners" chip:

```
mcp__Claude_Preview__preview_eval with:
  (async () => {
    const chips = [...document.querySelectorAll('button')].filter(el => /Fresh partners/.test(el.textContent || ''));
    if (chips[0]) chips[0].click();
    await new Promise(r => setTimeout(r, 300));
    return 'clicked';
  })()
```

Screenshot. Verify only fresh-partner pairs are shown (both hero and compact sections filter correctly).

- [ ] Click the "New this season" chip the same way. Verify filtering.

- [ ] Click the active chip again (should return to "All"):

```
mcp__Claude_Preview__preview_eval with:
  (async () => {
    const active = [...document.querySelectorAll('button')].find(el => {
      const bg = window.getComputedStyle(el).backgroundColor;
      return /Fresh|New/.test(el.textContent || '') && !bg.includes('255, 255, 255');
    });
    if (active) active.click();
    await new Promise(r => setTimeout(r, 300));
    return 'ok';
  })()
```

- [ ] Console error check: no new errors.

### Step 5: Commit Task 2

- [ ] Commit:

```bash
git add "src/app/(app)/tournaments/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
feat(tournaments): compute entry-list debut status and wire filter chips

Extend fetchDrawEntries to query historical finished matches
(excluding the current tournament) for all players in the entry
list, then compute per-pair debut status:

- fresh:         pair has never played together in our DB
- newThisSeason: pair has past meetings but none in the current
                 calendar year (reunions + dormant comebacks)
- null:          established pair playing together this year

The results populate debutStatusMap which is passed down to the
EntryList component. The Fresh partners / New this season filter
chips now show live counts and filter the rendered list.

Spec: docs/superpowers/specs/2026-04-08-entry-list-redesign-design.md
EOF
)"
```

---

## Final Verification

- [ ] Run `git log --oneline main..HEAD` — expected: two new commits on top of the existing branch commits.

- [ ] Open a tournament page in the browser, walk through each feature:
  - Filter chips work and show correct counts
  - Hero cards render with avatars + rankings + pills
  - Compact rows render with optional pills
  - Clicking a player name navigates to `/player/[id]`
  - Gender toggle (men/women) still filters the entry list correctly
  - A tournament with zero `tournament_draws` rows shows no entry list section (existing behavior preserved)

- [ ] `npx tsc --noEmit 2>&1 | wc -l` — expected: same or fewer errors than before

## Summary

Two commits on the active branch:

1. `feat(tournaments): redesign entry list with hero rows + player avatars` — new shared `EntryList` component, player hydration, new UI rendering
2. `feat(tournaments): compute entry-list debut status and wire filter chips` — historical match query, fresh/new-this-season computation, working filter chips
