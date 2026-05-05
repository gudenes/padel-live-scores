# Player Picker Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the passive 3-step coachmark with a Spotify-style first-launch player picker, redesign the Following page with an auto-scrolling Suggested row, fix the anonymous→authenticated follow loss bug, and surface a delayed login CTA.

**Architecture:** New `/welcome` route hosts the picker; selections write through the existing `useFollowing` hook (with a new `silent` option to suppress per-pick toasts). A consolidated notification permission sheet fires once after Continue, before navigating to home. The existing `SpotlightCoachmarks` is removed; users who already dismissed it inherit `pn_picker_done`. Following page gains a `SuggestedPlayersMarquee` for evergreen discovery.

**Tech Stack:** Next.js 16 App Router, React 19, next-intl (5 locales), Supabase (browser anon + server service), Tailwind 4, Vitest (node env — no DOM/React testing lib).

**Spec:** [docs/superpowers/specs/2026-05-05-player-picker-onboarding-design.md](../specs/2026-05-05-player-picker-onboarding-design.md)

---

## File Structure

### New files
- `src/lib/country-boost-sort.ts` — pure helper that stable-sorts a ranked player list with a country boost applied
- `src/lib/__tests__/country-boost-sort.test.ts`
- `src/lib/follow-migration.ts` — pure helper that computes the diff for anonymous→authenticated bookmark migration
- `src/lib/__tests__/follow-migration.test.ts`
- `src/app/api/picker/suggested-players/route.ts` — `GET` returning top 30 ranked players (country-boosted)
- `src/lib/__tests__/suggested-players-route.test.ts`
- `src/app/[locale]/(app)/welcome/page.tsx` — picker page
- `src/app/[locale]/(app)/welcome/PickerCard.tsx` — single player card for the picker grid
- `src/app/[locale]/(app)/welcome/NotificationPromptSheet.tsx` — bottom sheet shown after Continue
- `src/components/home/WelcomeStrip.tsx` — top-of-home post-picker strip with 24h auto-fade
- `src/components/following/SuggestedPlayersMarquee.tsx` — auto-scrolling Suggested row for Following page
- `src/components/LoginCtaSheet.tsx` — bottom sheet that nudges sign-in for anonymous users with N follows

### Modified files
- `src/hooks/useFollowing.ts` — add `{ silent }` option to `toggle`; integrate migration on sign-in
- `src/app/[locale]/(app)/layout.tsx` — remove `<SpotlightCoachmarks />` mount
- `src/app/[locale]/(app)/home/page.tsx` — add `/welcome` redirect on first visit, mount `<WelcomeStrip />`, mount `<LoginCtaSheet />`
- `src/app/[locale]/(app)/following/page.tsx` — mount `<SuggestedPlayersMarquee />` near the top
- `src/messages/{en,es,pt,it,fr}.json` — add new keys; remove `onboarding.*` keys

### Deleted files
- `src/components/SpotlightCoachmarks.tsx` (after redirect logic is verified)

### LocalStorage flags (full inventory)
| Flag | Set when | Read where |
|---|---|---|
| `pn_picker_done` | Picker Continue or Skip | Home page (redirect gate) |
| `pn_picker_first_session` | Picker Continue (timestamp) | Login CTA timing |
| `pn_push_prompted` | NotificationPromptSheet either button | Picker (skip sheet if set) + bookmark toast CTA gate |
| `pn_welcome_strip_dismissed` | Strip close or 24h | WelcomeStrip render gate |
| `pn_login_cta_shown` | LoginCtaSheet either button | LoginCtaSheet render gate |
| `pn_migrated_to_user_<userId>` | Successful follow migration | useFollowing load (skip re-running) |
| `pn_onboarding_done` (legacy) | Old coachmark dismiss | Synthetic `pn_picker_done` migration on first load |

---

## Task 1: Add `silent` option to `useFollowing.toggle`

**Why:** The picker writes 1–10 follows in rapid succession. Without this option, each call fires a `BOOKMARK_EVENT` toast and the per-follow push CTA — they would stack visually and fight the consolidated NotificationPromptSheet.

**Files:**
- Modify: `src/hooks/useFollowing.ts`

- [ ] **Step 1: Open `src/hooks/useFollowing.ts` and locate the `toggle` callback (around line 165).**

- [ ] **Step 2: Update the `toggle` signature and add the silent guard.**

Replace the `toggle` callback (currently lines 165–251) with:

```ts
const toggle = useCallback(
  async (
    type: FollowType,
    targetId: string,
    opts?: { silent?: boolean },
  ) => {
    const isCurrently = store[type].has(targetId)
    const silent = opts?.silent === true

    // Optimistic update
    setStore(prev => {
      const next = { ...prev, [type]: new Set(prev[type]) }
      if (isCurrently) next[type].delete(targetId)
      else next[type].add(targetId)

      // Always sync localStorage (source of truth for anonymous + news_sources)
      if (!user || type === 'news_source') {
        const field = typeToField(type)
        const local = readLocalStorage()
        local[field] = [...next[type]]
        writeLocalStorage(local)
      }

      return next
    })

    // Fire bookmark feedback toast (skip news_source — not a user-facing bookmark)
    // Suppressed entirely when `silent: true` — used by the picker which writes
    // many follows at once and surfaces a single consolidated prompt instead.
    if (!silent && type !== 'news_source' && typeof window !== 'undefined') {
      const isPushOpportunity =
        !isCurrently &&
        (type === 'match' || type === 'player' || type === 'tournament')
      let cta: 'enable-push' | undefined
      if (isPushOpportunity) {
        try {
          const alreadyPrompted = localStorage.getItem('pn_push_prompted') === '1'
          const browserPermission = 'Notification' in window ? Notification.permission : 'denied'
          if (!alreadyPrompted && browserPermission === 'default') {
            cta = 'enable-push'
          }
        } catch { /* permission check failed — skip CTA */ }
      }
      window.dispatchEvent(new CustomEvent(BOOKMARK_EVENT, {
        detail: {
          type,
          action: isCurrently ? 'remove' : 'add',
          ...(cta ? { cta } : {}),
        } satisfies BookmarkEventDetail,
      }))
    }

    // Persist to Supabase for authenticated users (non-news_source types only)
    if (user && type !== 'news_source') {
      const dbType = typeToDbType(type)
      invalidateBookmarksCache()
      if (isCurrently) {
        await fetch('/api/user/bookmarks', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookmark_type: dbType, target_id: targetId }),
        })
      } else {
        await fetch('/api/user/bookmarks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookmark_type: dbType, target_id: targetId }),
        })
      }
    }
  },
  [user, store],
)
```

Only two effective changes vs. the existing version: the optional `opts` parameter and the `!silent &&` guard around the toast dispatch. Existing call-sites are unchanged because `silent` defaults to off.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors related to this file (pre-existing errors elsewhere are not this task's concern).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useFollowing.ts
git commit -m "$(cat <<'EOF'
feat(useFollowing): add silent option to toggle

Suppresses BOOKMARK_EVENT toast and per-follow push CTA. Used by the
upcoming player picker which writes 1-10 follows rapidly and surfaces a
single consolidated permission prompt instead of stacked toasts.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Country-boost sort helper

**Why:** The picker and the Following page Suggested row both need to surface country-relevant top players first. Extract the sort as a pure function so it's testable and shared.

**Files:**
- Create: `src/lib/country-boost-sort.ts`
- Create: `src/lib/__tests__/country-boost-sort.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/country-boost-sort.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { applyCountryBoost } from '../country-boost-sort'

interface Row { id: string; ranking: number; country: string }

const rows: Row[] = [
  { id: 'a', ranking: 1, country: 'ARG' },
  { id: 'b', ranking: 2, country: 'ESP' },
  { id: 'c', ranking: 3, country: 'ARG' },
  { id: 'd', ranking: 4, country: 'ESP' },
  { id: 'e', ranking: 5, country: 'BRA' },
]

describe('applyCountryBoost', () => {
  it('returns input untouched when no boost country given', () => {
    const out = applyCountryBoost(rows, null, r => r.country)
    expect(out.map(r => r.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('moves boosted-country players to the top, preserving ranking among them', () => {
    const out = applyCountryBoost(rows, 'ESP', r => r.country)
    expect(out.map(r => r.id)).toEqual(['b', 'd', 'a', 'c', 'e'])
  })

  it('preserves relative ranking among non-boosted players', () => {
    const out = applyCountryBoost(rows, 'ESP', r => r.country)
    const nonBoost = out.filter(r => r.country !== 'ESP').map(r => r.id)
    expect(nonBoost).toEqual(['a', 'c', 'e'])
  })

  it('handles boost country not present (no change)', () => {
    const out = applyCountryBoost(rows, 'JPN', r => r.country)
    expect(out.map(r => r.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('is case-insensitive on country code', () => {
    const out = applyCountryBoost(rows, 'esp', r => r.country)
    expect(out.map(r => r.id)).toEqual(['b', 'd', 'a', 'c', 'e'])
  })

  it('does not mutate the input', () => {
    const before = rows.map(r => r.id).join(',')
    applyCountryBoost(rows, 'ESP', r => r.country)
    expect(rows.map(r => r.id).join(',')).toBe(before)
  })
})
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `npx vitest run src/lib/__tests__/country-boost-sort.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/country-boost-sort.ts`:

```ts
// Pure stable-sort that lifts items matching the boost country to the top
// of the list, preserving the input's relative order within both the boosted
// and non-boosted partitions. Used by the player picker and the Following
// page's Suggested marquee to localize the surface to the visitor's country.

export function applyCountryBoost<T>(
  rows: readonly T[],
  boostCountry: string | null,
  getCountry: (row: T) => string | null | undefined,
): T[] {
  if (!boostCountry) return [...rows]
  const target = boostCountry.toUpperCase()
  const boosted: T[] = []
  const rest: T[] = []
  for (const row of rows) {
    const c = (getCountry(row) ?? '').toUpperCase()
    if (c === target) boosted.push(row)
    else rest.push(row)
  }
  return [...boosted, ...rest]
}
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `npx vitest run src/lib/__tests__/country-boost-sort.test.ts`
Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/country-boost-sort.ts src/lib/__tests__/country-boost-sort.test.ts
git commit -m "$(cat <<'EOF'
feat(lib): add country-boost stable sort helper

Pure function used by the player picker and Following page Suggested row
to surface country-matching top players first. Preserves relative ranking
within both partitions.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Anonymous→authenticated follow migration helper

**Why:** Probable contributor to the "followed players not showing up" feedback. When an anon user follows players (localStorage), then signs in, `useFollowing.load()` reads from DB and replaces the store. localStorage entries are silently dropped from the visible list. This task extracts the diff as a pure helper so it's testable; the next task wires it into `useFollowing`.

**Files:**
- Create: `src/lib/follow-migration.ts`
- Create: `src/lib/__tests__/follow-migration.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/follow-migration.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeFollowMigration } from '../follow-migration'

describe('computeFollowMigration', () => {
  const localStorageFollows = {
    matches: ['m1', 'm2'],
    players: ['p1', 'p2', 'p3'],
    tournaments: ['t1'],
    news_sources: ['nyt'], // never migrated to DB
  }

  it('returns the set of (type, id) pairs missing from DB', () => {
    const dbRows = [
      { bookmark_type: 'player', target_id: 'p1' },
      { bookmark_type: 'match', target_id: 'm1' },
    ]
    const out = computeFollowMigration(localStorageFollows, dbRows)
    expect(out).toEqual([
      { bookmark_type: 'match', target_id: 'm2' },
      { bookmark_type: 'player', target_id: 'p2' },
      { bookmark_type: 'player', target_id: 'p3' },
      { bookmark_type: 'tournament', target_id: 't1' },
    ])
  })

  it('returns empty array when DB is a superset', () => {
    const dbRows = [
      { bookmark_type: 'match', target_id: 'm1' },
      { bookmark_type: 'match', target_id: 'm2' },
      { bookmark_type: 'player', target_id: 'p1' },
      { bookmark_type: 'player', target_id: 'p2' },
      { bookmark_type: 'player', target_id: 'p3' },
      { bookmark_type: 'tournament', target_id: 't1' },
    ]
    expect(computeFollowMigration(localStorageFollows, dbRows)).toEqual([])
  })

  it('returns empty array when localStorage has no DB-eligible follows', () => {
    expect(
      computeFollowMigration(
        { matches: [], players: [], tournaments: [], news_sources: ['nyt'] },
        [],
      ),
    ).toEqual([])
  })

  it('skips news_sources (not stored in DB)', () => {
    const out = computeFollowMigration(
      { matches: [], players: [], tournaments: [], news_sources: ['nyt', 'bbc'] },
      [],
    )
    expect(out.find(r => (r.bookmark_type as string) === 'news_source')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test, expect FAIL**

Run: `npx vitest run src/lib/__tests__/follow-migration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/follow-migration.ts`:

```ts
// Computes the set of (bookmark_type, target_id) pairs that exist in
// the user's localStorage follow store but are absent from the DB.
// Used during sign-in to migrate anonymous follows into user_bookmarks.
//
// news_sources are never migrated — they're a localStorage-only feature.

export interface LocalFollowStore {
  matches: string[]
  players: string[]
  tournaments: string[]
  news_sources: string[]
}

export interface DbBookmarkRow {
  bookmark_type: string
  target_id: string
}

export interface MigrationItem {
  bookmark_type: 'match' | 'player' | 'tournament'
  target_id: string
}

export function computeFollowMigration(
  local: LocalFollowStore,
  dbRows: readonly DbBookmarkRow[],
): MigrationItem[] {
  const dbKey = (t: string, id: string) => `${t}::${id}`
  const dbSet = new Set(dbRows.map(r => dbKey(r.bookmark_type, r.target_id)))

  const out: MigrationItem[] = []
  for (const id of local.matches) {
    if (!dbSet.has(dbKey('match', id))) out.push({ bookmark_type: 'match', target_id: id })
  }
  for (const id of local.players) {
    if (!dbSet.has(dbKey('player', id))) out.push({ bookmark_type: 'player', target_id: id })
  }
  for (const id of local.tournaments) {
    if (!dbSet.has(dbKey('tournament', id))) out.push({ bookmark_type: 'tournament', target_id: id })
  }
  return out
}
```

- [ ] **Step 4: Run the test, expect PASS**

Run: `npx vitest run src/lib/__tests__/follow-migration.test.ts`
Expected: 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/follow-migration.ts src/lib/__tests__/follow-migration.test.ts
git commit -m "$(cat <<'EOF'
feat(lib): add follow-migration diff helper

Pure function that computes which anonymous (localStorage) follows need
to be POSTed to /api/user/bookmarks on first sign-in. Likely root cause
of the "followed players not showing up" feedback.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire migration into `useFollowing.load()`

**Why:** Use the helper from Task 3 inside the hook so the first DB-load after sign-in posts any missing localStorage follows before populating the in-memory store.

**Files:**
- Modify: `src/hooks/useFollowing.ts`

- [ ] **Step 1: Open `src/hooks/useFollowing.ts` and locate the `load()` function inside the `useEffect` (around line 121).**

- [ ] **Step 2: Replace the `load()` function with one that runs the migration.**

Find the `load()` function (currently the body of `useEffect` from line 121–157) and replace with:

```ts
async function load() {
  // Always load localStorage first (includes news_sources + offline fallback)
  const local = readLocalStorage()

  if (userId) {
    const migrationFlagKey = `pn_migrated_to_user_${userId}`
    const alreadyMigrated =
      typeof window !== 'undefined' &&
      localStorage.getItem(migrationFlagKey) === '1'

    let dbRows = await fetchBookmarksDeduplicated(userId)

    // First-time-on-this-device migration: send any localStorage follows
    // that aren't already in the user's DB bookmarks. POST is idempotent
    // (route uses upsert with composite-key onConflict).
    if (!alreadyMigrated) {
      const { computeFollowMigration } = await import('@/lib/follow-migration')
      const toMigrate = computeFollowMigration(local, dbRows)
      if (toMigrate.length > 0) {
        await Promise.all(
          toMigrate.map(item =>
            fetch('/api/user/bookmarks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item),
            }).catch(() => null), // tolerate single failures; flag stays unset so we retry next session
          ),
        )
        // Re-fetch so the in-memory store reflects what just got persisted.
        invalidateBookmarksCache()
        dbRows = await fetchBookmarksDeduplicated(userId)
      }
      try {
        localStorage.setItem(migrationFlagKey, '1')
      } catch {}
    }

    const dbMatches = new Set<string>()
    const dbPlayers = new Set<string>()
    const dbTournaments = new Set<string>()

    for (const row of dbRows) {
      if (row.bookmark_type === 'match') dbMatches.add(row.target_id)
      else if (row.bookmark_type === 'player') dbPlayers.add(row.target_id)
      else if (row.bookmark_type === 'tournament') dbTournaments.add(row.target_id)
    }

    setStore({
      match: dbMatches,
      player: dbPlayers,
      tournament: dbTournaments,
      news_source: new Set(local.news_sources),
    })
  } else {
    setStore({
      match: new Set(local.matches),
      player: new Set(local.players),
      tournament: new Set(local.tournaments),
      news_source: new Set(local.news_sources),
    })
  }

  setLoaded(true)
}
```

The dynamic `import('@/lib/follow-migration')` keeps the helper out of the main bundle — only loaded the one time per user it's actually needed.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual smoke test**

This requires verifying the migration in a real browser session — can be done after the picker ships (Task 8), since the picker is the easiest way to seed localStorage follows and then sign in. For now verify:

Run: `npm run dev` (port 3002)
- Open `localhost:3002`, in DevTools Console:
  ```js
  localStorage.setItem('pn_following', JSON.stringify({
    matches: [], players: ['paste-a-real-player-uuid-here'],
    tournaments: [], news_sources: []
  }))
  ```
- Sign in. Check Network tab: should see one `POST /api/user/bookmarks` for the player.
- Check `localStorage` — `pn_migrated_to_user_<userId>` should now be `'1'`.
- Refresh — no second POST should fire.

If the manual check is too disruptive at this point in the plan, defer to the QA pass at the end. Move on.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFollowing.ts
git commit -m "$(cat <<'EOF'
fix(useFollowing): migrate localStorage follows on first sign-in

Anonymous follows previously vanished from the UI when a user signed in,
because load() read DB and replaced the in-memory store. Now we POST any
localStorage entries missing from DB before populating the store. Idempotent
via the upsert in /api/user/bookmarks; gated by pn_migrated_to_user_<userId>
to avoid re-running.

Likely root cause of "followed players not showing up" feedback.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Suggested-players API endpoint

**Why:** The picker grid and the Following page marquee both fetch the same top-30 ranked players with country boost. Centralize as one endpoint so they don't drift.

**Files:**
- Create: `src/app/api/picker/suggested-players/route.ts`
- Create: `src/lib/__tests__/suggested-players-route.test.ts`

- [ ] **Step 1: Write the failing test (route shape only — no DB)**

The endpoint composes a Supabase query + the `applyCountryBoost` helper. Direct route-handler tests are awkward with Supabase mocking; instead, test the small composition function we'll extract from the route.

Create `src/lib/__tests__/suggested-players-route.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { boostAndTrim } from '../suggested-players-helper'

describe('boostAndTrim', () => {
  const players = [
    { id: 'p1', ranking: 1, country: 'ARG', name: 'A' },
    { id: 'p2', ranking: 2, country: 'ESP', name: 'B' },
    { id: 'p3', ranking: 3, country: 'ARG', name: 'C' },
    { id: 'p4', ranking: 4, country: 'ESP', name: 'D' },
    { id: 'p5', ranking: 5, country: 'BRA', name: 'E' },
  ]

  it('boosts country matches to the top', () => {
    const out = boostAndTrim(players, 'ESP', 5)
    expect(out.map(p => p.id)).toEqual(['p2', 'p4', 'p1', 'p3', 'p5'])
  })

  it('trims to the requested limit', () => {
    const out = boostAndTrim(players, 'ESP', 3)
    expect(out.map(p => p.id)).toEqual(['p2', 'p4', 'p1'])
    expect(out).toHaveLength(3)
  })

  it('returns ranking-sorted when no country boost', () => {
    const out = boostAndTrim(players, null, 30)
    expect(out.map(p => p.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/lib/__tests__/suggested-players-route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

Create `src/lib/suggested-players-helper.ts`:

```ts
import { applyCountryBoost } from './country-boost-sort'

export interface SuggestedPlayer {
  id: string
  name: string
  display_name?: string | null
  country: string | null
  ranking: number | null
  category?: string | null
  avatar_url?: string | null
}

export function boostAndTrim<T extends SuggestedPlayer>(
  players: readonly T[],
  boostCountry: string | null,
  limit: number,
): T[] {
  return applyCountryBoost(players, boostCountry, p => p.country).slice(0, limit)
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/lib/__tests__/suggested-players-route.test.ts`
Expected: 3 tests passing.

- [ ] **Step 5: Write the route handler**

Create `src/app/api/picker/suggested-players/route.ts`:

```ts
import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase'
import { boostAndTrim, type SuggestedPlayer } from '@/lib/suggested-players-helper'

export async function GET(_req: NextRequest) {
  // Country boost from the geo-country cookie set by src/proxy.ts.
  const cookieStore = await cookies()
  const geoCountry = cookieStore.get('geo-country')?.value ?? null

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('players')
    .select('id, name, display_name, country, ranking, category, avatar_url')
    .not('ranking', 'is', null)
    .order('ranking', { ascending: true })
    .limit(60)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  const players = (data ?? []) as SuggestedPlayer[]
  const top30 = boostAndTrim(players, geoCountry, 30)

  // Cache for 5 minutes — rankings don't change minute-to-minute and
  // most picker visits happen in the first session.
  return Response.json(top30, {
    headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' },
  })
}
```

Verify the supabase server-client export by reading `src/lib/supabase.ts` if `createServerClient` doesn't match; adjust the import to whatever export name is used (likely the same per CLAUDE.md). If only a `supabase` browser client is exported, swap to `import { createClient } from '@supabase/supabase-js'` with `process.env.SUPABASE_SERVICE_KEY`. (The CLAUDE.md describes `src/lib/supabase.ts` as a "Client factory (browser anon + server service key)", so the named server export should exist.)

- [ ] **Step 6: Smoke-test the route**

Run: `npm run dev`
Then in another shell:
```bash
curl -s 'http://localhost:3002/api/picker/suggested-players' | python3 -m json.tool | head -20
```
Expected: an array of 30 player objects, sorted by ranking (or country-boosted if your geo-country cookie matches a player country).

- [ ] **Step 7: Commit**

```bash
git add src/lib/suggested-players-helper.ts src/lib/__tests__/suggested-players-route.test.ts src/app/api/picker/suggested-players/route.ts
git commit -m "$(cat <<'EOF'
feat(api): add /api/picker/suggested-players endpoint

Top-30 ranked players, country-boosted via the geo-country cookie. Shared
by the upcoming player picker and the Following page Suggested marquee.
5-minute Cache-Control header — rankings change daily at most.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: i18n keys

**Why:** Add all new translation keys upfront so each subsequent UI task can reference them without context-switching to messages files.

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

- [ ] **Step 1: Add the new namespaces to `en.json`**

Open `src/messages/en.json`. Add (alphabetically among existing top-level namespaces):

```json
"picker": {
  "title": "Who do you follow?",
  "subtitle": "Pick at least one player to personalize your scores, news, and notifications",
  "search": "Search for a player",
  "skip": "Skip",
  "continue": "Continue",
  "softHint_one": "Pick one more for better recommendations",
  "softHint_other": "Pick {count} more for better recommendations",
  "topInCountry": "Top in {country}",
  "topWorldwide": "Top players",
  "errorLoading": "Couldn't load suggestions. Try again."
},
"notificationPrompt": {
  "title": "Never miss a match",
  "bodyWithNames": "Get notified when {names} go live or play in a final.",
  "bodyGeneric": "Get notified when your players go live or play in a final.",
  "enable": "Enable notifications",
  "later": "Maybe later"
},
"welcomeStrip": {
  "title": "Welcome to PadelNachos",
  "followingCount_one": "Following 1 player",
  "followingCount_other": "Following {count} players",
  "syncHint": "Sign in anytime to keep them across devices",
  "dismiss": "Dismiss"
},
"loginCta": {
  "title": "Save your favorites",
  "bodyWithCount_one": "You're following 1 player. Sign in to keep them across devices.",
  "bodyWithCount_other": "You're following {count} items. Sign in to keep them across devices.",
  "later": "Maybe later",
  "signIn": "Sign in"
},
"suggestedPlayers": {
  "sectionTitle": "Suggested for you",
  "more": "More"
}
```

- [ ] **Step 2: Remove the old `onboarding` namespace from `en.json`**

Delete the entire `"onboarding": { ... }` block from `en.json`. (The keys: `step1Title`, `step1Desc`, `step2Title`, `step2Desc`, `step3Title`, `step3Desc`, `next`, `done`, `skip` — all of them.)

- [ ] **Step 3: Verify nothing else uses `onboarding.*`**

Run: `grep -rn "useTranslations('onboarding')" src/`
Expected: only `SpotlightCoachmarks.tsx` (which gets deleted in Task 11).

If any other file matches, stop and remove the `onboarding.*` deletion — those references would break. (None expected per current codebase.)

- [ ] **Step 4: Translate to es / pt / it / fr**

For each of `src/messages/{es,pt,it,fr}.json`:
- Remove the `onboarding` namespace block.
- Add the same five new namespaces with locale-appropriate translations. Use existing translations in the same file as a tone reference.

Concrete strings to translate (English source above):

| Key | en | es | pt | it | fr |
|---|---|---|---|---|---|
| picker.title | Who do you follow? | ¿A quién sigues? | Quem você segue? | Chi segui? | Qui suivez-vous ? |
| picker.subtitle | Pick at least one player to personalize your scores, news, and notifications | Elige al menos un jugador para personalizar resultados, noticias y notificaciones | Escolha pelo menos um jogador para personalizar pontuações, notícias e notificações | Scegli almeno un giocatore per personalizzare punteggi, notizie e notifiche | Choisissez au moins un joueur pour personnaliser scores, actualités et notifications |
| picker.search | Search for a player | Buscar jugador | Procurar jogador | Cerca un giocatore | Rechercher un joueur |
| picker.skip | Skip | Omitir | Pular | Salta | Passer |
| picker.continue | Continue | Continuar | Continuar | Continua | Continuer |
| picker.softHint_one | Pick one more for better recommendations | Elige uno más para mejores recomendaciones | Escolha mais um para melhores recomendações | Scegline un altro per consigli migliori | Choisissez-en un de plus pour de meilleures recommandations |
| picker.softHint_other | Pick {count} more for better recommendations | Elige {count} más para mejores recomendaciones | Escolha mais {count} para melhores recomendações | Scegline altri {count} per consigli migliori | Choisissez-en {count} de plus pour de meilleures recommandations |
| picker.topInCountry | Top in {country} | Mejores en {country} | Melhores em {country} | Top in {country} | Meilleurs en {country} |
| picker.topWorldwide | Top players | Mejores jugadores | Melhores jogadores | Migliori giocatori | Meilleurs joueurs |
| picker.errorLoading | Couldn't load suggestions. Try again. | No se pudieron cargar sugerencias. Inténtalo de nuevo. | Não foi possível carregar sugestões. Tente de novo. | Impossibile caricare i suggerimenti. Riprova. | Impossible de charger les suggestions. Réessayez. |
| notificationPrompt.title | Never miss a match | No te pierdas ningún partido | Não perca nenhuma partida | Non perdere mai una partita | Ne ratez aucun match |
| notificationPrompt.bodyWithNames | Get notified when {names} go live or play in a final. | Recibe alertas cuando {names} jueguen en directo o en una final. | Receba avisos quando {names} jogarem ao vivo ou em uma final. | Ricevi notifiche quando {names} giocano dal vivo o in finale. | Soyez alerté quand {names} jouent en direct ou en finale. |
| notificationPrompt.bodyGeneric | Get notified when your players go live or play in a final. | Recibe alertas cuando tus jugadores jueguen en directo o en una final. | Receba avisos quando seus jogadores jogarem ao vivo ou em uma final. | Ricevi notifiche quando i tuoi giocatori giocano dal vivo o in finale. | Soyez alerté quand vos joueurs jouent en direct ou en finale. |
| notificationPrompt.enable | Enable notifications | Activar notificaciones | Ativar notificações | Attiva le notifiche | Activer les notifications |
| notificationPrompt.later | Maybe later | Quizá más tarde | Talvez depois | Forse più tardi | Plus tard |
| welcomeStrip.title | Welcome to PadelNachos | Bienvenido a PadelNachos | Bem-vindo ao PadelNachos | Benvenuto in PadelNachos | Bienvenue sur PadelNachos |
| welcomeStrip.followingCount_one | Following 1 player | Sigues 1 jugador | Seguindo 1 jogador | Stai seguendo 1 giocatore | Vous suivez 1 joueur |
| welcomeStrip.followingCount_other | Following {count} players | Sigues {count} jugadores | Seguindo {count} jogadores | Stai seguendo {count} giocatori | Vous suivez {count} joueurs |
| welcomeStrip.syncHint | Sign in anytime to keep them across devices | Inicia sesión cuando quieras para guardarlos en todos tus dispositivos | Faça login a qualquer momento para mantê-los em todos os dispositivos | Accedi quando vuoi per conservarli su tutti i dispositivi | Connectez-vous quand vous voulez pour les garder sur tous vos appareils |
| welcomeStrip.dismiss | Dismiss | Descartar | Dispensar | Chiudi | Fermer |
| loginCta.title | Save your favorites | Guarda tus favoritos | Salve seus favoritos | Salva i preferiti | Sauvegardez vos favoris |
| loginCta.bodyWithCount_one | You're following 1 player. Sign in to keep them across devices. | Sigues 1 jugador. Inicia sesión para guardarlo en todos tus dispositivos. | Você está seguindo 1 jogador. Faça login para mantê-lo em todos os dispositivos. | Stai seguendo 1 giocatore. Accedi per conservarlo su tutti i dispositivi. | Vous suivez 1 joueur. Connectez-vous pour le garder sur tous vos appareils. |
| loginCta.bodyWithCount_other | You're following {count} items. Sign in to keep them across devices. | Sigues {count} elementos. Inicia sesión para guardarlos en todos tus dispositivos. | Você está seguindo {count} itens. Faça login para mantê-los em todos os dispositivos. | Stai seguendo {count} elementi. Accedi per conservarli su tutti i dispositivi. | Vous suivez {count} éléments. Connectez-vous pour les garder sur tous vos appareils. |
| loginCta.later | Maybe later | Quizá más tarde | Talvez depois | Forse più tardi | Plus tard |
| loginCta.signIn | Sign in | Iniciar sesión | Entrar | Accedi | Se connecter |
| suggestedPlayers.sectionTitle | Suggested for you | Sugeridos para ti | Sugeridos para você | Suggeriti per te | Suggérés pour vous |
| suggestedPlayers.more | More | Más | Mais | Altri | Plus |

- [ ] **Step 5: Validate JSON parses**

Run: `for f in src/messages/{en,es,pt,it,fr}.json; do node -e "JSON.parse(require('fs').readFileSync('$f', 'utf8')); console.log('$f ok')" || echo "$f BROKEN"; done`
Expected: 5 lines of "ok".

- [ ] **Step 6: Commit**

```bash
git add src/messages/
git commit -m "$(cat <<'EOF'
i18n: add picker / notification / welcome / login-cta keys; remove onboarding

Adds five new namespaces across all 5 locales (en/es/pt/it/fr) for the
upcoming player picker onboarding flow. Removes the old onboarding.*
namespace used only by SpotlightCoachmarks (which is removed in a follow-up).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: NotificationPromptSheet component

**Why:** Single consolidated push permission prompt shown after picker Continue. Replaces N stacked per-follow CTAs.

**Files:**
- Create: `src/app/[locale]/(app)/welcome/NotificationPromptSheet.tsx`

- [ ] **Step 1: Write the component**

Create the file with:

```tsx
'use client'
// Bottom sheet shown once after the picker Continue, before navigating to home.
// Single consolidated push-permission prompt — replaces N stacked per-follow toasts.

import { useTranslations } from 'next-intl'

const GREEN = '#7ED321'
const CHUNKY = {
  card: 'polygon(0% 4%, 100% 0%, 100% 100%, 0% 100%)',
  button: 'polygon(1% 6%, 99% 0%, 100% 94%, 0% 100%)',
  badge: 'polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)',
}

interface Props {
  /** Up to 3 names to render in the body copy. Empty array → uses generic body. */
  pickedNames: string[]
  onResolve: (granted: boolean) => void
}

export function NotificationPromptSheet({ pickedNames, onResolve }: Props) {
  const t = useTranslations('notificationPrompt')

  const handleEnable = async () => {
    try {
      localStorage.setItem('pn_push_prompted', '1')
    } catch {}
    let granted = false
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        const result = await Notification.requestPermission()
        granted = result === 'granted'
      } else {
        granted = 'Notification' in window && Notification.permission === 'granted'
      }
    } catch { /* permission API may throw on iOS PWA edge cases */ }
    onResolve(granted)
  }

  const handleLater = () => {
    try {
      localStorage.setItem('pn_push_prompted', '1')
    } catch {}
    onResolve(false)
  }

  const top3 = pickedNames.slice(0, 3)
  const body =
    top3.length > 0
      ? t('bodyWithNames', { names: top3.join(', ') })
      : t('bodyGeneric')

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 500,
          background: 'linear-gradient(180deg, #1E1E1E, #161616)',
          borderTop: `2px solid ${GREEN}`,
          padding: '22px 18px 28px',
          clipPath: CHUNKY.card,
          color: '#fff',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{
          width: 44, height: 44, margin: '0 auto 12px',
          background: 'rgba(126,211,33,0.15)',
          border: `1.5px solid ${GREEN}`,
          clipPath: CHUNKY.badge,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
          </svg>
        </div>
        <h3 style={{ fontSize: 17, fontWeight: 900, textAlign: 'center', marginBottom: 6 }}>
          {t('title')}
        </h3>
        <p style={{ fontSize: 13, color: '#aaa', textAlign: 'center', lineHeight: 1.45, marginBottom: 18 }}>
          {body}
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleLater}
            style={{
              flex: 1, padding: '12px 0',
              fontSize: 13, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5,
              background: 'rgba(255,255,255,0.05)', color: '#aaa',
              clipPath: CHUNKY.button, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('later')}
          </button>
          <button
            onClick={handleEnable}
            style={{
              flex: 1, padding: '12px 0',
              fontSize: 13, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5,
              background: GREEN, color: '#000',
              clipPath: CHUNKY.button, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('enable')}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/\[locale\]/\(app\)/welcome/NotificationPromptSheet.tsx
git commit -m "$(cat <<'EOF'
feat(welcome): add NotificationPromptSheet component

Consolidated push-permission bottom sheet shown after picker Continue.
Replaces N stacked per-follow CTAs. Sets pn_push_prompted on either
button so the existing toast CTA gate doesn't re-fire.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Player picker page (`/welcome`)

**Why:** The core deliverable. Full-screen first-launch surface that personalizes the home page in one focused interaction.

**Files:**
- Create: `src/app/[locale]/(app)/welcome/PickerCard.tsx`
- Create: `src/app/[locale]/(app)/welcome/page.tsx`

- [ ] **Step 1: Create the player card component**

Create `src/app/[locale]/(app)/welcome/PickerCard.tsx`:

```tsx
'use client'

const GREEN = '#7ED321'
const CHUNKY_CARD = 'polygon(0% 1%, 99% 0%, 100% 99%, 1% 100%)'

export interface PickerPlayer {
  id: string
  name: string
  display_name?: string | null
  country: string | null
  ranking: number | null
  avatar_url?: string | null
}

interface Props {
  player: PickerPlayer
  picked: boolean
  onToggle: (id: string) => void
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function PickerCard({ player, picked, onToggle }: Props) {
  const display = player.display_name || player.name
  return (
    <button
      type="button"
      onClick={() => onToggle(player.id)}
      aria-pressed={picked}
      style={{
        background: picked ? 'rgba(126,211,33,0.08)' : 'rgba(255,255,255,0.03)',
        border: `1.5px solid ${picked ? GREEN : 'transparent'}`,
        clipPath: CHUNKY_CARD,
        padding: '12px 8px 10px',
        textAlign: 'center',
        position: 'relative',
        cursor: 'pointer',
        transform: picked ? 'scale(0.97)' : 'scale(1)',
        transition: 'transform 0.15s, background 0.15s, border-color 0.15s',
        fontFamily: 'inherit',
        color: '#fff',
      }}
    >
      {picked && (
        <div
          aria-hidden
          style={{
            position: 'absolute', top: 4, right: 4,
            width: 18, height: 18,
            background: GREEN, color: '#000',
            borderRadius: '50%',
            fontSize: 12, fontWeight: 900,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          ✓
        </div>
      )}
      <div
        style={{
          width: 52, height: 52,
          background: player.avatar_url
            ? `url(${player.avatar_url}) center/cover`
            : 'linear-gradient(135deg, #2a2a2a, #1a1a1a)',
          border: `1.5px solid ${picked ? GREEN : 'rgba(126,211,33,0.25)'}`,
          borderRadius: '50%',
          margin: '0 auto 8px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 15, fontWeight: 800, color: GREEN,
        }}
      >
        {!player.avatar_url && initials(display)}
      </div>
      <div style={{ fontSize: 11, fontWeight: 800, lineHeight: 1.2, height: 26, overflow: 'hidden', marginBottom: 4 }}>
        {display}
      </div>
      <div style={{ fontSize: 9, color: '#888' }}>
        {player.country ?? '—'} · <span style={{ color: GREEN, fontWeight: 800 }}>#{player.ranking ?? '—'}</span>
      </div>
    </button>
  )
}
```

- [ ] **Step 2: Create the picker page**

Create `src/app/[locale]/(app)/welcome/page.tsx`:

```tsx
'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useFollowing } from '@/hooks/useFollowing'
import { PickerCard, type PickerPlayer } from './PickerCard'
import { NotificationPromptSheet } from './NotificationPromptSheet'

const GREEN = '#7ED321'
const BG_BASE = '#1A1A1A'
const CHUNKY = {
  search: 'polygon(0% 2%, 100% 0%, 100% 98%, 0% 100%)',
  button: 'polygon(1% 6%, 99% 0%, 100% 94%, 0% 100%)',
}

export default function WelcomePickerPage() {
  const t = useTranslations('picker')
  const router = useRouter()
  const { toggle, getFollowed, loaded: followingLoaded } = useFollowing()

  const [players, setPlayers] = useState<PickerPlayer[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [showPushSheet, setShowPushSheet] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Hydrate already-followed players if the user landed here with prior state
  useEffect(() => {
    if (followingLoaded) {
      setPicked(new Set(getFollowed('player')))
    }
  }, [followingLoaded, getFollowed])

  // Fetch top 30 players
  useEffect(() => {
    let cancelled = false
    fetch('/api/picker/suggested-players')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: PickerPlayer[]) => {
        if (!cancelled) setPlayers(data)
      })
      .catch(() => {
        if (!cancelled) setError(t('errorLoading'))
      })
    return () => { cancelled = true }
  }, [t])

  const togglePick = useCallback((id: string) => {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const pickedCount = picked.size
  const canContinue = pickedCount >= 1

  const softHint = useMemo(() => {
    if (pickedCount === 0 || pickedCount >= 3) return null
    const remaining = 3 - pickedCount
    return t('softHint', { count: remaining })
  }, [pickedCount, t])

  // Country boost — applied server-side already; we just split by section
  // for the visual grouping. Read country from the cookie on the client.
  const userCountry = useMemo(() => {
    if (typeof document === 'undefined') return null
    const m = document.cookie.match(/(?:^|;\s*)geo-country=([^;]+)/)
    return m ? decodeURIComponent(m[1]).toUpperCase() : null
  }, [])

  const { topInCountry, topRest } = useMemo(() => {
    if (!players || !userCountry) return { topInCountry: [], topRest: players ?? [] }
    const inC: PickerPlayer[] = []
    const rest: PickerPlayer[] = []
    for (const p of players) {
      if ((p.country ?? '').toUpperCase() === userCountry) inC.push(p)
      else rest.push(p)
    }
    return { topInCountry: inC, topRest: rest }
  }, [players, userCountry])

  const finishAndGoHome = useCallback(() => {
    try {
      localStorage.setItem('pn_picker_done', '1')
      localStorage.setItem('pn_picker_first_session', String(Date.now()))
    } catch {}
    router.replace('/home')
  }, [router])

  const handleContinue = useCallback(async () => {
    if (!canContinue || submitting) return
    setSubmitting(true)
    // Write each pick silently — single consolidated NotificationPromptSheet
    // surfaces afterwards.
    for (const id of picked) {
      await toggle('player', id, { silent: true })
    }
    // Decide whether to show the push sheet
    let shouldShow = false
    try {
      const alreadyPrompted = localStorage.getItem('pn_push_prompted') === '1'
      const browserPermission = 'Notification' in window ? Notification.permission : 'denied'
      shouldShow = !alreadyPrompted && browserPermission === 'default'
    } catch {}

    if (shouldShow) {
      setShowPushSheet(true)
    } else {
      finishAndGoHome()
    }
  }, [canContinue, submitting, picked, toggle, finishAndGoHome])

  const handleSkip = useCallback(() => {
    try { localStorage.setItem('pn_picker_done', '1') } catch {}
    router.replace('/home')
  }, [router])

  // Names of up to 3 picks for push-sheet body copy
  const pickedNames = useMemo(() => {
    if (!players) return []
    const map = new Map(players.map(p => [p.id, p.display_name || p.name]))
    return [...picked].slice(0, 3).map(id => map.get(id) ?? '').filter(Boolean)
  }, [picked, players])

  return (
    <div style={{
      background: BG_BASE,
      minHeight: '100dvh',
      maxWidth: 500,
      margin: '0 auto',
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      paddingBottom: 110, // space for sticky CTA
    }}>
      {/* Header */}
      <div style={{ padding: '28px 18px 18px', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ color: GREEN, fontSize: 13, fontWeight: 900, marginBottom: 16 }}>PadelNachos</div>
        <h1 style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.2, marginBottom: 8, letterSpacing: '-0.5px' }}>
          {t('title')}
        </h1>
        <p style={{ fontSize: 13, color: '#aaa', lineHeight: 1.45 }}>
          {t('subtitle')}
        </p>
      </div>

      {/* Search affordance — links to existing search route */}
      <div style={{ padding: '14px 16px 0' }}>
        <button
          type="button"
          onClick={() => router.push('/search')}
          style={{
            width: '100%',
            padding: '11px 14px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
            clipPath: CHUNKY.search,
            display: 'flex', alignItems: 'center', gap: 8,
            color: '#666', fontSize: 13, fontFamily: 'inherit',
            cursor: 'pointer', textAlign: 'left',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          {t('search')}
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: '18px 16px 0' }}>
        {error && (
          <div style={{ padding: 16, color: '#FF4655', fontSize: 13, textAlign: 'center' }}>
            {error}
          </div>
        )}
        {!players && !error && (
          <div style={{ padding: 32, color: '#666', fontSize: 12, textAlign: 'center' }}>…</div>
        )}
        {players && (
          <>
            {topInCountry.length > 0 && (
              <>
                <h2 style={sectionStyle}>
                  {t('topInCountry', { country: userCountry ?? '' })}
                </h2>
                <Grid players={topInCountry} picked={picked} onToggle={togglePick} />
              </>
            )}
            <h2 style={sectionStyle}>{t('topWorldwide')}</h2>
            <Grid players={topRest} picked={picked} onToggle={togglePick} />
          </>
        )}
      </div>

      {/* Sticky CTA */}
      <div style={{
        position: 'fixed',
        bottom: 0, left: '50%',
        transform: 'translateX(-50%)',
        width: '100%', maxWidth: 500,
        background: 'linear-gradient(180deg, rgba(26,26,26,0), #1A1A1A 40%)',
        padding: '32px 16px 22px',
        zIndex: 10,
      }}>
        {softHint && (
          <p style={{ textAlign: 'center', fontSize: 11, color: GREEN, marginBottom: 8 }}>
            {softHint}
          </p>
        )}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            type="button"
            onClick={handleSkip}
            style={{
              padding: '12px 18px', fontSize: 12, color: '#666',
              background: 'transparent', border: 'none',
              cursor: 'pointer', fontFamily: 'inherit',
              flexShrink: 0,
            }}
          >
            {t('skip')}
          </button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={!canContinue || submitting}
            style={{
              flex: 1, padding: '14px 0',
              background: GREEN, color: '#000',
              fontSize: 13, fontWeight: 900,
              textTransform: 'uppercase', letterSpacing: 0.6,
              clipPath: CHUNKY.button,
              border: 'none', cursor: canContinue ? 'pointer' : 'not-allowed',
              opacity: canContinue ? 1 : 0.35,
              fontFamily: 'inherit',
              transition: 'opacity 0.15s',
            }}
          >
            {t('continue')}
            {pickedCount > 0 && (
              <span style={{
                background: 'rgba(0,0,0,0.2)',
                marginLeft: 8, padding: '1px 8px',
                clipPath: 'polygon(8% 12%, 92% 0%, 100% 88%, 0% 100%)',
                fontSize: 11,
              }}>
                {pickedCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {showPushSheet && (
        <NotificationPromptSheet
          pickedNames={pickedNames}
          onResolve={() => {
            setShowPushSheet(false)
            finishAndGoHome()
          }}
        />
      )}
    </div>
  )
}

const sectionStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 900,
  textTransform: 'uppercase', letterSpacing: 0.8,
  color: '#888', margin: '18px 0 12px',
}

function Grid({
  players, picked, onToggle,
}: {
  players: PickerPlayer[]
  picked: Set<string>
  onToggle: (id: string) => void
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 10,
      marginBottom: 8,
    }}>
      {players.map(p => (
        <PickerCard
          key={p.id}
          player={p}
          picked={picked.has(p.id)}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Manual smoke test in dev**

Run: `npm run dev` (port 3002).
- Open `localhost:3002/welcome` directly. The picker should render.
- Tap players — selection state, scale, checkmark.
- Tap Skip — navigates to `/home`. Check `localStorage` — `pn_picker_done` set.
- Clear localStorage, reopen `/welcome`. Pick 1 player → Continue. Push prompt should appear (if browser is `default`) or you should land on home directly.
- Verify the picked player is in the Following tab.

If anything is broken, fix inline before committing.

- [ ] **Step 4: Commit**

```bash
git add src/app/\[locale\]/\(app\)/welcome/
git commit -m "$(cat <<'EOF'
feat(welcome): add player picker page at /welcome

Spotify-style first-launch picker. Top 30 ranked players (country-boosted
via /api/picker/suggested-players), multi-select grid, soft-hint at 1-2
picks, sticky Continue + Skip. Continue writes via useFollowing.toggle
with silent: true, then surfaces a single NotificationPromptSheet before
landing on home.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Home → /welcome redirect + existing-user gate

**Why:** New users without `pn_picker_done` go to the picker. Users who already saw the old coachmark inherit `pn_picker_done` synthetically so they never see the picker.

**Files:**
- Modify: `src/app/[locale]/(app)/home/page.tsx`

- [ ] **Step 1: Locate the home page's main `useEffect`s**

Open `src/app/[locale]/(app)/home/page.tsx`. There's a top-level `'use client'` component that already imports `useRouter` from `@/i18n/navigation`. We'll add a single short `useEffect` near the top of the component body, before existing data-fetching effects.

- [ ] **Step 2: Add the redirect effect**

Find the line where the component starts using hooks (after `const router = useRouter()` or similar — search for `useRouter`). Add the following effect right after the router/auth hooks are set up, before any data-fetching:

```ts
// First-launch picker gate. Redirects new anonymous users to /welcome once.
// Existing users who dismissed the legacy coachmark inherit pn_picker_done
// synthetically so they're never asked again.
useEffect(() => {
  if (typeof window === 'undefined') return

  // Don't redirect if user already reached the picker terminus
  if (localStorage.getItem('pn_picker_done') === '1') return

  // Legacy migration: users who completed the old SpotlightCoachmarks
  // already saw orientation; don't yank them into a new picker now.
  if (localStorage.getItem('pn_onboarding_done') === '1') {
    try { localStorage.setItem('pn_picker_done', '1') } catch {}
    return
  }

  // Don't fight the referral banner — show picker after that flow finishes.
  const refCode = new URLSearchParams(window.location.search).get('ref')
  if (refCode && !sessionStorage.getItem(`pn_welcome_dismissed_${refCode}`)) {
    return
  }

  router.replace('/welcome')
}, [router])
```

- [ ] **Step 3: Verify the import**

If `useRouter` is imported from `next/navigation` instead of `@/i18n/navigation`, change the import to `@/i18n/navigation` so the redirect respects the locale prefix. Per CLAUDE.md, all user-facing pages must use the i18n-aware Link / useRouter.

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`.
- Clear localStorage. Visit `localhost:3002/`. You should be redirected to `/welcome`.
- Set `localStorage.setItem('pn_onboarding_done', '1')`. Reload `/`. You should NOT be redirected. Verify `pn_picker_done` is now `'1'`.
- Set `pn_picker_done='1'`, clear `pn_onboarding_done`. Reload — no redirect.

- [ ] **Step 5: Commit**

```bash
git add src/app/\[locale\]/\(app\)/home/page.tsx
git commit -m "$(cat <<'EOF'
feat(home): redirect new users to /welcome picker

First-time anonymous visitors with no pn_picker_done go to the new
player picker. Users who dismissed the legacy SpotlightCoachmarks
inherit pn_picker_done synthetically so they're never asked again.
Referral-banner flow takes precedence (matches old coachmark gate).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Welcome strip on home

**Why:** Soft post-picker context line for anonymous users — explains what just happened and seeds the sign-in nudge.

**Files:**
- Create: `src/components/home/WelcomeStrip.tsx`
- Modify: `src/app/[locale]/(app)/home/page.tsx`

- [ ] **Step 1: Create the strip component**

Create `src/components/home/WelcomeStrip.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/components/AuthProvider'
import { useFollowing } from '@/hooks/useFollowing'

const GREEN = '#7ED321'
const CHUNKY = 'polygon(0% 2%, 100% 0%, 100% 98%, 0% 100%)'
const FADE_AFTER_MS = 24 * 60 * 60 * 1000 // 24h

export function WelcomeStrip() {
  const t = useTranslations('welcomeStrip')
  const { user } = useAuth()
  const { counts, loaded } = useFollowing()
  const [hidden, setHidden] = useState(true)

  // Render gate evaluated client-side after mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (user) { setHidden(true); return } // hide for authenticated users
    if (!loaded) return

    let visible = true
    try {
      const dismissed = localStorage.getItem('pn_welcome_strip_dismissed') === '1'
      const firstSession = Number(localStorage.getItem('pn_picker_first_session') ?? '0')
      const expired = firstSession > 0 && Date.now() - firstSession > FADE_AFTER_MS
      visible = !dismissed && !expired && counts.player > 0
    } catch {}
    setHidden(!visible)
  }, [user, loaded, counts.player])

  const handleDismiss = () => {
    try { localStorage.setItem('pn_welcome_strip_dismissed', '1') } catch {}
    setHidden(true)
  }

  if (hidden) return null

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(126,211,33,0.18), rgba(126,211,33,0.04))',
      border: '1px solid rgba(126,211,33,0.3)',
      padding: '10px 12px',
      margin: '12px 12px 0',
      clipPath: CHUNKY,
      display: 'flex', alignItems: 'center', gap: 10,
      color: '#fff',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 900 }}>{t('title')}</div>
        <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>
          {t('followingCount', { count: counts.player })} · {t('syncHint')}
        </div>
      </div>
      <button
        type="button"
        aria-label={t('dismiss')}
        onClick={handleDismiss}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#888', fontSize: 16, padding: '4px 6px',
          fontFamily: 'inherit',
        }}
      >
        ×
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Mount in home page**

Open `src/app/[locale]/(app)/home/page.tsx`. Add the import near the existing home-section imports:

```ts
import { WelcomeStrip } from '@/components/home/WelcomeStrip'
```

In the JSX, add `<WelcomeStrip />` near the very top of the rendered tree — above the existing `TournamentSpotlightHero` / first section. Place it inside the same wrapping container that lays out the page sections.

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`.
- Clear localStorage, go through picker, pick 1 player, Continue → home.
- Welcome strip should be visible. Click × — strip hides, doesn't return on reload.
- Clear localStorage again, run picker, then in DevTools set `pn_picker_first_session` to a timestamp 25h ago: `localStorage.setItem('pn_picker_first_session', String(Date.now() - 25*60*60*1000))`. Reload — strip should NOT render.

- [ ] **Step 4: Commit**

```bash
git add src/components/home/WelcomeStrip.tsx src/app/\[locale\]/\(app\)/home/page.tsx
git commit -m "$(cat <<'EOF'
feat(home): add WelcomeStrip post-picker context line

Anonymous-only strip shown on home after the picker completes. Auto-fades
after 24h or on dismiss. Surfaces follow count + sign-in nudge.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Suggested-players marquee on Following page

**Why:** Evergreen discovery surface — works for everyone (including users who skipped the picker, returning users with empty Following, anyone wanting to add more).

**Files:**
- Create: `src/components/following/SuggestedPlayersMarquee.tsx`
- Modify: `src/app/[locale]/(app)/following/page.tsx`

- [ ] **Step 1: Create the marquee component**

Create `src/components/following/SuggestedPlayersMarquee.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useFollowing } from '@/hooks/useFollowing'

const GREEN = '#7ED321'
const CHUNKY_CARD = 'polygon(0% 1%, 99% 0%, 100% 99%, 1% 100%)'
const CHUNKY_BTN = 'polygon(2% 8%, 98% 0%, 100% 92%, 0% 100%)'

interface SuggestedPlayer {
  id: string
  name: string
  display_name: string | null
  country: string | null
  ranking: number | null
  avatar_url: string | null
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '·'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function PlayerPill({
  p,
  followed,
  onToggle,
}: {
  p: SuggestedPlayer
  followed: boolean
  onToggle: (id: string) => void
}) {
  const display = p.display_name || p.name
  return (
    <div style={{
      flexShrink: 0,
      width: 96,
      background: 'rgba(255,255,255,0.03)',
      clipPath: CHUNKY_CARD,
      padding: '10px 8px',
      textAlign: 'center',
      color: '#fff',
    }}>
      <Link
        href={`/player/${p.id}`}
        style={{
          display: 'block', textDecoration: 'none', color: 'inherit',
        }}
      >
        <div style={{
          width: 50, height: 50,
          background: p.avatar_url ? `url(${p.avatar_url}) center/cover` : 'linear-gradient(135deg, #2a2a2a, #1a1a1a)',
          border: `1.5px solid rgba(126,211,33,${followed ? 1 : 0.25})`,
          borderRadius: '50%',
          margin: '0 auto 6px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 800, color: GREEN,
        }}>
          {!p.avatar_url && initials(display)}
        </div>
        <div style={{ fontSize: 10, fontWeight: 800, lineHeight: 1.2, height: 24, overflow: 'hidden', marginBottom: 4 }}>
          {display}
        </div>
        <div style={{ fontSize: 9, color: '#888', marginBottom: 6 }}>
          {p.country ?? '—'} · <span style={{ color: GREEN, fontWeight: 800 }}>#{p.ranking ?? '—'}</span>
        </div>
      </Link>
      <button
        type="button"
        onClick={() => onToggle(p.id)}
        style={{
          width: '100%',
          background: followed ? 'rgba(126,211,33,0.15)' : GREEN,
          color: followed ? GREEN : '#000',
          border: followed ? `1px solid rgba(126,211,33,0.3)` : 'none',
          fontSize: 9, fontWeight: 900,
          textTransform: 'uppercase', letterSpacing: 0.4,
          padding: '5px 0',
          clipPath: CHUNKY_BTN,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {followed ? '✓ Followed' : '+ Follow'}
      </button>
    </div>
  )
}

export function SuggestedPlayersMarquee() {
  const t = useTranslations('suggestedPlayers')
  const [players, setPlayers] = useState<SuggestedPlayer[] | null>(null)
  const { isFollowing, toggle } = useFollowing()

  useEffect(() => {
    let cancelled = false
    fetch('/api/picker/suggested-players')
      .then(r => (r.ok ? r.json() : []))
      .then((data: SuggestedPlayer[]) => { if (!cancelled) setPlayers(data) })
      .catch(() => { if (!cancelled) setPlayers([]) })
    return () => { cancelled = true }
  }, [])

  if (!players || players.length === 0) return null

  // Duplicate the list 2x for seamless loop
  const doubled = [...players, ...players]

  return (
    <div style={{ marginTop: 8, marginBottom: 4 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 12px', margin: '0 0 10px',
      }}>
        <div style={{
          fontSize: 11, fontWeight: 900, textTransform: 'uppercase',
          letterSpacing: 0.8, color: '#fff',
        }}>
          {t('sectionTitle')}
        </div>
        <Link href="/rankings" style={{
          fontSize: 10, color: GREEN, fontWeight: 700, textDecoration: 'none',
        }}>
          {t('more')} →
        </Link>
      </div>

      <div
        className="pn-marquee"
        style={{
          overflow: 'hidden',
          position: 'relative',
          WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)',
          maskImage: 'linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)',
        }}
      >
        <div className="pn-marquee-track" style={{
          display: 'flex',
          gap: 8,
          width: 'max-content',
          paddingLeft: 12,
          animation: 'pn-marquee-scroll 32s linear infinite',
        }}>
          {doubled.map((p, idx) => (
            <PlayerPill
              key={`${p.id}-${idx}`}
              p={p}
              followed={isFollowing('player', p.id)}
              onToggle={(id) => toggle('player', id)}
            />
          ))}
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes pn-marquee-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .pn-marquee:hover .pn-marquee-track,
        .pn-marquee:active .pn-marquee-track {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .pn-marquee-track { animation: none !important; }
        }
      `}} />
    </div>
  )
}
```

- [ ] **Step 2: Mount in Following page**

Open `src/app/[locale]/(app)/following/page.tsx`.

Add the import:
```ts
import { SuggestedPlayersMarquee } from '@/components/following/SuggestedPlayersMarquee'
```

In the JSX, near line 645 right after `<AppHeader ... />`, add `<SuggestedPlayersMarquee />`. The component handles its own visibility (returns null if no players load).

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`.
- Visit `/following`. Suggested marquee should auto-scroll right→left.
- Hover (or touch on mobile devtools) — animation pauses.
- Tap +Follow on any pill — button flips to ✓ Followed (toast pops via existing useFollowing path; this is intentional outside the picker context).
- Tap again — unfollows.
- Verify the followed player appears in the existing "Players" section below (existing behavior).
- Toggle DevTools "Emulate CSS prefers-reduced-motion: reduce" — animation should stop.

- [ ] **Step 4: Commit**

```bash
git add src/components/following/SuggestedPlayersMarquee.tsx src/app/\[locale\]/\(app\)/following/page.tsx
git commit -m "$(cat <<'EOF'
feat(following): add SuggestedPlayersMarquee evergreen discovery row

Auto-scrolling marquee at the top of the Following page. Same data source
as the picker (/api/picker/suggested-players). One-tap +Follow inline,
no overlay or navigation needed. Pauses on hover/touch, respects
prefers-reduced-motion.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Login CTA bottom sheet

**Why:** Anonymous users with meaningful follows benefit most from sign-in (cross-device sync). Triggered at 3+ follows OR 24h+1 follow.

**Files:**
- Create: `src/components/LoginCtaSheet.tsx`
- Modify: `src/app/[locale]/(app)/home/page.tsx`

- [ ] **Step 1: Create the sheet component**

Create `src/components/LoginCtaSheet.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useAuth } from '@/components/AuthProvider'
import { useFollowing } from '@/hooks/useFollowing'
import { useLoginSheet } from '@/components/LoginSheetProvider'

const GREEN = '#7ED321'
const CHUNKY_CARD = 'polygon(0% 4%, 100% 0%, 100% 100%, 0% 100%)'
const CHUNKY_BTN = 'polygon(1% 6%, 99% 0%, 100% 94%, 0% 100%)'
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

export function LoginCtaSheet() {
  const t = useTranslations('loginCta')
  const { user } = useAuth()
  const { counts, loaded } = useFollowing()
  const loginSheet = useLoginSheet()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (user) return // never for authenticated
    if (!loaded) return

    let alreadyShown = false
    let firstSession = 0
    try {
      alreadyShown = localStorage.getItem('pn_login_cta_shown') === '1'
      firstSession = Number(localStorage.getItem('pn_picker_first_session') ?? '0')
    } catch {}

    if (alreadyShown) return

    const totalFollows =
      counts.match + counts.player + counts.tournament + counts.news_source

    const has24hPlusFollow =
      firstSession > 0 &&
      Date.now() - firstSession > TWENTY_FOUR_HOURS_MS &&
      totalFollows >= 1

    const has3PlusFollows = totalFollows >= 3

    if (has3PlusFollows || has24hPlusFollow) {
      // Tiny delay so it doesn't slam in on initial load
      const id = setTimeout(() => setVisible(true), 1500)
      return () => clearTimeout(id)
    }
  }, [user, loaded, counts.match, counts.player, counts.tournament, counts.news_source])

  const dismiss = () => {
    try { localStorage.setItem('pn_login_cta_shown', '1') } catch {}
    setVisible(false)
  }

  const handleSignIn = () => {
    dismiss()
    loginSheet.open()
  }

  if (!visible) return null

  const totalFollows = counts.match + counts.player + counts.tournament + counts.news_source

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
      onClick={dismiss}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 500,
          background: 'linear-gradient(180deg, #1E1E1E, #161616)',
          borderTop: `2px solid ${GREEN}`,
          padding: '22px 18px 26px',
          clipPath: CHUNKY_CARD,
          color: '#fff',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 900, textAlign: 'center', marginBottom: 6 }}>
          {t('title')}
        </h3>
        <p style={{ fontSize: 12, color: '#aaa', textAlign: 'center', lineHeight: 1.5, marginBottom: 16 }}>
          {t('bodyWithCount', { count: totalFollows })}
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={dismiss}
            style={{
              flex: 1, padding: '11px 0',
              fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5,
              background: 'rgba(255,255,255,0.05)', color: '#aaa',
              clipPath: CHUNKY_BTN, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('later')}
          </button>
          <button
            onClick={handleSignIn}
            style={{
              flex: 1, padding: '11px 0',
              fontSize: 12, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5,
              background: GREEN, color: '#000',
              clipPath: CHUNKY_BTN, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('signIn')}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify `useLoginSheet` exists**

Run: `grep -rn "useLoginSheet" src/components/LoginSheetProvider.tsx 2>/dev/null | head -3`
Expected: at least one match exporting the hook.

If the hook is named differently (e.g., `useLoginSheetContext`), update the import. If the provider doesn't expose an `open()` method, fall back to navigating to a login route — search for how other components trigger sign-in (e.g., the BookmarkToast push CTA): `grep -rn "loginSheet\|signIn\|/login" src/components/BookmarkToast.tsx`. Adapt the `handleSignIn` call accordingly.

- [ ] **Step 3: Mount in home page**

Open `src/app/[locale]/(app)/home/page.tsx`. Add import:
```ts
import { LoginCtaSheet } from '@/components/LoginCtaSheet'
```

Add `<LoginCtaSheet />` at the very bottom of the rendered JSX tree (siblings of other modals/sheets if they exist).

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`.
- Anonymous, complete picker with 3 picks → land on home → after ~1.5s the LoginCtaSheet appears.
- Tap "Maybe later" — sheet closes. Reload home — sheet does NOT re-appear (`pn_login_cta_shown='1'`).
- Clear `pn_login_cta_shown` in DevTools. Anonymous, only 1 follow, set `pn_picker_first_session` to 25h ago. Reload home — sheet should appear (24h-rule trigger).
- Sign in → sheet should never appear (gated by `user`).

- [ ] **Step 5: Commit**

```bash
git add src/components/LoginCtaSheet.tsx src/app/\[locale\]/\(app\)/home/page.tsx
git commit -m "$(cat <<'EOF'
feat(home): add LoginCtaSheet for anonymous follow holders

Triggers at 3+ total follows OR 24h+1 follow (whichever fires first).
One-shot — sets pn_login_cta_shown so it never re-appears. Hidden for
authenticated users.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Remove SpotlightCoachmarks

**Why:** Replaced by the picker. Removed last so the redirect logic in Task 9 has time to install on existing devices.

**Files:**
- Modify: `src/app/[locale]/(app)/layout.tsx`
- Delete: `src/components/SpotlightCoachmarks.tsx`

- [ ] **Step 1: Remove the dynamic import + mount from `(app)/layout.tsx`**

Open `src/app/[locale]/(app)/layout.tsx` and:
- Delete the line: `const SpotlightCoachmarks = dynamic(() => import('@/components/SpotlightCoachmarks').then(m => ({ default: m.SpotlightCoachmarks })), { ssr: false })`
- Delete the `<SpotlightCoachmarks />` JSX line.
- If `dynamic` is no longer used, remove the `import dynamic from 'next/dynamic'` line.

- [ ] **Step 2: Confirm no other references**

Run: `grep -rn "SpotlightCoachmarks\|data-coachmark" src/`
Expected: only the SpotlightCoachmarks.tsx file itself (about to be deleted).

- [ ] **Step 3: Remove `data-coachmark` attributes**

These hooked the spotlight onto the UI. Remove them:

Run: `grep -rn 'data-coachmark' src/`

Expected matches (all in components mounted on home / nav):
- One in the search bar / header
- One on the Following bottom-nav item
- One on the profile button

For each, open the file and delete the attribute. They're orphan markers now — the picker doesn't use them.

- [ ] **Step 4: Delete the component file**

```bash
git rm src/components/SpotlightCoachmarks.tsx
```

- [ ] **Step 5: Run full typecheck + build**

```bash
npx tsc --noEmit
npm run build
```
Expected: clean. If `tsc` flags an unused import in a file you edited, clean it up.

- [ ] **Step 6: Manual final smoke test**

Run: `npm run dev` and walk through both paths:

**New user path (clear localStorage):**
1. Visit `/` → redirected to `/welcome`
2. Pick 3 players → Continue → push prompt → home
3. Welcome strip visible at top of home
4. Live/Today's matches sections include picks (verify: pick a player who has matches scheduled)
5. After ~1.5s, LoginCtaSheet appears
6. Tap "Maybe later" — closes
7. Visit `/following` — picks visible in "Players"; Suggested marquee scrolling at top
8. Tap +Follow on a marquee pill — works
9. No spotlight coachmark anywhere

**Existing user path:**
1. Clear localStorage; set `pn_onboarding_done='1'`
2. Visit `/` → no redirect, lands on home directly
3. Verify `pn_picker_done` is now `'1'`
4. No coachmark, no welcome strip (no follows yet, gating is correct)

**Sign-in migration path:**
1. Anonymous, follow 2 players via picker or marquee. Verify localStorage `pn_following.players.length === 2`.
2. Sign in. Network tab: should see 2 `POST /api/user/bookmarks` requests.
3. After load: Following page shows the same 2 players, count badge unchanged.
4. localStorage `pn_migrated_to_user_<userId>` is `'1'`.
5. Reload — no new POST requests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: remove SpotlightCoachmarks (replaced by /welcome picker)

The 3-step coachmark is replaced by the player picker for new users.
Existing users who dismissed it inherit pn_picker_done synthetically
(home redirect logic, Task 9). data-coachmark anchor attributes removed.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review (run before opening PR)

1. **Spec coverage:** All 12 acceptance criteria from the spec map to a task above:
   - Redirect to /welcome → Task 9
   - Top 30 mixed, country-boosted → Tasks 5 + 8
   - Continue persists silently → Tasks 1 + 8
   - Notification prompt fires once → Tasks 7 + 8
   - Skip lands on home, no notification sheet → Task 8
   - Personalized home sections — covered by existing home page (no spec acceptance change required, sections use `useFollowing` already)
   - Welcome strip auto-fades 24h → Task 10
   - Login CTA at 3+ or 24h+1 → Task 12
   - Suggested marquee on Following page → Task 11
   - Anon→auth migration → Tasks 3 + 4
   - Existing-user gate via pn_onboarding_done → Task 9
   - All copy localized in 5 locales → Task 6
   - SpotlightCoachmarks + i18n keys removed → Tasks 6 + 13

2. **Final test pass:**
   ```bash
   npx vitest run src/lib/__tests__/country-boost-sort.test.ts \
                  src/lib/__tests__/follow-migration.test.ts \
                  src/lib/__tests__/suggested-players-route.test.ts
   npx tsc --noEmit
   npm run build
   ```
   All green = ready for PR.

3. **PR title suggestion:** `feat: replace coachmark with player picker onboarding (+ follow migration fix)`
