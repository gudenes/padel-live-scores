# Entries + Projection Tab Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the tournament page's `Projection` tab into the `Entries` tab, so one tab labelled Entries serves the whole tournament lifecycle — the field before the draw, the full projection UI after it.

**Architecture:** `ProjectionTab` becomes the single component behind the `entries` tab key. Its existing `rows.length === 0` empty-state branch is replaced by a new `FieldView` that renders the entry list in the projection tab's visual language. Phase is derived per render from whether `tournament_projections` returned rows — never stored, and the producer-side ≥50%-of-draw rule is not reimplemented in the UI. The old `EntriesTab` and `EntryList` components are deleted. The `/projection` server routes keep their URLs (deliberate, see spec).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, next-intl (5 locales), Supabase JS, Vitest.

**Spec:** [docs/superpowers/specs/2026-09-19-entries-projection-merge-design.md](../specs/2026-09-19-entries-projection-merge-design.md)

**Branch:** `feat/entries-projection-merge` in worktree `.worktrees/entries-projection-merge`. Run every command from that worktree root.

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `src/lib/entry-field.ts` | Pure: the `FieldEntry` shape plus `partitionField` (seeded/unseeded split + ordering) and `combinedPoints` / `bestRank`. No React, no Supabase. |
| `src/lib/__tests__/entry-field.test.ts` | Tests for the above. |
| `src/lib/tab-seen.ts` | Pure: reads the "New" chip seen-state, collapsing the two legacy localStorage keys into one. |
| `src/lib/__tests__/tab-seen.test.ts` | Tests for the above. |
| `src/app/[locale]/(app)/tournaments/[id]/HeroPhoto.tsx` | The broadcast-style player photo, lifted out of `ProjectionTab` so `FieldView` can use it too. |
| `src/app/[locale]/(app)/tournaments/[id]/FieldView.tsx` | Phase-`field` UI: the field list and the pre-draw pair detail with its locked-path card. |

**Modify:**

| File | Change |
|---|---|
| `src/lib/projection-picker.ts` | Add `seedMapFromEntries` so seeds survive where `matches` is empty (the server routes). |
| `src/lib/__tests__/projection-picker.test.ts` | Tests for `seedMapFromEntries`. |
| `src/app/[locale]/(app)/tournaments/[id]/projection-url.ts` | `buildProjectionQuery` emits `tab=entries`. |
| `src/app/[locale]/(app)/tournaments/[id]/__tests__/projection-url.test.ts` | Expectations follow. |
| `src/app/[locale]/(app)/tournaments/[id]/useEntryList.ts` | Accept `null` to skip the fetch; drop the `EntryList` type import. |
| `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx` | Render `FieldView` instead of the locked empty state; fall back to entry-derived seeds. |
| `src/app/[locale]/(app)/tournaments/[id]/page.tsx` | One `entries` tab; `?tab=projection` alias; collapsed seen-key. |
| `src/app/[locale]/(app)/tournaments/[id]/projection/ProjectionRouteClient.tsx` | Tab strip shows `entries` as the active label. |
| `src/messages/{en,es,pt,it,fr}.json` | New `projectionTab.field*` keys. |

**Delete:**

- `src/app/[locale]/(app)/tournaments/[id]/EntriesTab.tsx`
- `src/components/EntryList.tsx` (only consumer is `EntriesTab`)

---

### Task 1: Pure field partition

The field list is seeded pairs first (by seed ascending), then unseeded (by combined team points descending, pairs with no points last). This is the only ordering logic in phase `field`, so it lives in a pure module and gets tested directly.

**Files:**
- Create: `src/lib/entry-field.ts`
- Test: `src/lib/__tests__/entry-field.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/entry-field.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { partitionField, combinedPoints, bestRank, type FieldEntry } from '@/lib/entry-field'

function entry(over: Partial<FieldEntry> = {}): FieldEntry {
  return {
    seed: null,
    marker: null,
    category: 'men',
    player1_id: 'p1',
    player1_name: 'One',
    player1_country: 'ES',
    player2_id: 'p2',
    player2_name: 'Two',
    player2_country: 'AR',
    team_points: null,
    ...over,
  }
}

describe('partitionField', () => {
  it('puts seeded pairs first, ordered by seed ascending', () => {
    const { seeded } = partitionField([
      entry({ seed: 3, player1_id: 'c' }),
      entry({ seed: 1, player1_id: 'a' }),
      entry({ seed: 2, player1_id: 'b' }),
    ])
    expect(seeded.map((e) => e.seed)).toEqual([1, 2, 3])
  })

  it('orders unseeded pairs by team points descending', () => {
    const { unseeded } = partitionField([
      entry({ team_points: 1200 }),
      entry({ team_points: 3400 }),
      entry({ team_points: 2200 }),
    ])
    expect(unseeded.map((e) => e.team_points)).toEqual([3400, 2200, 1200])
  })

  it('sinks unseeded pairs with no points to the bottom', () => {
    const { unseeded } = partitionField([
      entry({ team_points: null }),
      entry({ team_points: 900 }),
    ])
    expect(unseeded.map((e) => e.team_points)).toEqual([900, null])
  })

  it('splits seeded from unseeded', () => {
    const { seeded, unseeded } = partitionField([
      entry({ seed: 1 }),
      entry({ seed: null }),
      entry({ seed: 2 }),
    ])
    expect(seeded).toHaveLength(2)
    expect(unseeded).toHaveLength(1)
  })

  it('handles an empty field', () => {
    expect(partitionField([])).toEqual({ seeded: [], unseeded: [] })
  })
})

describe('combinedPoints', () => {
  it('returns the team points when present', () => {
    expect(combinedPoints(entry({ team_points: 4653 }))).toBe(4653)
  })

  it('returns null when there are no points', () => {
    expect(combinedPoints(entry({ team_points: null }))).toBe(null)
  })
})

describe('bestRank', () => {
  it('returns the lower (better) of the two rankings', () => {
    const map = { p1: { avatar_url: null, ranking: 26 }, p2: { avatar_url: null, ranking: 12 } }
    expect(bestRank(entry(), map)).toBe(12)
  })

  it('ignores a player with no ranking', () => {
    const map = { p1: { avatar_url: null, ranking: 26 }, p2: { avatar_url: null, ranking: null } }
    expect(bestRank(entry(), map)).toBe(26)
  })

  it('returns null when neither player is ranked', () => {
    expect(bestRank(entry(), {})).toBe(null)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/entry-field.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/entry-field"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/entry-field.ts`:

```ts
// src/lib/entry-field.ts
//
// Pure helpers for the pre-draw "field" phase of the Entries tab. Before the
// main draw is published there is no bracket and no projection, so the only
// ordering signal is seed (for the seeded pairs) and combined team points
// (for everyone else). Kept free of React/Supabase so it can be unit-tested.

/** One pair on the entry list. Mirrors the columns `useEntryList` selects. */
export interface FieldEntry {
  seed: number | null
  marker: string | null
  category: 'men' | 'women'
  player1_id: string | null
  player1_name: string | null
  player1_country: string | null
  player2_id: string | null
  player2_name: string | null
  player2_country: string | null
  team_points: number | null
}

export interface PlayerHydration {
  avatar_url: string | null
  ranking: number | null
}

export interface FieldPartition {
  seeded: FieldEntry[]
  unseeded: FieldEntry[]
}

/** Seeded pairs by seed asc; unseeded by combined points desc, unranked last. */
export function partitionField(entries: FieldEntry[]): FieldPartition {
  const seeded = entries
    .filter((e) => e.seed != null)
    .sort((a, b) => (a.seed as number) - (b.seed as number))
  const unseeded = entries
    .filter((e) => e.seed == null)
    .sort((a, b) => (b.team_points ?? -1) - (a.team_points ?? -1))
  return { seeded, unseeded }
}

export function combinedPoints(entry: FieldEntry): number | null {
  return entry.team_points ?? null
}

/** The better (numerically lower) of the pair's two FIP rankings. */
export function bestRank(
  entry: FieldEntry,
  playerMap: Record<string, PlayerHydration>,
): number | null {
  const ranks = [entry.player1_id, entry.player2_id]
    .map((id) => (id ? playerMap[id]?.ranking ?? null : null))
    .filter((r): r is number => r != null)
  return ranks.length > 0 ? Math.min(...ranks) : null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/entry-field.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/entry-field.ts src/lib/__tests__/entry-field.test.ts
git commit -m "feat(entries): pure field partition helpers for the pre-draw phase"
```

---

### Task 2: Seeds from entries

`ProjectionRouteClient` passes `matches={[]}`, so `buildSeedMap` finds nothing and the server routes render no `#N` chips. Phase `field` is entirely seed-ordered, so it needs a second source: `tournament_entries.seed`.

**Files:**
- Modify: `src/lib/projection-picker.ts`
- Test: `src/lib/__tests__/projection-picker.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/projection-picker.test.ts`:

```ts
describe('seedMapFromEntries', () => {
  it('maps a pair key to its seed', () => {
    const map = seedMapFromEntries([
      { seed: 1, player1_id: 'b', player2_id: 'a' },
    ])
    expect(map.get(pairKeyFromIds('a', 'b'))).toBe(1)
  })

  it('is order-independent on the two player ids', () => {
    const map = seedMapFromEntries([{ seed: 4, player1_id: 'z', player2_id: 'y' }])
    expect(map.get(pairKeyFromIds('y', 'z'))).toBe(4)
    expect(map.get(pairKeyFromIds('z', 'y'))).toBe(4)
  })

  it('skips unseeded entries', () => {
    const map = seedMapFromEntries([{ seed: null, player1_id: 'a', player2_id: 'b' }])
    expect(map.size).toBe(0)
  })

  it('skips entries missing a player id', () => {
    const map = seedMapFromEntries([
      { seed: 2, player1_id: 'a', player2_id: null },
      { seed: 3, player1_id: null, player2_id: 'b' },
    ])
    expect(map.size).toBe(0)
  })

  it('returns an empty map for no entries', () => {
    expect(seedMapFromEntries([]).size).toBe(0)
  })
})
```

And extend the import at the top of that file to:

```ts
import { buildSeedMap, isQualifyingRound, orderPickerPairs, pairKeyFromIds, seedMapFromEntries } from '@/lib/projection-picker'
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/projection-picker.test.ts`
Expected: FAIL — `seedMapFromEntries is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/projection-picker.ts`:

```ts
/** Minimal shape needed to read a seed off an entry-list row. */
export interface SeedBearingEntry {
  seed: number | null
  player1_id: string | null
  player2_id: string | null
}

/** pair_key → seed, derived from `tournament_entries`. Used where `matches` is
 *  empty (the /projection server routes) and pre-draw, where no match rows
 *  exist yet at all. Entry-list seeds are main-draw seeds by construction, so
 *  there is no qualifying-seed leak to guard against here. */
export function seedMapFromEntries(entries: SeedBearingEntry[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const e of entries) {
    if (e.seed == null || !e.player1_id || !e.player2_id) continue
    map.set(pairKeyFromIds(e.player1_id, e.player2_id), e.seed)
  }
  return map
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/projection-picker.test.ts`
Expected: PASS — all pre-existing tests plus 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/projection-picker.ts src/lib/__tests__/projection-picker.test.ts
git commit -m "feat(entries): derive the picker seed map from tournament_entries"
```

---

### Task 3: Collapse the two "New" chip keys

Today two localStorage keys track whether the user has seen each tab's "New" chip. After the merge there is one tab, so someone who already opened *either* tab must not be re-nudged.

**Files:**
- Create: `src/lib/tab-seen.ts`
- Test: `src/lib/__tests__/tab-seen.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/tab-seen.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ENTRIES_TAB_SEEN_KEY, readEntriesTabSeen } from '@/lib/tab-seen'

function store(values: Record<string, string>) {
  return (key: string) => values[key] ?? null
}

describe('readEntriesTabSeen', () => {
  it('is seen when the entries key is set', () => {
    expect(readEntriesTabSeen(store({ entry_list_tab_seen: '1' }))).toBe(true)
  })

  it('is seen when only the legacy projection key is set', () => {
    expect(readEntriesTabSeen(store({ projection_tab_seen: '1' }))).toBe(true)
  })

  it('is unseen when neither key is set', () => {
    expect(readEntriesTabSeen(store({}))).toBe(false)
  })

  it('ignores a key set to something other than "1"', () => {
    expect(readEntriesTabSeen(store({ entry_list_tab_seen: '0' }))).toBe(false)
  })

  it('survives a throwing storage accessor', () => {
    expect(readEntriesTabSeen(() => { throw new Error('denied') })).toBe(false)
  })

  it('exposes the surviving write key', () => {
    expect(ENTRIES_TAB_SEEN_KEY).toBe('entry_list_tab_seen')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/tab-seen.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/tab-seen"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/tab-seen.ts`:

```ts
// src/lib/tab-seen.ts
//
// "New" chip state for the merged Entries tab. Before the merge, Entries and
// Projection each had their own localStorage flag. Someone who opened either
// one has already discovered the tab, so both keys count as seen — but only
// the entries key is written from here on.

export const ENTRIES_TAB_SEEN_KEY = 'entry_list_tab_seen'
const LEGACY_PROJECTION_SEEN_KEY = 'projection_tab_seen'

/** Pass a localStorage-like getter. Safe against Safari private-mode throws. */
export function readEntriesTabSeen(getItem: (key: string) => string | null): boolean {
  try {
    return getItem(ENTRIES_TAB_SEEN_KEY) === '1' || getItem(LEGACY_PROJECTION_SEEN_KEY) === '1'
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/tab-seen.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tab-seen.ts src/lib/__tests__/tab-seen.test.ts
git commit -m "feat(entries): collapse the two New-chip seen keys into one"
```

---

### Task 4: In-page URL emits `tab=entries`

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/projection-url.ts:6-12`
- Test: `src/app/[locale]/(app)/tournaments/[id]/__tests__/projection-url.test.ts`

- [ ] **Step 1: Update the test to the new expectation**

Replace the `describe('buildProjectionQuery', ...)` block in `src/app/[locale]/(app)/tournaments/[id]/__tests__/projection-url.test.ts` with:

```ts
describe('buildProjectionQuery', () => {
  it('builds a tab+category query with no pair', () => {
    expect(buildProjectionQuery('men', null)).toBe('?tab=entries&category=men')
  })

  it('builds a tab+category query for women', () => {
    expect(buildProjectionQuery('women', null)).toBe('?tab=entries&category=women')
  })

  it('appends the pair slug when present', () => {
    expect(buildProjectionQuery('men', 'arce-tello')).toBe('?tab=entries&category=men&pair=arce-tello')
  })

  it('omits the pair param when slug is empty string', () => {
    expect(buildProjectionQuery('men', '')).toBe('?tab=entries&category=men')
  })

  it('url-encodes a slug with unusual characters', () => {
    expect(buildProjectionQuery('men', 'a b')).toBe('?tab=entries&category=men&pair=a%20b')
  })
})
```

Leave the rest of the file (share-URL and share-payload tests) untouched.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run "src/app/[locale]/(app)/tournaments/[id]/__tests__/projection-url.test.ts"`
Expected: FAIL — 5 failures, each `expected '?tab=projection&category=men' to be '?tab=entries&category=men'`.

- [ ] **Step 3: Update the implementation**

In `src/app/[locale]/(app)/tournaments/[id]/projection-url.ts`, replace the leading comment and `buildProjectionQuery` with:

```ts
// Pure builder for the in-page Entries tab query string. Used by the
// tournament page to shallow-sync the active projection view into the URL
// (?tab=entries&category=<cat>[&pair=<slug>]) so it's deep-linkable
// without a route navigation. NB the *tab* is `entries`; the standalone SEO
// route is still /projection/<slug> — see the merge design doc for why the
// label and the URL noun deliberately differ.

export function buildProjectionQuery(
  category: 'men' | 'women',
  pairSlug: string | null,
): string {
  const base = `?tab=entries&category=${category}`
  return pairSlug ? `${base}&pair=${encodeURIComponent(pairSlug)}` : base
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run "src/app/[locale]/(app)/tournaments/[id]/__tests__/projection-url.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/projection-url.ts" "src/app/[locale]/(app)/tournaments/[id]/__tests__/projection-url.test.ts"
git commit -m "feat(entries): in-page projection URL syncs ?tab=entries"
```

---

### Task 5: Translations for the field phase

Twelve new keys in the `projectionTab` namespace, across all five locales. Two of them (`fieldError`, `fieldEmpty`) replace the hardcoded English strings currently sitting in `EntriesTab.tsx`.

**Files:**
- Modify: `src/messages/en.json`, `src/messages/es.json`, `src/messages/pt.json`, `src/messages/it.json`, `src/messages/fr.json`

- [ ] **Step 1: Add the keys to every locale**

Insert these key/value pairs into the `projectionTab` object of each file. Key order within the object does not matter; keep them together as a block for readability.

`src/messages/en.json`:

```json
    "fieldTitle": "Who's in the hunt",
    "fieldSubtitle": "{count} pairs entered",
    "fieldOddsNote": "Odds open when the draw is released.",
    "fieldOddsNoteBody": "Until then, this is the field by ranking.",
    "fieldSeeded": "The field · Seeded",
    "fieldUnseeded": "Unseeded",
    "fieldCombined": "Combined",
    "fieldBestRank": "Best rank",
    "fieldPathLocked": "Path locked",
    "fieldPathLockedBody": "Opens when the main draw is released.",
    "fieldError": "Couldn't load the entry list. Try again.",
    "fieldEmpty": "The entry list for this event is being prepared. Check back soon."
```

`src/messages/es.json`:

```json
    "fieldTitle": "Quién va a por el título",
    "fieldSubtitle": "{count} parejas inscritas",
    "fieldOddsNote": "Las probabilidades se abren cuando salga el cuadro.",
    "fieldOddsNoteBody": "Hasta entonces, este es el cuadro de inscritos por ranking.",
    "fieldSeeded": "Inscritos · Cabezas de serie",
    "fieldUnseeded": "Sin cabeza de serie",
    "fieldCombined": "Combinados",
    "fieldBestRank": "Mejor ranking",
    "fieldPathLocked": "Camino bloqueado",
    "fieldPathLockedBody": "Se abre cuando salga el cuadro principal.",
    "fieldError": "No se pudo cargar la lista de inscritos. Inténtalo de nuevo.",
    "fieldEmpty": "La lista de inscritos de este evento se está preparando. Vuelve pronto."
```

`src/messages/pt.json`:

```json
    "fieldTitle": "Quem está na caça ao título",
    "fieldSubtitle": "{count} duplas inscritas",
    "fieldOddsNote": "As probabilidades abrem quando a chave sair.",
    "fieldOddsNoteBody": "Até lá, esta é a lista de inscritos por ranking.",
    "fieldSeeded": "Inscritos · Cabeças de chave",
    "fieldUnseeded": "Sem cabeça de chave",
    "fieldCombined": "Combinados",
    "fieldBestRank": "Melhor ranking",
    "fieldPathLocked": "Caminho bloqueado",
    "fieldPathLockedBody": "Abre quando a chave principal for divulgada.",
    "fieldError": "Não foi possível carregar a lista de inscritos. Tente novamente.",
    "fieldEmpty": "A lista de inscritos deste evento está sendo preparada. Volte em breve."
```

`src/messages/it.json`:

```json
    "fieldTitle": "Chi punta al titolo",
    "fieldSubtitle": "{count} coppie iscritte",
    "fieldOddsNote": "Le probabilità si aprono quando esce il tabellone.",
    "fieldOddsNoteBody": "Fino ad allora, questo è l'elenco degli iscritti per ranking.",
    "fieldSeeded": "Iscritti · Teste di serie",
    "fieldUnseeded": "Senza testa di serie",
    "fieldCombined": "Combinati",
    "fieldBestRank": "Miglior ranking",
    "fieldPathLocked": "Percorso bloccato",
    "fieldPathLockedBody": "Si apre quando viene pubblicato il tabellone principale.",
    "fieldError": "Impossibile caricare l'elenco degli iscritti. Riprova.",
    "fieldEmpty": "L'elenco degli iscritti per questo evento è in preparazione. Torna presto."
```

`src/messages/fr.json`:

```json
    "fieldTitle": "Qui vise le titre",
    "fieldSubtitle": "{count} paires inscrites",
    "fieldOddsNote": "Les probabilités s'ouvrent à la sortie du tableau.",
    "fieldOddsNoteBody": "D'ici là, voici les inscrits classés par ranking.",
    "fieldSeeded": "Inscrits · Têtes de série",
    "fieldUnseeded": "Sans tête de série",
    "fieldCombined": "Cumulés",
    "fieldBestRank": "Meilleur classement",
    "fieldPathLocked": "Parcours verrouillé",
    "fieldPathLockedBody": "S'ouvre à la publication du tableau principal.",
    "fieldError": "Impossible de charger la liste des inscrits. Réessayez.",
    "fieldEmpty": "La liste des inscrits de cet événement est en préparation. Revenez bientôt."
```

- [ ] **Step 2: Verify every locale parses and has all twelve keys**

Run:

```bash
node -e "
const ks=['fieldTitle','fieldSubtitle','fieldOddsNote','fieldOddsNoteBody','fieldSeeded','fieldUnseeded','fieldCombined','fieldBestRank','fieldPathLocked','fieldPathLockedBody','fieldError','fieldEmpty'];
for (const l of ['en','es','pt','it','fr']) {
  const p = require('./src/messages/'+l+'.json').projectionTab;
  const missing = ks.filter(k => !(k in p));
  console.log(l, missing.length ? 'MISSING '+missing.join(',') : 'ok');
}"
```

Expected: five lines, each `<locale> ok`.

- [ ] **Step 3: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "i18n(entries): field-phase strings for the merged Entries tab"
```

---

### Task 6: Extract HeroPhoto

`FieldView` needs the same broadcast-style player photo the road view uses. It is currently a private function inside `ProjectionTab.tsx`. Move it to its own file with no behaviour change.

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/HeroPhoto.tsx`
- Modify: `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx:57-75` (remove), `:1-22` (add import)

- [ ] **Step 1: Create the extracted component**

Create `src/app/[locale]/(app)/tournaments/[id]/HeroPhoto.tsx`:

```tsx
'use client'
import Avatar from '@/components/Avatar'
import { Link } from '@/i18n/navigation'

// Player image for the hero banner; links to the player profile.
// Prefers the full-body `photoUrl`; when a player has no body shot, falls back
// to the smaller circular headshot (then Avatar's own initial fallback) so the
// banner degrades gracefully instead of showing a giant letter. `overlap`
// slides this photo over the previous one (broadcast-style).
export default function HeroPhoto({ id, name, photoUrl, avatarUrl, overlap }: {
  id: string
  name: string
  photoUrl: string | null
  avatarUrl: string | null
  overlap?: boolean
}) {
  return (
    <Link href={`/player/${id}`} aria-label={name} style={{ display: 'block', lineHeight: 0, flexShrink: 0, marginLeft: overlap ? -38 : 0 }}>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={name} style={{ height: 130, width: 'auto', objectFit: 'cover', objectPosition: 'top center', display: 'block' }} />
      ) : (
        <div style={{ height: 130, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 12 }}>
          <Avatar src={avatarUrl} alt={name} size={82} fallback={name?.[0]} unoptimized style={{ border: '2px solid rgba(255,255,255,0.12)' }} />
        </div>
      )}
    </Link>
  )
}
```

- [ ] **Step 2: Remove the inline copy from ProjectionTab**

In `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx`, delete the whole `function HeroPhoto(...)` block including its leading comment (currently lines 57–75), and add this import next to the other local imports (after the `ProjectionExplainSheet` import on line 10):

```tsx
import HeroPhoto from './HeroPhoto'
```

- [ ] **Step 3: Verify nothing broke**

Run: `npx tsc --noEmit`
Expected: no errors mentioning `HeroPhoto` or `ProjectionTab`.

Run: `npx vitest run "src/app/[locale]/(app)/tournaments/[id]/__tests__/ProjectionTab.slug-sync.test.tsx"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/HeroPhoto.tsx" "src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx"
git commit -m "refactor(projection): extract HeroPhoto so the field view can reuse it"
```

---

### Task 7: Let useEntryList skip its fetch

`ProjectionTab` will only need entries in two situations: the field phase, and the server routes (where `matches` is empty and seeds must come from entries). Everywhere else the fetch is waste, so the hook gains a null-skip, mirroring `useHasEntries` in the same file.

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/useEntryList.ts:60-64` and `:5`

- [ ] **Step 1: Change the signature and add the skip**

In `src/app/[locale]/(app)/tournaments/[id]/useEntryList.ts`:

Replace the import on line 5:

```ts
import type { FieldEntry, PlayerHydration } from '@/lib/entry-field'
```

Replace the `EntryListState` interface with:

```ts
export interface EntryListState {
  entries: FieldEntry[]
  playerMap: Record<string, PlayerHydration>
  loading: boolean
  error: boolean
}
```

Replace the function signature and add an early skip as the first thing inside the effect:

```ts
/** Reads tournament_entries (RLS public read) + hydrates player avatars/rankings.
 *  Pass null to skip the fetch entirely (e.g. when the projection rows already
 *  cover the view and no entry data is needed). */
export function useEntryList(tournamentId: string | null): EntryListState {
  const [state, setState] = useState<EntryListState>({ entries: [], playerMap: {}, loading: true, error: false })

  useEffect(() => {
    if (!tournamentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- skip path, no fetch
      setState({ entries: [], playerMap: {}, loading: false, error: false })
      return
    }
    let cancelled = false
```

Then in the body, replace the `entries` mapping (which currently synthesizes `draw_position`) with:

```ts
      // Ordering now lives in `partitionField` (src/lib/entry-field.ts) — the
      // old synthesized `draw_position` ordinal went away with EntryList.
      const entries: FieldEntry[] = rows.map((r) => ({
        seed: r.seed,
        marker: r.marker,
        category: r.category,
        player1_name: r.player1_name,
        player1_country: r.player1_country,
        player1_id: r.player1_id,
        player2_name: r.player2_name,
        player2_country: r.player2_country,
        player2_id: r.player2_id,
        team_points: r.team_points,
      }))
```

Delete the now-unused `strength` and `sorted` lines immediately above it.

- [ ] **Step 2: Verify the file still type-checks in isolation**

Run: `npx tsc --noEmit 2>&1 | grep -E "useEntryList|EntriesTab" || echo "no errors in these files"`
Expected: errors pointing at `EntriesTab.tsx` (it still expects `draw_position`) — that is fine and gets resolved in Task 11. No errors inside `useEntryList.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/useEntryList.ts"
git commit -m "refactor(entries): useEntryList returns FieldEntry and accepts a null skip"
```

---

### Task 8: Build FieldView

The phase-`field` UI: a header, the odds-open note, the seeded/unseeded lists, and a pair detail with hero banner, two stat cards, and the locked-path card.

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/FieldView.tsx`

- [ ] **Step 1: Write the component**

Create `src/app/[locale]/(app)/tournaments/[id]/FieldView.tsx`:

```tsx
'use client'
import { useMemo, useState, type CSSProperties } from 'react'
import { useTranslations } from 'next-intl'
import Avatar from '@/components/Avatar'
import { FlagImage } from '@/components/FlagImage'
import { Link } from '@/i18n/navigation'
import { partitionField, combinedPoints, bestRank, type FieldEntry, type PlayerHydration } from '@/lib/entry-field'
import { LIME, GOLD } from '@/lib/projection-view'
import HeroPhoto from './HeroPhoto'
import { usePairImages } from './usePairImages'

const TEXT = '#EEE4CE'
const MUTED = '#6B7280'
const SECONDARY = '#9AAEC4'
const CARD = 'rgba(255,255,255,0.03)'
const CHUNK_CARD = 'polygon(0% 4%, 99.5% 0%, 100% 96%, 0.5% 100%)'
const BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'
const MONO = 'ui-monospace, "SF Mono", monospace'

function surnames(entry: FieldEntry): string {
  return [entry.player1_name, entry.player2_name]
    .filter(Boolean)
    .map((n) => (n as string).split(' ').slice(-1)[0] || (n as string))
    .join(' / ')
}

/** Stable identity for an entry row — the two player ids, or the names when
 *  padelgod hasn't resolved the players to rows yet. */
function entryKey(entry: FieldEntry): string {
  return `${entry.player1_id ?? entry.player1_name ?? '?'}::${entry.player2_id ?? entry.player2_name ?? '?'}`
}

function EntryRow({ entry, playerMap, rank, onPick }: {
  entry: FieldEntry
  playerMap: Record<string, PlayerHydration>
  rank: number | null
  onPick: () => void
}) {
  const p1 = entry.player1_id ? playerMap[entry.player1_id] : undefined
  const p2 = entry.player2_id ? playerMap[entry.player2_id] : undefined
  const points = combinedPoints(entry)
  const ring = { border: '2px solid var(--bg-card)', boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick() } }}
      style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', background: CARD, border: '1px solid rgba(255,255,255,0.07)', padding: '10px 12px', clipPath: CHUNK_CARD, marginBottom: 6 }}
    >
      {rank != null && (
        <span style={{ fontFamily: MONO, fontSize: 17, fontWeight: 900, color: GOLD, flexShrink: 0, minWidth: 18 }}>{rank}</span>
      )}
      <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <div style={{ position: 'relative', zIndex: 2 }}>
          <Avatar src={p1?.avatar_url ?? null} alt={entry.player1_name ?? ''} size={30} fallback={entry.player1_name?.[0]} unoptimized style={ring} />
        </div>
        <div style={{ position: 'relative', zIndex: 1, marginLeft: -9 }}>
          <Avatar src={p2?.avatar_url ?? null} alt={entry.player2_name ?? ''} size={30} fallback={entry.player2_name?.[0]} unoptimized style={ring} />
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: TEXT, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{surnames(entry)}</div>
        <div style={{ color: SECONDARY, fontSize: 10, fontWeight: 600, marginTop: 1 }}>
          {[p1?.ranking, p2?.ranking].filter((r) => r != null).map((r) => `#${r}`).join(' · ') || ' '}
        </div>
      </div>
      {points != null && (
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 800, color: TEXT, lineHeight: 1 }}>{points.toLocaleString()}</div>
          <div style={{ color: MUTED, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 2 }}>PTS</div>
        </div>
      )}
    </div>
  )
}

const SECTION_LABEL: CSSProperties = {
  color: SECONDARY, fontSize: 10, fontWeight: 800, textTransform: 'uppercase',
  letterSpacing: 0.8, margin: '2px 0 8px 2px',
}

export default function FieldView({ entries, playerMap, loading, error }: {
  entries: FieldEntry[]
  playerMap: Record<string, PlayerHydration>
  loading: boolean
  error: boolean
}) {
  const t = useTranslations('projectionTab')
  const [selected, setSelected] = useState<string | null>(null)

  const { seeded, unseeded } = useMemo(() => partitionField(entries), [entries])
  const selectedEntry = useMemo(
    () => entries.find((e) => entryKey(e) === selected) ?? null,
    [entries, selected],
  )
  // Full-body photos for the hero banner. Only the selected pair is fetched.
  const heroIds = useMemo(
    () => (selectedEntry ? [selectedEntry.player1_id, selectedEntry.player2_id].filter(Boolean) as string[] : []),
    [selectedEntry],
  )
  const heroImages = usePairImages(heroIds)

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: MUTED, fontSize: 12 }}>…</div>
  }

  if (error) {
    return <div style={{ padding: '32px 16px', textAlign: 'center', color: MUTED, fontSize: 13 }}>{t('fieldError')}</div>
  }

  if (entries.length === 0) {
    return <div style={{ padding: '32px 16px', textAlign: 'center', color: MUTED, fontSize: 13 }}>{t('fieldEmpty')}</div>
  }

  // ── Pair detail: hero + stats + locked path ──────────────────
  if (selectedEntry) {
    const players = [
      { id: selectedEntry.player1_id, name: selectedEntry.player1_name, country: selectedEntry.player1_country },
      { id: selectedEntry.player2_id, name: selectedEntry.player2_name, country: selectedEntry.player2_country },
    ].filter((p) => p.name)
    const points = combinedPoints(selectedEntry)
    const rank = bestRank(selectedEntry, playerMap)
    return (
      <div key={`field-detail-${selected}`} className="projection-cascade" style={{ padding: '14px 13px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 0 10px 2px' }}>
          <button onClick={() => setSelected(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: SECONDARY, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, padding: 0 }}>
            ‹ {t('back')}
          </button>
        </div>

        <div style={{ position: 'relative', display: 'flex', alignItems: 'stretch', minHeight: 130, overflow: 'hidden', marginBottom: 16, background: 'linear-gradient(135deg, #0d0d0d 0%, #1e1e1e 58%, #131313 100%)', border: '1px solid rgba(255,255,255,0.08)', clipPath: 'polygon(0 7%, 99% 0, 100% 93%, 1% 100%)' }}>
          <div style={{ position: 'absolute', left: 30, top: '50%', width: 175, height: 175, transform: 'translateY(-50%)', background: 'radial-gradient(circle, rgba(126,211,33,0.22), transparent 68%)', pointerEvents: 'none' }} />
          <div style={{ position: 'relative', zIndex: 1, width: 122, flexShrink: 0, display: 'flex', alignItems: 'flex-end' }}>
            {players.map((p, i) => {
              const img = p.id ? heroImages.get(p.id) : undefined
              const avatar = (p.id ? playerMap[p.id]?.avatar_url : null) ?? img?.avatarUrl ?? null
              if (!p.id) return null
              return <HeroPhoto key={p.id} id={p.id} name={p.name as string} photoUrl={img?.photoUrl ?? null} avatarUrl={avatar} overlap={i > 0} />
            })}
          </div>
          <div style={{ position: 'relative', zIndex: 1, flex: 1, minWidth: 0, padding: '12px 11px 12px 6px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 7 }}>
            {selectedEntry.seed != null && (
              <div style={{ fontFamily: MONO, fontSize: 30, fontWeight: 900, color: TEXT, lineHeight: 0.9 }}>#{selectedEntry.seed}</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: selectedEntry.seed != null ? 4 : 0 }}>
              {players.map((p) => {
                const body = (
                  <>
                    <FlagImage country={p.country} size={21} style={{ clipPath: BADGE, boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }} />
                    <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: 0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{p.name}</span>
                  </>
                )
                const style = { display: 'flex', alignItems: 'center', gap: 9, color: TEXT, textDecoration: 'none', minWidth: 0 } as const
                return p.id
                  ? <Link key={p.id} href={`/player/${p.id}`} style={style}>{body}</Link>
                  : <div key={p.name} style={style}>{body}</div>
              })}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <div style={{ flex: 1, background: CARD, border: '1px solid rgba(255,255,255,0.07)', padding: '10px 12px', clipPath: CHUNK_CARD }}>
            <div style={{ color: MUTED, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('fieldCombined')}</div>
            <div style={{ fontFamily: MONO, fontSize: 19, fontWeight: 900, color: TEXT, marginTop: 2 }}>{points != null ? points.toLocaleString() : '—'}</div>
          </div>
          <div style={{ flex: 1, background: CARD, border: '1px solid rgba(255,255,255,0.07)', padding: '10px 12px', clipPath: CHUNK_CARD }}>
            <div style={{ color: MUTED, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('fieldBestRank')}</div>
            <div style={{ fontFamily: MONO, fontSize: 19, fontWeight: 900, color: TEXT, marginTop: 2 }}>{rank != null ? `#${rank}` : '—'}</div>
          </div>
        </div>

        <div style={SECTION_LABEL}>{t('projectedPath')}</div>
        <div style={{ background: CARD, border: '1px dashed rgba(255,255,255,0.18)', padding: '26px 16px', textAlign: 'center' }}>
          <div style={{ color: GOLD, fontSize: 22, lineHeight: 1, marginBottom: 8 }} aria-hidden="true">🔒</div>
          <div style={{ color: TEXT, fontSize: 14, fontWeight: 800, marginBottom: 5 }}>{t('fieldPathLocked')}</div>
          <div style={{ color: SECONDARY, fontSize: 11.5, lineHeight: 1.5, maxWidth: 260, margin: '0 auto' }}>{t('fieldPathLockedBody')}</div>
        </div>

        <div style={{ marginTop: 16, textAlign: 'center', color: MUTED, fontSize: 9, fontWeight: 600 }}>{t('modelEstimate')}</div>
      </div>
    )
  }

  // ── Field list ───────────────────────────────────────────────
  return (
    <div key="field-list" className="page-mount-anim" style={{ padding: '14px 13px 24px' }}>
      <div style={{ color: TEXT, fontSize: 17, fontWeight: 800, letterSpacing: 0.2 }}>{t('fieldTitle')}</div>
      <div style={{ color: SECONDARY, fontSize: 12, fontWeight: 600, marginTop: 2 }}>{t('fieldSubtitle', { count: entries.length })}</div>

      <div style={{ margin: '12px 0 16px', background: 'rgba(126,211,33,0.07)', border: '1px solid rgba(126,211,33,0.22)', padding: '9px 11px', clipPath: CHUNK_CARD }}>
        <span style={{ color: LIME, fontSize: 11, fontWeight: 800 }}>{t('fieldOddsNote')}</span>{' '}
        <span style={{ color: SECONDARY, fontSize: 11, fontWeight: 600, lineHeight: 1.5 }}>{t('fieldOddsNoteBody')}</span>
      </div>

      {seeded.length > 0 && (
        <>
          <div style={SECTION_LABEL}>{t('fieldSeeded')}</div>
          {seeded.map((e) => (
            <EntryRow key={entryKey(e)} entry={e} playerMap={playerMap} rank={e.seed} onPick={() => setSelected(entryKey(e))} />
          ))}
        </>
      )}

      {unseeded.length > 0 && (
        <>
          <div style={{ ...SECTION_LABEL, marginTop: 18 }}>{t('fieldUnseeded')} · {unseeded.length}</div>
          {unseeded.map((e) => (
            <EntryRow key={entryKey(e)} entry={e} playerMap={playerMap} rank={null} onPick={() => setSelected(entryKey(e))} />
          ))}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "FieldView" || echo "FieldView clean"`
Expected: `FieldView clean`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/FieldView.tsx"
git commit -m "feat(entries): field view for the pre-draw phase of the Entries tab"
```

---

### Task 9: Wire FieldView into ProjectionTab

`ProjectionTab` becomes the phase switch. Entries are fetched only when actually needed — the field phase, or the server routes where `matches` is empty and the seed map has no other source.

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx`

- [ ] **Step 1: Add the imports**

Add alongside the other local imports:

```tsx
import FieldView from './FieldView'
import { useEntryList } from './useEntryList'
import { buildSeedMap, seedMapFromEntries } from '@/lib/projection-picker'
```

and delete the now-duplicated standalone `import { buildSeedMap } from '@/lib/projection-picker'` line.

- [ ] **Step 2: Fetch entries conditionally and merge the seed sources**

Replace the existing `seedByPair` line:

```tsx
  const seedByPair = useMemo(() => buildSeedMap(matches), [matches])
```

with:

```tsx
  // Entries are needed in exactly two cases: the pre-draw field phase (no
  // projection rows yet), and the /projection server routes, which pass
  // matches={[]} and so have no other source of seeds. Skip the fetch
  // otherwise — the in-page tab's `matches` already carries the seeds.
  const needEntries = rows.length === 0 || matches.length === 0
  const entryState = useEntryList(needEntries ? tournamentId : null)
  const categoryEntries = useMemo(
    () => entryState.entries.filter((e) => e.category === category),
    [entryState.entries, category],
  )
  const seedByPair = useMemo(
    () => (matches.length > 0 ? buildSeedMap(matches) : seedMapFromEntries(categoryEntries)),
    [matches, categoryEntries],
  )
```

- [ ] **Step 3: Replace the locked empty state with the field view**

Replace this block (currently lines 203–211):

```tsx
  if (rows.length === 0) {
    return (
      <div style={{ padding: '32px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>🏆</div>
        <div style={{ color: TEXT, fontSize: 15, fontWeight: 800, marginBottom: 6 }}>{t('lockedTitle')}</div>
        <div style={{ color: SECONDARY, fontSize: 12, lineHeight: 1.5, maxWidth: 280, margin: '0 auto 16px' }}>{t('lockedBody')}</div>
      </div>
    )
  }
```

with:

```tsx
  // Phase `field` — no projection rows means the main draw isn't loaded far
  // enough for the worker to forward-simulate (the ≥50%-of-leaves gate lives
  // in tournament-projection-snapshot.ts, deliberately NOT reimplemented
  // here). Show the entry list instead of an empty projection.
  if (rows.length === 0) {
    return (
      <FieldView
        entries={categoryEntries}
        playerMap={entryState.playerMap}
        loading={entryState.loading}
        error={entryState.error}
      />
    )
  }
```

- [ ] **Step 4: Verify the loading guard still precedes it**

Confirm the `if (loading) { … }` guard above still returns before this branch, so the field view isn't flashed while projection rows are still in flight. No edit needed — just read lines 199–201 and confirm ordering.

- [ ] **Step 5: Type-check and run the existing suite**

Run: `npx tsc --noEmit 2>&1 | grep -E "ProjectionTab|FieldView" || echo "clean"`
Expected: `clean`.

Run: `npx vitest run "src/app/[locale]/(app)/tournaments/[id]/__tests__/ProjectionTab.slug-sync.test.tsx"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx"
git commit -m "feat(entries): ProjectionTab renders the field view when no projections exist"
```

---

### Task 10: Merge the tabs on the tournament page

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/page.tsx`

- [ ] **Step 1: Narrow the tab union and alias the legacy param**

Replace the `pageTab` state initializer (currently lines 249–265) with:

```tsx
  const [pageTab, setPageTabState] = useState<'matches' | 'overview' | 'story' | 'draw' | 'entries'>(
    // Legacy param mapping: `?tab=recap` → 'story', and `?tab=projection` →
    // 'entries' now that Projection is content inside the Entries tab.
    wantsMatchesAnimation
      ? 'overview'
      : paramTab === 'entries' || paramTab === 'projection'
      ? 'entries'
      : paramTab === 'draw'
      ? 'draw'
      : paramTab === 'story' || paramTab === 'recap'
      ? 'story'
      : paramTab === 'matches'
      ? 'matches'
      : 'overview'
  )
```

And the `setPageTab` callback signature (currently line 275):

```tsx
  const setPageTab = useCallback((next: 'matches' | 'overview' | 'story' | 'draw' | 'entries') => {
```

- [ ] **Step 2: Collapse the two seen-state blocks into one**

Delete the entire `projectionSeen` block (the `const [projectionSeen, …]`, `markProjectionSeen`, and its `useEffect`), and replace the `entriesSeen` block with:

```tsx
  // "New" chip on the Entries tab — persists (localStorage) until the user
  // opens it once. `tabsMounted` gates it to the client so SSR/hydration stay
  // in sync. Anyone who saw the old Projection tab counts as having seen this.
  const [tabsMounted, setTabsMounted] = useState(false)
  const [entriesSeen, setEntriesSeen] = useState(false)
  const markEntriesSeen = useCallback(() => {
    try { localStorage.setItem(ENTRIES_TAB_SEEN_KEY, '1') } catch {}
    setEntriesSeen(true)
  }, [])
  useEffect(() => {
    setTabsMounted(true)
    if (readEntriesTabSeen((k) => localStorage.getItem(k))) markEntriesSeen()
  }, [markEntriesSeen])
```

Add the import near the other `@/lib` imports:

```tsx
import { ENTRIES_TAB_SEEN_KEY, readEntriesTabSeen } from '@/lib/tab-seen'
```

- [ ] **Step 3: Merge the visibility gate**

Replace the `showProjectionTab` memo and the `showEntriesTab` line (currently lines 872–888) with:

```tsx
  const projectionFlag = useFeatureFlag(FLAG_KEYS.PROJECTION_ENABLED)
  const entryListFlag = useFeatureFlag(FLAG_KEYS.ENTRY_LIST_ENABLED)
  // Gate on real entry data (tournament_entries rows), NOT entry_list_status —
  // that's an operator-managed FIP-workflow field that stays 'not_applicable'
  // for Premier events (Malaga etc.) even when padelgod has captured their
  // entry list. Probe only fires when the flag is on.
  const hasEntries = useHasEntries(entryListFlag ? tournamentId : null)
  // One tab, two phases. Show it if EITHER source can populate it: entry rows
  // (pre-draw field) or a draw-bearing tier (projections once the draw lands).
  // Preserves every case that showed a tab before the merge.
  const showEntriesTab = useMemo(() => {
    if (!activeTournamentObj) return false
    if (entryListFlag && hasEntries) return true
    return projectionFlag && DRAW_TIERS.has(activeTournamentObj.level ?? '')
  }, [activeTournamentObj, entryListFlag, hasEntries, projectionFlag])
```

- [ ] **Step 4: Rewrite the tab strip**

Replace the `tabs={…}` prop and the `onChange` handler (currently lines 1226–1250) with:

```tsx
          tabs={(['overview', ...(showEntriesTab ? ['entries'] as const : []), 'story', 'matches', ...(showDrawTab ? ['draw'] as const : [])] as const).map(tab => ({
            key: tab,
            label: tab === 'entries' && tabsMounted && !entriesSeen ? (
              <span style={{ position: 'relative' }}>
                {tTournament(tab)}
                <span style={{ marginLeft: 5, fontSize: 8, fontWeight: 800, letterSpacing: 0.3, color: '#06210a', background: '#7ED321', padding: '1px 4px', borderRadius: 3, verticalAlign: 'middle' }}>{tTournament('newBadge')}</span>
              </span>
            ) : tTournament(tab),
          }))}
          activeKey={pageTab}
          onChange={(key) => {
            if (key === 'entries') {
              markEntriesSeen()
              setPageTab('entries')
              syncProjectionUrl(null)
              return
            }
            // Leaving entries: drop the ?tab/?pair params so the URL is clean.
            if (pageTab === 'entries') {
              lastSyncedProjectionQs.current = null
              if (paramTab === 'entries' || paramTab === 'projection') router.replace(pathname, { scroll: false })
            }
            setPageTab(key)
          }}
```

- [ ] **Step 5: Replace both render blocks with one**

Replace the two blocks at the bottom (currently lines 1468–1486 — the `pageTab === 'projection'` block and the `pageTab === 'entries'` block) with this single block:

```tsx
        {/* ── Entries Tab (in-page) — field before the draw, projections after ── */}
        {pageTab === 'entries' && activeTournamentObj && showEntriesTab && (
          <ProjectionTab
            tournamentId={tournamentId}
            matches={allMatches.filter(m => (m as any).category === genderFilter)}
            category={genderFilter}
            tournamentLevel={activeTournamentObj.level ?? null}
            roundSchedule={(activeTournamentObj as any).round_schedule ?? null}
            initialPairSlug={paramTab === 'entries' || paramTab === 'projection' ? initialProjectionPairSlug : null}
            onPairSlugChange={syncProjectionUrl}
            tournamentName={activeTournamentObj.name ?? null}
          />
        )}
```

- [ ] **Step 6: Drop the dead import**

Remove `import EntriesTab from './EntriesTab'` (line 39).

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "tournaments/\[id\]/page" || echo "page clean"`
Expected: `page clean`.

- [ ] **Step 8: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/page.tsx"
git commit -m "feat(entries): one Entries tab for both phases, projection tab retired"
```

---

### Task 11: Delete the old Entries components

`EntriesTab` has no caller after Task 10, and `EntryList` has no caller after `EntriesTab` goes.

**Files:**
- Delete: `src/app/[locale]/(app)/tournaments/[id]/EntriesTab.tsx`, `src/components/EntryList.tsx`

- [ ] **Step 1: Confirm nothing else imports them**

Run:

```bash
grep -rn "from '@/components/EntryList'\|from './EntriesTab'\|EntriesTab from" src apps --include='*.ts' --include='*.tsx' | grep -v node_modules
```

Expected: no output. (`EntryListTab.tsx` and `PadelgodEntryListTab.tsx` in ops are different components — they must NOT appear here; if they do, the grep pattern matched too broadly, re-check by hand.)

- [ ] **Step 2: Delete both files**

```bash
git rm "src/app/[locale]/(app)/tournaments/[id]/EntriesTab.tsx" src/components/EntryList.tsx
```

- [ ] **Step 3: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor(entries): delete EntriesTab and EntryList, superseded by FieldView"
```

---

### Task 12: Server route tab label

`ProjectionRouteClient` renders its own tab strip with `projection` as the active key. That tab no longer exists, so the strip must show `entries` as active and route the others back to the in-page tabs.

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/projection/ProjectionRouteClient.tsx:9,55-67`

- [ ] **Step 1: Retarget the tab key**

Replace the `TabKey` type:

```tsx
type TabKey = 'overview' | 'entries' | 'story' | 'matches' | 'draw'
```

Replace `onTabChange` and the `tabs` array:

```tsx
  // This route IS the entries tab's projected phase — tapping it is a no-op.
  // Everything else goes back to the in-page tabs.
  const onTabChange = useCallback((key: TabKey) => {
    if (key === 'entries') return
    router.push(`/tournaments/${tournamentId}?tab=${key}`)
  }, [router, tournamentId])

  const tabs = (['overview', 'entries', 'story', 'matches', ...(showDrawTab ? ['draw'] as const : [])] as const)
    .map((key) => ({ key, label: t(key) }))
```

Replace the `activeKey` prop on `<SlidingInkTabs>`:

```tsx
        activeKey="entries"
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "ProjectionRouteClient" || echo "route client clean"`
Expected: `route client clean`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/projection/ProjectionRouteClient.tsx"
git commit -m "feat(entries): projection routes show Entries as the active tab"
```

---

### Task 13: Full verification

- [ ] **Step 1: Run the whole unit suite**

Run: `npx vitest run`
Expected: PASS. Pay attention to `projection-*` and the two new files.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no new errors. The `react-hooks/exhaustive-deps` disable comments carried over from the original code are expected.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds; `/[locale]/tournaments/[id]/projection` and `/projection/[pair]` still appear in the route list.

- [ ] **Step 4: Verify in the browser**

Start the dev server via the preview tooling (never `npm run dev` in a raw shell) and check each state. Pick tournament ids from Supabase — a pre-draw event for phase `field`, a mid-tournament Premier event for phase `projected`.

Check all of:

1. `/tournaments/<pre-draw-id>?tab=entries` — field list renders, seeded section shows gold seed numbers, unseeded section ordered by points descending.
2. Tap a pair → hero banner with photos, combined points and best rank cards, dashed locked-path card.
3. `/tournaments/<live-id>?tab=entries` — top contenders with champion percentages; tapping a pair opens the road view; the URL becomes `?tab=entries&category=men&pair=<slug>`.
4. `/tournaments/<live-id>?tab=projection` — legacy param still lands on the merged tab.
5. `/tournaments/<live-id>/projection` — server route renders, tab strip shows Entries as active, and seed chips (`#1`, `#2`) are now visible in the picker list.
6. Tab strip contains no `Projection` entry on any tournament.
7. Switch the category toggle men ↔ women in phase `field` — the list re-filters.

Use `read_console_messages` to confirm no errors, and take a screenshot of the phase-`field` list and the phase-`field` pair detail.

- [ ] **Step 5: Commit any fixes, then report**

If browser verification turned up fixes, commit them individually with `fix(entries): …` messages. Report to Gustavo with the screenshots and the state of each of the seven checks above.
