# Shareable Projection Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Share button to the in-app Projection road view and a dynamic Open Graph image on the dedicated `/projection/[pair]` route, so shared projection links unfurl with a branded road-to-title preview.

**Architecture:** Reuse pure projection helpers (`projection-slug`, `projection-view`, `projection-types`) in both the page and the OG route so pair resolution + road-building stay identical. The OG route fetches via raw Supabase REST (not the JS SDK — `next/og` bundle budget) and renders the signed-off landscape design with base64-embedded photos. The share button mirrors the proven match-page share stack (Capacitor → Web Share → clipboard).

**Tech Stack:** Next.js 16 (App Router, file-convention `opengraph-image.tsx`), `next/og` `ImageResponse` (Satori), `@capacitor/share`, next-intl, Supabase REST, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-22-projection-share-og-design.md`

---

## File Structure

**Create:**
- `src/app/[locale]/(app)/tournaments/[id]/projection/[pair]/opengraph-image.tsx` — dynamic OG image (data fetch + render).
- `src/lib/__tests__/projection-share.test.ts` — unit tests for the share-URL builder, share-payload selector, and `winColor`.

**Modify:**
- `src/lib/projection-view.ts` — export `winColor` + `pairSurnames` (currently duplicated as locals in `ProjectionTab.tsx`).
- `src/app/[locale]/(app)/tournaments/[id]/projection-url.ts` — add `buildProjectionShareUrl` + `buildProjectionSharePayload`.
- `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx` — import the shared helpers; add the Share button + handler to the road view; add "link copied" toast.
- `src/messages/{en,es,pt,it,fr}.json` — add `projectionTab.share*` keys.

**Reuse as-is (pure, no Supabase SDK — safe to import into the OG route):**
- `src/lib/projection-slug.ts` (`buildSlugIndex`, `resolvePairSlug`, `pairSlugFromNames`)
- `src/lib/projection-view.ts` (`buildRoadVM`, `projectedFinishRound`, `isContender`, `winColor`)
- `src/lib/projection-types.ts`

---

## Task 1: Extract shared pure helpers (`winColor`, `pairSurnames`)

These two helpers currently live as private functions in `ProjectionTab.tsx`. The OG route needs identical logic, so extract them to the already-shared `projection-view.ts`.

**Files:**
- Modify: `src/lib/projection-view.ts`
- Modify: `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx` (lines ~32-34 `winColor`, ~43-45 `pairName`)
- Test: `src/lib/__tests__/projection-share.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/projection-share.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { winColor, pairSurnames } from '@/lib/projection-view'

describe('winColor', () => {
  it('lime at >= 0.65', () => expect(winColor(0.65)).toBe('#7ED321'))
  it('gold between 0.45 and 0.65', () => expect(winColor(0.5)).toBe('#F5A623'))
  it('red below 0.45', () => expect(winColor(0.3)).toBe('#FF4655'))
})

describe('pairSurnames', () => {
  it('joins last name tokens', () => {
    expect(pairSurnames([
      { id: '1', name: 'Alex Chozas', country: null, avatarUrl: null },
      { id: '2', name: 'Valentino Libaak', country: null, avatarUrl: null },
    ])).toBe('Chozas / Libaak')
  })
  it('falls back to full name when single token', () => {
    expect(pairSurnames([{ id: '1', name: 'Coello', country: null, avatarUrl: null }])).toBe('Coello')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .worktrees/projection-share && npx vitest run src/lib/__tests__/projection-share.test.ts`
Expected: FAIL — `winColor`/`pairSurnames` not exported from `projection-view`.

- [ ] **Step 3: Add the exports to `projection-view.ts`**

Add near the top of `src/lib/projection-view.ts` (after the type exports, before `buildPlayerLookup`):

```ts
const LIME = '#7ED321'
const GOLD = '#F5A623'
const LIVE = '#FF4655'

/** Win-probability → accent color (matches the Projection tab). */
export function winColor(p: number): string {
  return p >= 0.65 ? LIME : p >= 0.45 ? GOLD : LIVE
}

/** "Chozas / Libaak" — last-name tokens joined, the app's pair display rule. */
export function pairSurnames(players: { name: string }[]): string {
  return players.map((p) => p.name.split(' ').slice(-1)[0] || p.name).join(' / ')
}
```

- [ ] **Step 4: Replace the locals in `ProjectionTab.tsx`**

In `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx`:
- Delete the local `function winColor(...)` (lines ~32-34) and `function pairName(...)` (lines ~43-45).
- Add `winColor, pairSurnames` to the existing import from `@/lib/projection-view` (line 9).
- Replace the two call sites of `pairName(opp.players)` (search the file) with `pairSurnames(opp.players)`.
- Keep the `LIME`/`GOLD`/`LIVE` consts already declared in `ProjectionTab.tsx` — they're used elsewhere in the file; only the two functions move.

- [ ] **Step 5: Run tests + typecheck**

Run: `cd .worktrees/projection-share && npx vitest run src/lib/__tests__/projection-share.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/projection-view.ts src/lib/__tests__/projection-share.test.ts "src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx"
git commit -m "refactor: export winColor + pairSurnames from projection-view for OG reuse"
```

---

## Task 2: Share-URL builder + share-payload selector (pure, tested)

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/projection-url.ts`
- Test: `src/lib/__tests__/projection-share.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `src/lib/__tests__/projection-share.test.ts`:

```ts
import { buildProjectionShareUrl, buildProjectionSharePayload } from '@/app/[locale]/(app)/tournaments/[id]/projection-url'

describe('buildProjectionShareUrl', () => {
  const origin = 'https://padelnachos.com'
  it('no locale prefix for English (as-needed)', () => {
    expect(buildProjectionShareUrl(origin, 'en', 't1', 'coello-tapia'))
      .toBe('https://padelnachos.com/tournaments/t1/projection/coello-tapia')
  })
  it('prefixes non-default locales', () => {
    expect(buildProjectionShareUrl(origin, 'es', 't1', 'coello-tapia'))
      .toBe('https://padelnachos.com/es/tournaments/t1/projection/coello-tapia')
  })
})

describe('buildProjectionSharePayload', () => {
  const t = (k: string, v?: Record<string, unknown>) =>
    ({ shareTitle: `${v?.pair} — road to the title`,
       shareTextContender: `${v?.pct}% to win ${v?.name}`,
       shareTextChampion: `Champions at ${v?.name}!`,
       shareTextEliminated: `Out of ${v?.name}` }[k] ?? k)
  it('contender → pct text', () => {
    const p = buildProjectionSharePayload({ pair: 'Coello / Tapia', tournamentName: 'Valladolid P2', championPct: 47, status: 'active' }, t as never)
    expect(p.title).toBe('Coello / Tapia — road to the title')
    expect(p.text).toBe('47% to win Valladolid P2')
  })
  it('champion → champion text', () => {
    const p = buildProjectionSharePayload({ pair: 'Coello / Tapia', tournamentName: 'Valladolid P2', championPct: 100, status: 'champion' }, t as never)
    expect(p.text).toBe('Champions at Valladolid P2!')
  })
  it('eliminated → eliminated text', () => {
    const p = buildProjectionSharePayload({ pair: 'X / Y', tournamentName: 'Valladolid P2', championPct: 0, status: 'eliminated' }, t as never)
    expect(p.text).toBe('Out of Valladolid P2')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd .worktrees/projection-share && npx vitest run src/lib/__tests__/projection-share.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement in `projection-url.ts`**

Append to `src/app/[locale]/(app)/tournaments/[id]/projection-url.ts`:

```ts
/** Absolute canonical URL for a pair's projection page.
 *  Mirrors next-intl `localePrefix: 'as-needed'` — English ('en') gets no prefix. */
export function buildProjectionShareUrl(
  origin: string,
  locale: string,
  tournamentId: string,
  pairSlug: string,
): string {
  const prefix = locale === 'en' ? '' : `/${locale}`
  return `${origin}${prefix}/tournaments/${tournamentId}/projection/${pairSlug}`
}

export interface ProjectionShareInput {
  pair: string
  tournamentName: string
  championPct: number
  status: 'active' | 'eliminated' | 'champion'
}

/** Localized {title,text} for the share sheet, adapting to the pair's status. */
export function buildProjectionSharePayload(
  input: ProjectionShareInput,
  t: (key: string, values?: Record<string, unknown>) => string,
): { title: string; text: string } {
  const title = t('shareTitle', { pair: input.pair })
  const text =
    input.status === 'champion'
      ? t('shareTextChampion', { name: input.tournamentName })
      : input.status === 'eliminated'
      ? t('shareTextEliminated', { name: input.tournamentName })
      : t('shareTextContender', { pct: input.championPct, name: input.tournamentName })
  return { title, text }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd .worktrees/projection-share && npx vitest run src/lib/__tests__/projection-share.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/__tests__/projection-share.test.ts "src/app/[locale]/(app)/tournaments/[id]/projection-url.ts"
git commit -m "feat: projection share-url builder + share-payload selector"
```

---

## Task 3: i18n keys for share

**Files:**
- Modify: `src/messages/en.json`, `es.json`, `pt.json`, `it.json`, `fr.json` (under `projectionTab`)

- [ ] **Step 1: Add keys to `en.json`**

In `src/messages/en.json`, inside the `projectionTab` object, add:

```json
"shareLabel": "Share",
"shareTitle": "{pair} — road to the title",
"shareTextContender": "{pct}% to win {name} 🏆 See their projected road to the title:",
"shareTextChampion": "Champions at {name}! 🏆 See the road they took:",
"shareTextEliminated": "Their {name} run — see the projected road:",
"shareCopied": "Link copied"
```

- [ ] **Step 2: Add translated keys to the other four locales**

`es.json`:
```json
"shareLabel": "Compartir",
"shareTitle": "{pair} — camino al título",
"shareTextContender": "{pct}% de ganar {name} 🏆 Mira su camino proyectado al título:",
"shareTextChampion": "¡Campeones en {name}! 🏆 Mira el camino que recorrieron:",
"shareTextEliminated": "Su paso por {name} — mira el camino proyectado:",
"shareCopied": "Enlace copiado"
```

`pt.json`:
```json
"shareLabel": "Partilhar",
"shareTitle": "{pair} — caminho até ao título",
"shareTextContender": "{pct}% de vencer {name} 🏆 Veja o caminho projetado até ao título:",
"shareTextChampion": "Campeões em {name}! 🏆 Veja o caminho que percorreram:",
"shareTextEliminated": "O percurso em {name} — veja o caminho projetado:",
"shareCopied": "Link copiado"
```

`it.json`:
```json
"shareLabel": "Condividi",
"shareTitle": "{pair} — strada verso il titolo",
"shareTextContender": "{pct}% di vincere {name} 🏆 Guarda il percorso previsto verso il titolo:",
"shareTextChampion": "Campioni a {name}! 🏆 Guarda il percorso compiuto:",
"shareTextEliminated": "Il loro cammino a {name} — guarda il percorso previsto:",
"shareCopied": "Link copiato"
```

`fr.json`:
```json
"shareLabel": "Partager",
"shareTitle": "{pair} — route vers le titre",
"shareTextContender": "{pct}% de gagner {name} 🏆 Découvrez leur route projetée vers le titre :",
"shareTextChampion": "Champions à {name} ! 🏆 Découvrez le parcours accompli :",
"shareTextEliminated": "Leur parcours à {name} — découvrez la route projetée :",
"shareCopied": "Lien copié"
```

- [ ] **Step 3: Validate JSON parses**

Run: `cd .worktrees/projection-share && for f in en es pt it fr; do node -e "require('./src/messages/$f.json')" && echo "$f ok"; done`
Expected: `en ok` … `fr ok` (no parse errors).

- [ ] **Step 4: Commit**

```bash
git add src/messages/*.json
git commit -m "i18n: add projection share keys (5 locales)"
```

---

## Task 4: Share button + handler in the road view

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx`

Context: the road view starts at the `return (` near line ~267. The "‹ Back" button is the first child (lines ~269-280), followed by the hero banner. We add a flex row that keeps Back on the left and a Share button on the right, plus a "copied" toast.

- [ ] **Step 1: Add imports + state**

At the top of `ProjectionTab.tsx`:
- Add `useLocale` to the next-intl import: `import { useTranslations, useFormatter, useLocale } from 'next-intl'`
- Add: `import { Capacitor } from '@capacitor/core'`
- Add: `import { Share } from '@capacitor/share'`
- Add `buildProjectionShareUrl, buildProjectionSharePayload` to the import from `'./projection-url'` (add the import if not present).

Inside the component body (near the other `useState` calls, ~line 161-166), add:
```ts
const locale = useLocale()
const [shareToast, setShareToast] = useState(false)
```

- [ ] **Step 2: Add the share handler**

Inside the component, after `vm` is computed and before the road `return (` (around line ~266), add:

```ts
const handleShare = async () => {
  if (!vm || !selectedPair) return
  const slug = slugIndex.pairKeyToSlug.get(selectedPair)
  if (!slug) return
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://padelnachos.com'
  const shareUrl = buildProjectionShareUrl(origin, locale, tournamentId, slug)
  const pair = pairSurnames(vm.players)
  // tournamentName isn't passed to this tab — fall back to the document title's
  // tournament segment is unreliable; use the pair + generic. We pass the
  // tournament name in via a new prop (Step 4).
  const { title, text } = buildProjectionSharePayload(
    { pair, tournamentName, championPct: Math.round(vm.championProb * 100), status: vm.status },
    t,
  )

  const canShareViaCapacitor = Capacitor.isNativePlatform()
  const canShareViaWebShare = typeof navigator !== 'undefined' && 'share' in navigator
  const copyFallback = async () => {
    try { await navigator.clipboard.writeText(shareUrl) } catch { /* insecure ctx */ }
    setShareToast(true)
    setTimeout(() => setShareToast(false), 2200)
  }
  try {
    if (canShareViaCapacitor || canShareViaWebShare) {
      await Share.share({ title, text, url: shareUrl, dialogTitle: title })
    } else {
      await copyFallback()
    }
  } catch {
    // user dismissed the sheet — stay quiet
  }
}
```

- [ ] **Step 3: Render the Share button + toast**

Replace the standalone back-button block (the `<button onClick={() => { … setView('list') … }}>‹ {t('back')}</button>`) with a flex row holding Back on the left and Share on the right. The Back button's existing onClick/styles are preserved verbatim — only wrap it:

```tsx
<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0 10px 2px' }}>
  <button onClick={() => {
      if (history.length > 0) {
        setSelectedPair(history[history.length - 1]!)
        setHistory((h) => h.slice(0, -1))
        setExpanded(new Set()); setTbdHint(new Set())
      } else {
        setView('list')
      }
    }}
    style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: SECONDARY, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, padding: 0 }}>
    ‹ {t('back')}
  </button>
  <button onClick={handleShare} aria-label={t('shareLabel')} title={t('shareLabel')}
    style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(126,211,33,0.1)', border: '1px solid rgba(126,211,33,0.3)', cursor: 'pointer', color: LIME, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, padding: '5px 11px', clipPath: CHUNK_CARD }}>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/>
    </svg>
    {t('shareLabel')}
  </button>
</div>
```

Add the toast just inside the road view's root `<div>` (so it overlays). Place it as the last child before the closing of the outer road `<div>`:

```tsx
{shareToast && (
  <div style={{ position: 'fixed', left: '50%', bottom: 90, transform: 'translateX(-50%)', zIndex: 50, background: '#0d0d0d', color: LIME, border: '1px solid rgba(126,211,33,0.4)', padding: '9px 16px', clipPath: CHUNK_CARD, fontSize: 12, fontWeight: 800, letterSpacing: 0.4 }}>
    {t('shareCopied')}
  </div>
)}
```

- [ ] **Step 4: Thread the tournament name into the tab**

The road view needs the tournament name for the share text. Add a `tournamentName` prop:
- In the `ProjectionTab` props type (the destructured object + its inline type, ~lines 84-105), add `tournamentName?: string | null`.
- In `handleShare`, change the fallback so a missing name degrades gracefully:
  ```ts
  const tournamentName = tName ?? ''
  ```
  where `tName` is the new prop (rename the destructured prop to `tournamentName: tName` to avoid shadowing, OR reference the prop directly). Simplest: destructure as `tournamentName,` and use it directly; if undefined, `buildProjectionSharePayload` still works (text just omits a blank name).
- Find the **callers** of `ProjectionTab` and pass `tournamentName`:
  - `grep -rn "<ProjectionTab" src` — the in-app tab caller is the tournament `page.tsx` / its client. Pass the tournament name it already has in scope.
  - `ProjectionRouteClient.tsx` renders the tab for the dedicated route — pass the `tournamentName` it receives from the server page (`meta.name`). If it doesn't currently receive it, add a `tournamentName` prop to `ProjectionRouteClient` and pass `meta.name` from `projection/[pair]/page.tsx` and `projection/page.tsx`.

- [ ] **Step 5: Typecheck + lint**

Run: `cd .worktrees/projection-share && npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Manual check in the running app**

Run the dev server (`npm run dev`, port 3002) and open
`http://localhost:3002/es/tournaments/d6b3d8b9-1395-488c-83f6-8dfe2a9c34a8?tab=projection&category=men&pair=coello-tapia`.
Expected: a lime "Share" button top-right of the road view; clicking on desktop copies the URL and flashes "Enlace copiado"; the copied URL is `…/es/tournaments/d6b3d8b9…/projection/coello-tapia`.

- [ ] **Step 7: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx" "src/app/[locale]/(app)/tournaments/[id]/ProjectionRouteClient.tsx" "src/app/[locale]/(app)/tournaments/[id]/projection/[pair]/page.tsx" "src/app/[locale]/(app)/tournaments/[id]/projection/page.tsx"
git commit -m "feat: share button on projection road view"
```

---

## Task 5: OG image route — data layer

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/projection/[pair]/opengraph-image.tsx`

This task builds the fetch + resolve layer and a fallback image. Rendering of the full design comes in Task 6.

- [ ] **Step 1: Scaffold the route with REST fetch + pair resolution + fallback image**

Create `src/app/[locale]/(app)/tournaments/[id]/projection/[pair]/opengraph-image.tsx`:

```tsx
// Dynamic OG image for a pair's projection road. Mirrors the match OG route:
// raw Supabase REST (no JS SDK — next/og 500 KB bundle budget) + base64-embedded
// images (Satori can't reliably fetch remote <img> at render time).
import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildSlugIndex, resolvePairSlug } from '@/lib/projection-slug'
import { buildRoadVM, projectedFinishRound, isContender, winColor, pairSurnames } from '@/lib/projection-view'
import type { ProjectionRow } from '@/lib/projection-types'
import type { Player } from '@/types/match'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const revalidate = 600

const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const PROJ_COLS = 'category,pair_key,pair_player_ids,tournament_level,status,eliminated_round,champion_prob,finalist_prob,semifinal_prob,rounds,predicted_finish_round,computed_at'

async function restGet<T>(pathAndQuery: string): Promise<T[]> {
  if (!SUPA || !KEY) return []
  const res = await fetch(`${SUPA}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    cache: 'no-store',
  })
  if (!res.ok) return []
  return (await res.json()) as T[]
}

interface TournRow { name: string | null; level: string | null; country: string | null }

async function fetchTournament(id: string): Promise<TournRow | null> {
  const rows = await restGet<TournRow>(`tournaments?id=eq.${encodeURIComponent(id)}&select=name,level,country`)
  return rows[0] ?? null
}

async function fetchProjections(id: string): Promise<ProjectionRow[]> {
  return restGet<ProjectionRow>(`tournament_projections?tournament_id=eq.${encodeURIComponent(id)}&select=${PROJ_COLS}&order=champion_prob.desc`)
}

interface PlayerRow { id: string; name: string | null; country: string | null; avatar_url: string | null; photo_url: string | null }

async function fetchPlayers(ids: string[]): Promise<Map<string, PlayerRow>> {
  const map = new Map<string, PlayerRow>()
  const uniq = [...new Set(ids)].filter(Boolean)
  if (uniq.length === 0) return map
  const inList = uniq.map(encodeURIComponent).join(',')
  const rows = await restGet<PlayerRow>(`players?id=in.(${inList})&select=id,name,country,avatar_url,photo_url`)
  for (const r of rows) map.set(r.id, r)
  return map
}

/** Resolve the slug → its ProjectionRow across categories (mirrors the page). */
async function resolve(id: string, slug: string): Promise<{
  row: ProjectionRow; rows: ProjectionRow[]; nameById: Map<string, string>; players: Map<string, PlayerRow>
} | null> {
  const rows = await fetchProjections(id)
  if (rows.length === 0) return null
  const players = await fetchPlayers(rows.flatMap((r) => r.pair_player_ids))
  const nameById = new Map<string, string>()
  for (const [pid, p] of players) nameById.set(pid, p.name ?? pid)
  const index = buildSlugIndex(rows, nameById)
  const resolved = resolvePairSlug(index, slug)
  if (!resolved) return null
  const row = rows.find((r) => r.pair_key === resolved.pairKey)
  if (!row) return null
  // widen player map to include this row's road opponents
  const oppIds = row.rounds.flatMap((rd) => rd.opponents.flatMap((o) => o.player_ids))
  const more = await fetchPlayers(oppIds)
  for (const [pid, p] of more) { players.set(pid, p); nameById.set(pid, p.name ?? pid) }
  return { row, rows, nameById, players }
}

function fallbackImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#161616,#1A1A1A,#121212)', color: '#EEE4CE', fontSize: 52, fontWeight: 800 }}>
        Road to the title · PadelNachos
      </div>
    ),
    { ...size },
  )
}

export default async function Image({ params }: { params: Promise<{ id: string; pair: string }> }) {
  const { id, pair } = await params
  try {
    const data = await resolve(id, pair)
    const tourn = await fetchTournament(id)
    if (!data || !tourn?.name) return fallbackImage()
    // Render comes in Task 6; for now prove the pipeline with a minimal card.
    return new ImageResponse(
      (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1A1A1A', color: '#EEE4CE', fontSize: 40 }}>
          {pairSurnames(buildRoadVM(data.row, toLookup(data.players), null).players)} · {Math.round(data.row.champion_prob * 100)}%
        </div>
      ),
      { ...size },
    )
  } catch {
    return fallbackImage()
  }
}

/** Build the `Map<string, Player>` lookup buildRoadVM expects from PlayerRows. */
function toLookup(players: Map<string, PlayerRow>): Map<string, Player> {
  const m = new Map<string, Player>()
  for (const [pid, p] of players) {
    m.set(pid, { id: pid, external_id: '', name: p.name ?? '', display_name: p.name, country: p.country, avatar_url: p.avatar_url })
  }
  return m
}
```

- [ ] **Step 2: Typecheck**

Run: `cd .worktrees/projection-share && npx tsc --noEmit`
Expected: no errors. (If `Player` requires more fields, add them to `toLookup` — check `src/types/match.ts`.)

- [ ] **Step 3: Manual smoke test**

With `npm run dev` running, open in a browser:
`http://localhost:3002/tournaments/d6b3d8b9-1395-488c-83f6-8dfe2a9c34a8/projection/coello-tapia/opengraph-image`
Expected: a PNG showing `Coello / Tapia · 47%`. Try a bad slug → fallback image, not a 500.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/projection/[pair]/opengraph-image.tsx"
git commit -m "feat: projection OG image route — data layer + fallback"
```

---

## Task 6: OG image route — full render

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/projection/[pair]/opengraph-image.tsx`

Port the signed-off mock into JSX. The validated mock is committed at `docs/superpowers/specs/assets/2026-06-22-projection-og-mock.html` — open it in a browser and translate its inline styles 1:1 (it's built with real Valladolid P2 / Coello-Tapia data, so it doubles as the expected output). It uses `transform: scale(.5)` on a 1200×630 inner div — port the inner div's **full-size** numbers.

- [ ] **Step 1: Add asset embedders (player photos/headshots + logo + flags)**

Add these helpers to the route file:

```tsx
const FLAG_EMOJI: Record<string, string> = { ES: '🇪🇸', AR: '🇦🇷', BR: '🇧🇷', PT: '🇵🇹', FR: '🇫🇷', IT: '🇮🇹', BE: '🇧🇪', NL: '🇳🇱', SE: '🇸🇪', FI: '🇫🇮', DK: '🇩🇰', DE: '🇩🇪', GB: '🇬🇧', US: '🇺🇸', MX: '🇲🇽', QA: '🇶🇦', AE: '🇦🇪' }
const flag = (c: string | null) => (c ? FLAG_EMOJI[c.toUpperCase()] ?? '' : '')

async function imgDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null
  if (url.toLowerCase().includes('.webp')) return null  // Satori chokes on WebP
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    if (!/^image\/(png|jpeg|jpg|gif|svg)/i.test(ct)) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength > 200_000) return null
    return `data:${ct.split(';')[0]};base64,${Buffer.from(buf).toString('base64')}`
  } catch { return null }
}

let LOGO_CACHE: string | null = null
async function logoDataUrl(): Promise<string | null> {
  if (LOGO_CACHE) return LOGO_CACHE
  try {
    const buf = await readFile(join(process.cwd(), 'public/padelnachos-logo-v2.png'))
    LOGO_CACHE = `data:image/png;base64,${buf.toString('base64')}`
    return LOGO_CACHE
  } catch { return null }
}
```

- [ ] **Step 2: Replace the placeholder render with the full design**

Replace the body of `Image()` (after `resolve`/`fetchTournament`) with the full layout. Build a `RoadVM` via `buildRoadVM(data.row, toLookup(data.players), null)`, embed both players' `photo_url` (fallback `avatar_url`), embed each shown round opponent's `avatar_url` pair, and embed the logo. Compose the JSX porting the mock:

- Root: `display:flex` (Satori requires explicit display on multi-child divs), `width/height 100%`, the dark gradient background, `position:relative`, fontFamily sans.
- **Top strip** (absolute): left `{NAME} · {LEVEL label} · {CATEGORY}` (uppercase, `#9AAEC4`); right `<img src={logo} height={74}>`.
- **Left column** (absolute, width 472): hero lower-third (gradient + clip-path `polygon(0 7%,99% 0,100% 93%,1% 100%)` + lime radial glow) with the two embedded `photo_url` images (height 158, overlapped `marginLeft:-54`), seed `#N` if available (seed not in projection data → omit unless you fetch `tournament_draws`; **omit in v1**), flag emoji + full player names; then the "ROAD TO TROPHY" card (lime-tinted, `CHUNK` clip-path) with localized `roadToTrophy` label, `winsToLift` count (rounds with no result, excluding a first-round bye), the filled trophy SVG, the big lime MONO champion `%`, and the champion bar.
- **Right column** (absolute, left 560): `projectedPath` label, then the gold-spine timeline. For each `vm.rounds` entry (skip `reachProb===0 && !expected` when not active): round node circle, chunky opponent card with round code (`roundF` label for F else the code), embedded opponent pair-avatars (`avatar_url`), `pairSurnames(opp.players)`, and the win `%` colored by `winColor(opp.winProb)`. Final round gets the gold-ringed trophy node + gold-tinted card. Bye round (`!expected` + seeded → here just `!expected`) shows the `byeAdvances` text.
- **Footer** (absolute): left `padelnachos.com · projection`, right `modelEstimate` label.
- **Adaptive headline:** if `!isContender(vm.championProb)` and `status==='active'`, replace the champion-% headline with `ourPrediction` + `projectedToReach` round (slate-tinted) using `projectedFinishRound(vm.rounds)`. If `status==='eliminated'`, show red `eliminated`/`eliminatedIn` text and drop the champion bar. If `status==='champion'`, gold `champions`.

Use `getTranslations` for labels:
```tsx
import { getTranslations } from 'next-intl/server'
// inside Image(), after params:
const { locale } = await params as unknown as { locale: string }
const t = await getTranslations({ locale, namespace: 'projectionTab' })
const ROUND_LABEL: Record<string,string> = { R64:'roundR64',R32:'roundR32',R16:'roundR16',QF:'roundQF',SF:'roundSF',F:'roundF' }
```
(Note: `params` for this route includes `locale`, `id`, `pair` — update the param type to `{ locale: string; id: string; pair: string }`.)

> Implementation reference: `docs/superpowers/specs/assets/2026-06-22-projection-og-mock.html` is the source of truth for spacing, font sizes, and colors. Translate its inline styles 1:1.

- [ ] **Step 3: Typecheck + lint**

Run: `cd .worktrees/projection-share && npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Visual verification against the sign-off**

With `npm run dev` running, open:
`http://localhost:3002/tournaments/d6b3d8b9-1395-488c-83f6-8dfe2a9c34a8/projection/coello-tapia/opengraph-image`
Expected: matches the signed-off mock — hero photos, "4 wins to lift", 47% champion, R16 95% / QF 86% / SF 78% (lime), Final 57% (gold), trophy node, logo top-right.
Also verify:
- A `women` pair slug renders.
- An eliminated pair → red headline, no champion bar.
- `?` no-match slug → fallback image (no 500).

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/projection/[pair]/opengraph-image.tsx"
git commit -m "feat: projection OG image full render (road-to-title card)"
```

---

## Task 7: Verify metadata wiring + share-with-image + final checks

**Files:**
- Verify (no change expected): `src/app/[locale]/(app)/tournaments/[id]/projection/[pair]/page.tsx` `generateMetadata`

- [ ] **Step 1: Confirm the file-convention image is injected**

The route already exports `generateMetadata` with `twitter: { card: 'summary_large_image' }`. Next.js auto-adds the `opengraph-image` file to `openGraph.images` + `twitter.images`. Verify by viewing page source:

Run: `cd .worktrees/projection-share && curl -s "http://localhost:3002/tournaments/d6b3d8b9-1395-488c-83f6-8dfe2a9c34a8/projection/coello-tapia" | grep -iE 'og:image|twitter:image'`
Expected: `og:image` + `twitter:image` meta tags pointing at `…/projection/coello-tapia/opengraph-image…`.

If absent (file-convention + custom `generateMetadata` conflict), add explicit images to `generateMetadata`'s `openGraph`:
```ts
openGraph: { title, description, type: 'website', images: [`/tournaments/${id}/projection/${resolved.canonicalSlug}/opengraph-image`] },
twitter: { card: 'summary_large_image', title, images: [`/tournaments/${id}/projection/${resolved.canonicalSlug}/opengraph-image`] },
```

- [ ] **Step 2: (Optional) attach the OG image as a Web Share file**

To match the match page's Level-2 file share, extend `handleShare` (Task 4) to best-effort fetch the OG image and include it via `navigator.canShare({files})`. Only do this if Step 1 confirms the image renders fast (<3s). Copy the match page's `imageFile` block verbatim, pointing at `/tournaments/${tournamentId}/projection/${slug}/opengraph-image`, guarded by a 3s `AbortController`. Keep the URL-only `Share.share` path as fallback.

- [ ] **Step 3: Full test + build**

Run: `cd .worktrees/projection-share && npx vitest run src/lib/__tests__/projection-share.test.ts && npx tsc --noEmit && npm run lint && npm run build`
Expected: tests pass, no type/lint errors, build succeeds (the OG route compiles within the bundle budget).

- [ ] **Step 4: Validate the unfurl**

Paste the production-style URL into the X Card Validator and/or a WhatsApp chat to confirm the preview renders. (Local: use the `opengraph-image` URL directly; the validator needs a public URL — defer to a Vercel preview deploy.)

- [ ] **Step 5: Commit any metadata change**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/projection/[pair]/page.tsx"
git commit -m "chore: ensure projection OG image wired into metadata"
```

---

## Self-Review Notes (for the implementer)

- **Seed `#N`** in the mock came from `seedByPair` (built from `matches`), which the OG route has no cheap access to → **omitted in v1** (Task 6 Step 2). The hero still reads well without it. Do not block on it.
- **`tournamentName`** must reach `ProjectionTab` for share text (Task 4 Step 4) — both the in-app caller and `ProjectionRouteClient` need to pass it. Grep callers; don't assume one.
- **WebP photos** (e.g. some women players' `photo_url`) are skipped by `imgDataUrl` → falls back to `avatar_url` → initials. Expected, not a bug.
- **Runtime:** do NOT set `export const runtime = 'edge'` — the logo loader uses `node:fs`, which needs the Node serverless runtime (the default, same as the match OG route).
- **`winColor`/`pairSurnames`** are the same in app + OG because both import from `projection-view` (Task 1). If you change thresholds, both update.
```
