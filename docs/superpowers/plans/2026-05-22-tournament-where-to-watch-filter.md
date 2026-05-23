# Tournament-scoped "Where to Watch" filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filter the tournament Overview "Dónde Ver" panel to streams attributed to *this* tournament across all active YouTube channels, with a FIP-TOUR-only search fallback when nothing matches.

**Architecture:** A new pure helper `filterTournamentStreams` decides per-video membership using `fip_court_streams.tournament_id` (canonical, FIP TOUR) or title-token overlap (heuristic, other channels). The tournament page broadens its live-channel query to all active channels, applies the helper in-memory, computes a fallback URL when empty, and passes both to `WhereToWatchInline`. The component renders a green or amber nudge depending on which mode it's in.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Supabase JS client, `next-intl`, Vitest.

**Spec:** [docs/superpowers/specs/2026-05-22-tournament-where-to-watch-filter.md](../specs/2026-05-22-tournament-where-to-watch-filter.md)

---

## File map

| File | Action | Responsibility after change |
|---|---|---|
| `src/lib/fip-stream-title-parser.ts` | Modify | Export the existing `tokenize` function so other code can reuse the same noise/diacritic/year handling. |
| `src/lib/fip-stream-resolver.ts` | Modify | Export the existing `tournamentSearchUrl` helper so the page-level effect can build the fallback URL. |
| `src/lib/where-to-watch/filter-tournament-streams.ts` | Create | New pure function: filter `LiveChannel[]` down to the streams that belong to this tournament. |
| `src/lib/__tests__/filter-tournament-streams.test.ts` | Create | Unit tests — TDD entry point for Task 3. |
| `src/messages/en.json`, `es.json`, `pt.json`, `it.json`, `fr.json` | Modify | Add 4 keys to the existing `whereToWatch` namespace: `tournamentMatchedNudge`, `tournamentEmptyNudge`, `searchFallbackLabel`, `searchFallbackButton`. |
| `src/components/where-to-watch/WhereToWatchInline.tsx` | Modify | Accept optional `fallback` prop; render green nudge + groups when matched, amber nudge + single FIP TOUR search row when fallback is present, return null when both empty. |
| `src/app/[locale]/(app)/tournaments/[id]/page.tsx` | Modify | Drop abbreviation filters on the WTW queries; add a `fip_court_streams.tournament_id` lookup; run the filter helper; compute the FIP TOUR fallback for FIP-tier tournaments only; pass filtered streams + fallback to `WhereToWatchInline`. |

---

## Task 1: Export `tokenize` from `fip-stream-title-parser`

**Files:**
- Modify: `src/lib/fip-stream-title-parser.ts:39-46`

- [ ] **Step 1: Add `export` to the existing `tokenize` function**

Open `src/lib/fip-stream-title-parser.ts`. Change line 39 from:

```ts
function tokenize(s: string): string[] {
```

to:

```ts
export function tokenize(s: string): string[] {
```

No other change. The function body, the NOISE_TOKENS constant, and `parseFipStreamTitle` all stay as they are.

- [ ] **Step 2: Run the existing parser tests to verify nothing regressed**

Run: `npx vitest run src/lib/__tests__/fip-stream-title-parser.test.ts`

Expected: all existing tests PASS (the export is additive — `parseFipStreamTitle` still uses the same internal call).

- [ ] **Step 3: Commit**

```bash
git add src/lib/fip-stream-title-parser.ts
git commit -m "$(cat <<'EOF'
refactor(fip-streams): export tokenize from title parser

Lets the tournament-page Where-to-Watch filter reuse the same
noise-token / diacritic / year handling that the discovery cron's
title parser uses, instead of duplicating it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Export `tournamentSearchUrl` from `fip-stream-resolver`

**Files:**
- Modify: `src/lib/fip-stream-resolver.ts:47-50`

- [ ] **Step 1: Add `export` to the existing helper**

Open `src/lib/fip-stream-resolver.ts`. Change line 47 from:

```ts
function tournamentSearchUrl(tournamentName: string): string {
```

to:

```ts
export function tournamentSearchUrl(tournamentName: string): string {
```

- [ ] **Step 2: Run the resolver tests to verify nothing regressed**

Run: `npx vitest run src/lib/__tests__/fip-stream-resolver.test.ts`

Expected: all existing tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/fip-stream-resolver.ts
git commit -m "$(cat <<'EOF'
refactor(fip-streams): export tournamentSearchUrl helper

Lets the tournament-page Where-to-Watch panel build the same Tier-3
channel-scoped search URL used by per-match fallback, without
duplicating the format.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Create `filterTournamentStreams` with tests (TDD)

**Files:**
- Create: `src/lib/where-to-watch/filter-tournament-streams.ts`
- Create: `src/lib/__tests__/filter-tournament-streams.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/filter-tournament-streams.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { filterTournamentStreams } from '../where-to-watch/filter-tournament-streams'
import type { LiveChannel } from '../where-to-watch/group-builder'

const fipVideo = (videoId: string, title: string): LiveChannel => ({
  videoId,
  title,
  channel: { id: 'fip-uuid', name: 'FIP TOUR', abbreviation: 'FIP', colorHex: '#1A4DAA', displayOrder: 1 },
})
const pmVideo = (videoId: string, title: string): LiveChannel => ({
  videoId,
  title,
  channel: { id: 'pm-uuid', name: 'Padelmag TV', abbreviation: 'PM', colorHex: '#16A34A', displayOrder: 2 },
})

describe('filterTournamentStreams', () => {
  it('keeps a FIP TOUR video whose id is in the attributed set', () => {
    const result = filterTournamentStreams({
      liveVideos: [fipVideo('v1', 'FIP Bronze Marnes — R16')],
      attributedVideoIds: new Set(['v1']),
      tournamentNameTokens: ['bronze', 'marnes'],
    })
    expect(result.map(v => v.videoId)).toEqual(['v1'])
  })

  it('drops a FIP TOUR video whose id is not in the attributed set, even if the title matches', () => {
    const result = filterTournamentStreams({
      liveVideos: [fipVideo('v1', 'FIP Bronze Marnes — R16')],
      attributedVideoIds: new Set(),
      tournamentNameTokens: ['bronze', 'marnes'],
    })
    expect(result).toEqual([])
  })

  it('keeps a non-FIP video whose title shares ≥2 non-noise tokens with the tournament name', () => {
    const result = filterTournamentStreams({
      liveVideos: [pmVideo('v1', 'Piste centrale — FIP Bronze Marnes — 1/8 et 1/4')],
      attributedVideoIds: new Set(),
      tournamentNameTokens: ['bronze', 'marnes'],
    })
    expect(result.map(v => v.videoId)).toEqual(['v1'])
  })

  it('drops a non-FIP video that shares only 1 token with the tournament name', () => {
    const result = filterTournamentStreams({
      liveVideos: [pmVideo('v1', 'FIP Bronze Yogyakarta — Court 4')],
      attributedVideoIds: new Set(),
      tournamentNameTokens: ['bronze', 'marnes'],
    })
    expect(result).toEqual([])
  })

  it('drops a non-FIP video that shares 0 tokens with the tournament name', () => {
    const result = filterTournamentStreams({
      liveVideos: [pmVideo('v1', 'Random padel highlights compilation')],
      attributedVideoIds: new Set(),
      tournamentNameTokens: ['bronze', 'marnes'],
    })
    expect(result).toEqual([])
  })

  it('handles diacritics in both tournament name and video title', () => {
    const result = filterTournamentStreams({
      liveVideos: [pmVideo('v1', 'FIP Silver Buènos Aires — Pista Central')],
      attributedVideoIds: new Set(),
      tournamentNameTokens: ['buenos', 'aires'],
    })
    expect(result.map(v => v.videoId)).toEqual(['v1'])
  })

  it('respects a custom minHeuristicTokens threshold', () => {
    const result = filterTournamentStreams({
      liveVideos: [pmVideo('v1', 'FIP Bronze Marnes — R16')],
      attributedVideoIds: new Set(),
      tournamentNameTokens: ['bronze', 'marnes'],
      minHeuristicTokens: 3,
    })
    expect(result).toEqual([])
  })

  it('returns an empty array when given no live videos', () => {
    const result = filterTournamentStreams({
      liveVideos: [],
      attributedVideoIds: new Set(),
      tournamentNameTokens: ['bronze', 'marnes'],
    })
    expect(result).toEqual([])
  })

  it('handles a mixed batch of FIP-attributed, FIP-unattributed, and non-FIP videos', () => {
    const result = filterTournamentStreams({
      liveVideos: [
        fipVideo('v1', 'FIP Bronze Marnes — R16'),
        fipVideo('v2', 'FIP Bronze Yogyakarta — R32 — Court 4'),
        pmVideo('v3', 'Piste centrale — FIP Bronze Marnes'),
        pmVideo('v4', 'FIP Bronze Yogyakarta — Court 4'),
      ],
      attributedVideoIds: new Set(['v1']),
      tournamentNameTokens: ['bronze', 'marnes'],
    })
    expect(result.map(v => v.videoId).sort()).toEqual(['v1', 'v3'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/filter-tournament-streams.test.ts`

Expected: FAIL with "Failed to load url ../where-to-watch/filter-tournament-streams" or "filterTournamentStreams is not a function" — the module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `src/lib/where-to-watch/filter-tournament-streams.ts` with:

```ts
// src/lib/where-to-watch/filter-tournament-streams.ts
//
// Pure function — filter a batch of live YouTube videos down to those
// attributable to a specific tournament.
//
// Attribution rules (per channel):
//   - FIP TOUR (channel abbreviation 'FIP'): canonical attribution via the
//     fip-streams-discover cron — keep iff video_id is in attributedVideoIds.
//   - Other channels: heuristic — keep iff the title's token set intersects
//     the tournament-name token set on at least `minHeuristicTokens` tokens
//     (default 2). Same tokenizer the FIP title parser uses, so noise tokens
//     ('fip', 'padel', 'tour', …) and year tokens never contribute to overlap.

import { tokenize } from '../fip-stream-title-parser'
import type { LiveChannel } from './group-builder'

export interface FilterTournamentStreamsArgs {
  liveVideos: LiveChannel[]
  attributedVideoIds: Set<string>
  tournamentNameTokens: string[]
  minHeuristicTokens?: number
}

const FIP_ABBR = 'FIP'

export function filterTournamentStreams(args: FilterTournamentStreamsArgs): LiveChannel[] {
  const {
    liveVideos,
    attributedVideoIds,
    tournamentNameTokens,
    minHeuristicTokens = 2,
  } = args
  const nameTokenSet = new Set(tournamentNameTokens)
  const result: LiveChannel[] = []

  for (const v of liveVideos) {
    if (v.channel.abbreviation === FIP_ABBR) {
      if (attributedVideoIds.has(v.videoId)) result.push(v)
      continue
    }
    const titleTokens = tokenize(v.title)
    let overlap = 0
    for (const tok of titleTokens) {
      if (nameTokenSet.has(tok)) {
        overlap += 1
        if (overlap >= minHeuristicTokens) break
      }
    }
    if (overlap >= minHeuristicTokens) result.push(v)
  }

  return result
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/filter-tournament-streams.test.ts`

Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/where-to-watch/filter-tournament-streams.ts src/lib/__tests__/filter-tournament-streams.test.ts
git commit -m "$(cat <<'EOF'
feat(where-to-watch): add filterTournamentStreams helper

Pure function that filters a batch of live YouTube videos down to
those attributable to a specific tournament. FIP TOUR uses the
canonical fip_court_streams attribution; other channels use a
≥2-token title-name overlap heuristic.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add i18n keys across all 5 locales

**Files:**
- Modify: `src/messages/en.json:1236-1262`
- Modify: `src/messages/es.json:1209-1235`
- Modify: `src/messages/pt.json` (locate `whereToWatch` block)
- Modify: `src/messages/it.json` (locate `whereToWatch` block)
- Modify: `src/messages/fr.json` (locate `whereToWatch` block)

- [ ] **Step 1: Add 4 keys to `src/messages/en.json`**

Inside the existing `"whereToWatch": { … }` block (around line 1236), add four entries just after `"seoSummary": "…"`. The final closing brace order is `seoSummary`, then the new keys, then `}`:

```json
    "seoSummary": "Watch {target} live on {list}{extra, plural, =0 {} one { and # other regional broadcaster} other { and # other regional broadcasters}}.",
    "tournamentMatchedNudge": "Showing streams identified for this tournament",
    "tournamentEmptyNudge": "We haven't identified streams for this tournament yet",
    "searchFallbackLabel": "Search \"{tournament}\" on FIP TOUR",
    "searchFallbackButton": "Search"
  }
}
```

- [ ] **Step 2: Add the same 4 keys to `src/messages/es.json`**

Inside the existing `"whereToWatch": { … }` block (around line 1209), append after `"seoSummary"`:

```json
    "seoSummary": "Mira {target} en directo en {list}{extra, plural, =0 {} one { y # otra emisora regional} other { y # otras emisoras regionales}}.",
    "tournamentMatchedNudge": "Mostrando transmisiones identificadas para este torneo",
    "tournamentEmptyNudge": "Aún no identificamos transmisiones para este torneo",
    "searchFallbackLabel": "Buscar \"{tournament}\" en FIP TOUR",
    "searchFallbackButton": "Buscar"
  }
}
```

- [ ] **Step 3: Add the same 4 keys to `src/messages/pt.json`**

Locate the `whereToWatch` block (search for `"whereToWatch": {`). Append after the last existing key in the block:

```json
    "tournamentMatchedNudge": "Mostrando transmissões identificadas para este torneio",
    "tournamentEmptyNudge": "Ainda não identificamos transmissões para este torneio",
    "searchFallbackLabel": "Buscar \"{tournament}\" no FIP TOUR",
    "searchFallbackButton": "Buscar"
```

(Add a trailing comma to the previous key, no trailing comma on `searchFallbackButton`.)

- [ ] **Step 4: Add the same 4 keys to `src/messages/it.json`**

Locate the `whereToWatch` block. Append:

```json
    "tournamentMatchedNudge": "Stiamo mostrando le trasmissioni identificate per questo torneo",
    "tournamentEmptyNudge": "Non abbiamo ancora identificato trasmissioni per questo torneo",
    "searchFallbackLabel": "Cerca \"{tournament}\" su FIP TOUR",
    "searchFallbackButton": "Cerca"
```

- [ ] **Step 5: Add the same 4 keys to `src/messages/fr.json`**

Locate the `whereToWatch` block. Append:

```json
    "tournamentMatchedNudge": "Affichage des diffusions identifiées pour ce tournoi",
    "tournamentEmptyNudge": "Nous n'avons pas encore identifié de diffusions pour ce tournoi",
    "searchFallbackLabel": "Rechercher « {tournament} » sur FIP TOUR",
    "searchFallbackButton": "Rechercher"
```

- [ ] **Step 6: Verify JSON validity**

Run: `node -e "for (const l of ['en','es','pt','it','fr']) JSON.parse(require('fs').readFileSync('src/messages/'+l+'.json','utf8')); console.log('all 5 locales parse OK')"`

Expected: prints `all 5 locales parse OK`. If any file fails to parse, fix the missing/extra comma.

- [ ] **Step 7: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "$(cat <<'EOF'
i18n(where-to-watch): tournament-scoped nudges + FIP search fallback

Four new keys in the whereToWatch namespace across 5 locales:
tournamentMatchedNudge, tournamentEmptyNudge, searchFallbackLabel,
searchFallbackButton. Used by the tournament Overview "Donde Ver"
panel to communicate filter state and stand in when no streams
are identified.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update `WhereToWatchInline` — accept `fallback` prop, render nudges

**Files:**
- Modify: `src/components/where-to-watch/WhereToWatchInline.tsx`

- [ ] **Step 1: Add `fallback` to the props interface**

In `src/components/where-to-watch/WhereToWatchInline.tsx`, find the `WhereToWatchInlineProps` interface (around line 47) and add the new optional field:

```ts
export interface WhereToWatchInlineProps {
  liveChannels: LiveChannel[]
  broadcasters: BroadcasterRow[]
  channelsMeta?: ChannelMeta[]
  todayCircuits: string[]
  geoCountry: string | null
  /** When the upstream filter found zero matches but wants a FIP TOUR
   *  search row to stand in. Set to null/undefined to suppress the panel
   *  when groups are empty (current behaviour for non-FIP tournaments). */
  fallback?: { url: string; tournamentName: string } | null
}
```

- [ ] **Step 2: Destructure the new prop in the function signature**

In the same file (around line 55), update the destructure:

```ts
export function WhereToWatchInline({
  liveChannels, broadcasters, channelsMeta = [], todayCircuits, geoCountry,
  fallback = null,
}: WhereToWatchInlineProps) {
```

- [ ] **Step 3: Replace the empty-state early return with the three-mode decision**

Find (around line 85):

```ts
  if (groups.length === 0) return null
```

Replace with:

```ts
  const hasGroups = groups.length > 0
  const showFallback = !hasGroups && fallback != null
  if (!hasGroups && !showFallback) return null
```

- [ ] **Step 4: Render the matched / fallback nudge above the groups**

Find the `{/* Eyebrow */}` block (around line 119). Immediately AFTER the eyebrow `</div>` closes (around line 136), add the nudge block:

```tsx
          {/* Status nudge — green when ≥1 channel matched, amber when fallback. */}
          {(hasGroups || showFallback) && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              fontSize: 10.5,
              color: hasGroups ? '#8BD89A' : '#D9C77A',
              background: hasGroups ? 'rgba(82,179,102,0.08)' : 'rgba(217,199,122,0.06)',
              border: `1px solid ${hasGroups ? 'rgba(82,179,102,0.18)' : 'rgba(217,199,122,0.18)'}`,
              borderRadius: 6, padding: '6px 9px', marginBottom: 14, lineHeight: 1.35,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: hasGroups ? '#52B366' : '#D9C77A',
                flexShrink: 0,
                boxShadow: `0 0 0 3px ${hasGroups ? 'rgba(82,179,102,0.18)' : 'rgba(217,199,122,0.18)'}`,
              }} />
              <span>{t(hasGroups ? 'tournamentMatchedNudge' : 'tournamentEmptyNudge')}</span>
            </div>
          )}
```

- [ ] **Step 5: Render the FIP TOUR fallback row when in fallback mode**

Find the `{/* Groups */}` block (around line 138):

```tsx
          {/* Groups */}
          {groups.map((g, gi) => (
            <ChannelGroup
              key={g.channelId}
              group={g}
              groupIndex={gi}
              country={effectiveCountry}
            />
          ))}
```

Wrap the existing groups render in a conditional and add the fallback branch:

```tsx
          {/* Groups (matched mode) OR FIP TOUR fallback row (fallback mode). */}
          {hasGroups && groups.map((g, gi) => (
            <ChannelGroup
              key={g.channelId}
              group={g}
              groupIndex={gi}
              country={effectiveCountry}
            />
          ))}
          {showFallback && fallback && (
            <div>
              {/* FIP TOUR channel header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: '50%',
                  background: '#1A4DAA', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: 13, letterSpacing: 0.5,
                  flexShrink: 0,
                }}>FIP</div>
                <span style={{
                  fontWeight: 800, fontSize: 14, letterSpacing: 0.5,
                  textTransform: 'uppercase', color: '#fff',
                }}>FIP TOUR</span>
              </div>
              {/* Search row */}
              <a href={fallback.url} target="_blank" rel="noopener noreferrer" style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 0', textDecoration: 'none', color: 'inherit',
              }}>
                <span style={{ flex: 1, fontSize: 13, color: '#E5E7EB', lineHeight: 1.35 }}>
                  {t('searchFallbackLabel', { tournament: fallback.tournamentName })}
                </span>
                <span style={{
                  background: 'transparent', color: ORANGE,
                  border: `1px solid rgba(245,166,35,0.4)`,
                  fontWeight: 800, fontSize: 11, letterSpacing: 0.6,
                  padding: '7px 12px', borderRadius: 4,
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  textTransform: 'uppercase', flexShrink: 0,
                }}>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" stroke={ORANGE} strokeWidth="2.5" />
                    <line x1="16" y1="16" x2="21" y2="21" stroke={ORANGE} strokeWidth="2.5" />
                  </svg>
                  {t('searchFallbackButton')}
                </span>
              </a>
            </div>
          )}
```

- [ ] **Step 6: Run the build to verify the file type-checks**

Run: `npx tsc --noEmit -p .`

Expected: no errors involving `WhereToWatchInline.tsx`. (Other type errors in the codebase are unrelated.)

- [ ] **Step 7: Commit**

```bash
git add src/components/where-to-watch/WhereToWatchInline.tsx
git commit -m "$(cat <<'EOF'
feat(where-to-watch): inline panel renders nudge + optional fallback

WhereToWatchInline now accepts an optional `fallback` prop. Three
render modes: groups-with-green-nudge (≥1 channel matched), single
FIP TOUR search row with amber nudge (fallback present, groups
empty), or null (both empty, original self-hide).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Rewire the tournament page's WTW effect

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/page.tsx` — imports + the WTW useEffect at line 1394 onwards
- Modify: same file — the `<WhereToWatchInline …/>` JSX at line 1850

- [ ] **Step 1: Add the new imports**

At the top of `src/app/[locale]/(app)/tournaments/[id]/page.tsx`, add to the existing import block (after the `circuit-map` import at line 23):

```ts
import { filterTournamentStreams } from '@/lib/where-to-watch/filter-tournament-streams'
import { tokenize } from '@/lib/fip-stream-title-parser'
import { tournamentSearchUrl } from '@/lib/fip-stream-resolver'
import { isFipTier } from '@/lib/fip-channel'
```

- [ ] **Step 2: Add a state hook for the fallback**

Find the existing WTW state block (line 1395):

```ts
  const [wtwBroadcasters, setWtwBroadcasters] = useState<BroadcasterRow[]>([])
  const [wtwLiveChannels, setWtwLiveChannels] = useState<LiveChannel[]>([])
  const [wtwChannelsMeta, setWtwChannelsMeta] = useState<ChannelMeta[]>([])
  const [wtwGeoCountry, setWtwGeoCountry] = useState<string | null>(null)
```

Add one more line below:

```ts
  const [wtwFallback, setWtwFallback] = useState<{ url: string; tournamentName: string } | null>(null)
```

- [ ] **Step 3: Replace the WTW useEffect body**

The current effect is at lines 1405–1480. Replace the whole effect with the version below (the deps array also changes — see Step 4):

```ts
  useEffect(() => {
    // Read geo-country cookie client-side (server proxy sets this from x-vercel-ip-country)
    const cookieMatch = typeof document !== 'undefined'
      ? document.cookie.match(/(?:^|;\s*)geo-country=([^;]*)/)
      : null
    const country = cookieMatch?.[1]?.toLowerCase() || null
    setWtwGeoCountry(country)

    // Skip entirely if no tournament yet or its level doesn't map to a tracked
    // circuit (e.g. legacy WPT). Keeps behaviour conservative for tiers we
    // haven't decided to surface streams for.
    if (!tournament || !tournamentChannelAbbr) {
      setWtwBroadcasters([])
      setWtwLiveChannels([])
      setWtwChannelsMeta([])
      setWtwFallback(null)
      return
    }

    let cancelled = false
    const STALE_MS = 30 * 60 * 1000
    const tournamentNameTokens = tokenize(tournament.name)
    const tournamentId = tournament.id
    const tournamentName = tournament.name
    const tournamentLevel = tournament.level

    // Fetch all active broadcasters (across countries) so the region
    // picker can switch without a round-trip; buildGroups filters by
    // the effective country at render time.
    const broadcastersP = supabase
      .from('broadcasters')
      .select('id, name, url, logo_url, is_free, display_order, country_iso2, channel_id')
      .eq('active', true)
      .not('channel_id', 'is', null)
      .order('country_iso2', { ascending: true })
      .order('display_order', { ascending: true })
      .order('is_free', { ascending: false })

    // Live channels across ALL active YouTube channels (no abbreviation
    // filter). Per-tournament filtering happens in-memory via
    // filterTournamentStreams once all queries resolve.
    const liveChannelsP = supabase
      .from('youtube_channel_live')
      .select(`video_id, title, channel:youtube_channels!inner(id, name, abbreviation, color_hex, display_order)`)
      .gt('last_seen_at', new Date(Date.now() - STALE_MS).toISOString())
      .eq('channel.is_active', true)

    // All active channels' metadata (no abbreviation filter — broadcaster-only
    // groups still need channel meta to render even when a channel isn't
    // currently live).
    const channelsMetaP = supabase
      .from('youtube_channels')
      .select('id, name, abbreviation, color_hex, display_order')
      .eq('is_active', true)

    // Canonical FIP TOUR attribution: video IDs the discovery cron has
    // mapped to this tournament. Used to gate which FIP-channel live
    // videos belong to the page we're rendering.
    const attributedP = supabase
      .from('fip_court_streams')
      .select('youtube_video_id')
      .eq('tournament_id', tournamentId)

    Promise.all([broadcastersP, liveChannelsP, channelsMetaP, attributedP]).then(([bRes, lcRes, cmRes, attRes]) => {
      if (cancelled) return
      setWtwBroadcasters(((bRes.data ?? []) as BroadcasterRow[]))

      const allLiveVideos = (lcRes.data ?? []).map((r: any) => {
        const ch = Array.isArray(r.channel) ? r.channel[0] : r.channel
        if (!ch) return null
        return {
          videoId: r.video_id as string,
          title: r.title as string,
          channel: {
            id: ch.id as string,
            name: ch.name as string,
            abbreviation: ch.abbreviation as string,
            colorHex: ch.color_hex as string,
            displayOrder: ch.display_order as number,
          },
        }
      }).filter((x: LiveChannel | null): x is LiveChannel => x !== null)

      const attributedSet = new Set(
        (attRes.data ?? []).map((r: any) => r.youtube_video_id as string)
      )

      const filteredLive = filterTournamentStreams({
        liveVideos: allLiveVideos,
        attributedVideoIds: attributedSet,
        tournamentNameTokens,
      })
      setWtwLiveChannels(filteredLive)

      const channelsMeta = (cmRes.data ?? []).map((r: any) => ({
        id: r.id as string,
        name: r.name as string,
        abbreviation: r.abbreviation as string,
        colorHex: r.color_hex as string,
        displayOrder: r.display_order as number,
      }))
      setWtwChannelsMeta(channelsMeta)

      // FIP-TOUR-only fallback: when nothing matched and this is an FIP-tier
      // tournament, surface a single tournament-scoped channel-search row.
      // Premier and other tiers do NOT get a fallback (the search URL is FIP
      // TOUR's handle — would mislead on a Premier page).
      if (filteredLive.length === 0 && isFipTier(tournamentLevel)) {
        setWtwFallback({
          url: tournamentSearchUrl(tournamentName),
          tournamentName,
        })
      } else {
        setWtwFallback(null)
      }
    }).catch(err => {
      if (!cancelled) console.warn('[tournament:wtw] fetch failed:', err)
    })

    return () => { cancelled = true }
  }, [tournament?.id, tournament?.name, tournament?.level, tournamentChannelAbbr])
```

- [ ] **Step 4: Pass `fallback` to `WhereToWatchInline`**

Find the JSX usage at line 1850:

```tsx
      <WhereToWatchInline
        liveChannels={wtwLiveChannels}
        broadcasters={wtwBroadcasters}
        channelsMeta={wtwChannelsMeta}
        todayCircuits={tournamentChannelAbbr ? [tournamentChannelAbbr] : []}
        geoCountry={wtwGeoCountry}
      />
```

Change to:

```tsx
      <WhereToWatchInline
        liveChannels={wtwLiveChannels}
        broadcasters={wtwBroadcasters}
        channelsMeta={wtwChannelsMeta}
        todayCircuits={tournamentChannelAbbr ? [tournamentChannelAbbr] : []}
        geoCountry={wtwGeoCountry}
        fallback={wtwFallback}
      />
```

- [ ] **Step 5: Type-check the page**

Run: `npx tsc --noEmit -p .`

Expected: no new type errors involving `tournaments/[id]/page.tsx`.

- [ ] **Step 6: Lint the page**

Run: `npm run lint -- --file src/app/\\[locale\\]/\\(app\\)/tournaments/\\[id\\]/page.tsx`

(Or just `npm run lint` if the file flag isn't supported — verify no new warnings in the file.)

Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/\[locale\]/\(app\)/tournaments/\[id\]/page.tsx
git commit -m "$(cat <<'EOF'
feat(tournament): tournament-scoped Where-to-Watch panel

Filter the Overview "Donde Ver" panel to streams attributed to this
tournament. FIP TOUR videos resolve via fip_court_streams; other
active channels via title-token overlap (≥2). Panel falls back to a
FIP TOUR channel-search row when nothing matches an FIP-tier
tournament; non-FIP tiers self-hide as before.

Fixes the bug where unrelated FIP TOUR livestreams (e.g. another
parallel Bronze event) leaked into every FIP-tier tournament page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Manual smoke test in dev

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

Expected: server boots at `http://localhost:3002`. If a different port, use that.

- [ ] **Step 2: Visit an FIP-tier tournament with currently-live FIP TOUR streams**

Pick an FIP-tier tournament whose discovery cron has populated `fip_court_streams` rows (e.g. an in-progress Bronze event). Visit `http://localhost:3002/tournaments/<id>` on the Overview tab.

Expected:
- Green nudge: "Showing streams identified for this tournament" (or the locale equivalent).
- Channel block(s) for FIP TOUR with only this tournament's streams. No other Bronze events' streams.
- If a non-FIP channel (e.g. Padelmag TV) has a live video whose title shares ≥2 tokens with the tournament name, its block also appears.

- [ ] **Step 3: Visit an FIP-tier tournament with no live streams in any channel**

Pick an FIP-tier tournament that's between sessions or hasn't started yet.

Expected:
- Amber nudge: "We haven't identified streams for this tournament yet" (or locale equivalent).
- Single FIP TOUR channel block with one row: "Search '<tournament name>' on FIP TOUR" + a "Search" button that opens `youtube.com/@padelfip/search?query=<encoded name>` in a new tab.

- [ ] **Step 4: Visit a Premier-tier tournament page**

Pick a Premier-tier tournament.

Expected: panel behaviour is unchanged from before this change — either renders normally with Premier streams (if any matched by token overlap), or self-hides entirely. No FIP TOUR search row.

- [ ] **Step 5: Visit a legacy WPT (or any non-FIP / non-Premier) tournament page**

Expected: panel self-hides entirely. No nudge, no fallback.

- [ ] **Step 6: Sanity-check at least one non-default locale**

Append `/es`, `/pt`, `/it`, or `/fr` to one of the URLs above (or use the locale switcher).

Expected: nudge copy renders in the selected locale. No raw key strings visible.

- [ ] **Step 7: Stop the dev server when done**

Ctrl-C in the dev server terminal.

No commit — verification only.

---

## Self-review checklist

After completing Task 7, the engineer should confirm:

- [ ] All 7 tasks are checked off.
- [ ] `npx vitest run src/lib/__tests__/` passes (filter helper + existing parser/resolver tests).
- [ ] `npx tsc --noEmit -p .` produces no NEW errors.
- [ ] `npm run lint` produces no NEW warnings in the touched files.
- [ ] Manual smoke test covered all four scenarios in Task 7.

If any of those fail: fix inline, commit the fix, and re-verify.

---

## Addendum — 2026-05-23: FIP-channel heuristic fallback

Discovered during the Task 7 smoke test: `fip-streams-discover` has never reliably populated `fip_court_streams` (cron not in `vercel.json`, last `ops_events` entry 2026-05-14, all logged runs scored `newly_matched: 0`, root cause = two bugs in the in-route matcher). Spec gets an Amendment section laying out the full diagnosis; this plan picks up two extra tasks:

### Task 8 — `applyFipHeuristic` flag in `filterTournamentStreams`

Add an opt-in fallback. When the caller passes `applyFipHeuristic: true`, a FIP-channel video that misses attribution falls through to the same `≥minHeuristicTokens` title-overlap check non-FIP videos already use. Default remains `false`, so the matches page and per-match resolver are untouched.

**Tests added:**
- Keeps a non-attributed FIP video when flag is on and overlap ≥ min.
- Drops a non-attributed FIP video when flag is on but overlap < min.
- Attribution still wins when both attribution and heuristic would match.
- Mixed batch: heuristic keeps the matching FIP video, drops the unrelated one.
- Strict mode (default) still drops a heuristic-eligible FIP video.

### Task 9 — Tournament page sets the flag from the active-window check

```ts
const applyFipHeuristic =
  startsAtMs != null && endsAtMs != null &&
  nowMs >= startsAtMs &&
  nowMs <= endsAtMs + 24 * 60 * 60 * 1000
```

24-hour grace at the tail covers late finals on the closing day. Defensive: if either date is missing the flag stays off.

### Task 10 — Smoke test the heuristic in the browser

Reload an active FIP-tier tournament (Oeiras / Marnes if Finals are still live / Latina) and confirm the live FIP TOUR video surfaces with the green nudge instead of the amber search fallback. Cross-check that a past-edition tournament still shows the amber fallback (flag = false outside the active window).

### Task 11 — Spawn the cleanup task

After this PR is in good shape, spawn a separate session to:

- Delete `/api/cron/fip-streams-discover/route.ts`.
- Drop `fip_court_streams` + `fip_streams_unresolved` tables (one migration).
- Remove `attributedVideoIds` from `FilterTournamentStreamsArgs` and update all call sites + tests.
- Update the ops-dashboard "FIP Streams" tab if it exists, or remove it.
