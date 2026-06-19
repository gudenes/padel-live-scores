# Graceful 404 for Orphaned Entity Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tournament/player/match detail routes return a real 404 with a branded, localized "not found" page when the entity UUID no longer exists, instead of a blank HTTP-200 shell.

**Architecture:** Each of the three detail routes already has a server `layout.tsx`. Add a fail-open existence gate (shared helper) at the top of each layout that calls `notFound()` only on a *confirmed*-missing row, and add one shared `src/app/[locale]/not-found.tsx` that all three (plus the existing `matches/[date]` and `news/[slug]` `notFound()` calls) render into.

**Tech Stack:** Next.js 16.2.0 (App Router), next-intl 4.9.1, Supabase JS, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-19-orphan-entity-404-design.md`

---

## Key facts (verified against installed docs)

- `notFound()` (from `next/navigation`) throws `NEXT_HTTP_ERROR_FALLBACK;404`. **It must be called OUTSIDE any `try/catch`** that would swallow it (all three layouts wrap their fetches in error-swallowing `try/catch`). The gate is added *before* the existing try block.
- `not-found.tsx` renders the nearest ancestor boundary. The three layouts live at `[locale]/(app)/tournaments/[id]/`, `[locale]/player/[id]/`, `[locale]/match/[id]/`. Their nearest common ancestor boundary is **`src/app/[locale]/not-found.tsx`** — one file covers all three.
- `src/app/[locale]/layout.tsx` runs `setRequestLocale(locale)` and wraps children in `NextIntlClientProvider`. Because it is an ancestor of the not-found boundary, it still renders when `notFound()` fires — so the request locale is set and `getTranslations()` resolves the correct locale inside `not-found.tsx`. (Verified at runtime in Task 5.)
- `createServerClient` is re-exported from `src/lib/supabase.ts` (alias of `createServiceClient`).
- `EmptyState` (`src/components/EmptyState.tsx`) is a server-compatible component taking `title`, `subtitle?`, and `action?` (rendered with `marginTop:16`).
- `Link` (locale-aware) comes from `@/i18n/navigation`.

## File Structure

- **Create** `src/lib/entity-exists.ts` — `rowExistsById(client, table, id)`: returns `true` (exists), `false` (definitively absent), or `null` (indeterminate → caller fails open).
- **Create** `src/lib/__tests__/entity-exists.test.ts` — unit tests for the helper.
- **Create** `src/app/[locale]/not-found.tsx` — branded localized not-found page.
- **Modify** `src/messages/{en,es,pt,it,fr}.json` — add `notFound` namespace.
- **Modify** `src/app/[locale]/(app)/tournaments/[id]/layout.tsx` — add gate.
- **Modify** `src/app/[locale]/player/[id]/layout.tsx` — add gate.
- **Modify** `src/app/[locale]/match/[id]/layout.tsx` — add gate.

---

## Task 1: `rowExistsById` existence helper (TDD)

**Files:**
- Create: `src/lib/entity-exists.ts`
- Test: `src/lib/__tests__/entity-exists.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/entity-exists.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { rowExistsById } from '../entity-exists'

// Build a fake supabase client whose query chain resolves to `result`.
// Chain used by the helper: from(table).select('id').eq('id', id).maybeSingle()
function fakeClient(result: { data: unknown; error: unknown } | Error) {
  const maybeSingle = () =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
  const eq = () => ({ maybeSingle })
  const select = () => ({ eq })
  const from = () => ({ select })
  return { from } as unknown as Parameters<typeof rowExistsById>[0]
}

describe('rowExistsById', () => {
  it('returns true when a row is found', async () => {
    const client = fakeClient({ data: { id: 'abc' }, error: null })
    expect(await rowExistsById(client, 'tournaments', 'abc')).toBe(true)
  })

  it('returns false when no row exists (data null, no error)', async () => {
    const client = fakeClient({ data: null, error: null })
    expect(await rowExistsById(client, 'tournaments', 'missing')).toBe(false)
  })

  it('returns false for an invalid UUID (Postgres 22P02)', async () => {
    const client = fakeClient({ data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } })
    expect(await rowExistsById(client, 'tournaments', 'not-a-uuid')).toBe(false)
  })

  it('returns null (indeterminate) on a transport/connection error', async () => {
    const client = fakeClient({ data: null, error: { code: '08006', message: 'connection failure' } })
    expect(await rowExistsById(client, 'tournaments', 'abc')).toBe(null)
  })

  it('returns null (indeterminate) when the query throws', async () => {
    const client = fakeClient(new Error('network down'))
    expect(await rowExistsById(client, 'tournaments', 'abc')).toBe(null)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/entity-exists.test.ts`
Expected: FAIL — "Failed to resolve import '../entity-exists'" / `rowExistsById is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/entity-exists.ts`:

```ts
// src/lib/entity-exists.ts
//
// Orphan-page guard helper. Detail-route layouts call this to decide whether
// to render a 404 for an entity id that no longer exists (e.g. after a
// tournament/player merge or hard-delete).
//
// Tri-state return — callers MUST fail open on `null`:
//   true   → row exists, render normally
//   false  → row definitively absent (or an un-storable id) → notFound()
//   null   → existence could not be determined (DB/transport error) →
//            render children, never 404 the whole site over a Supabase blip
import type { SupabaseClient } from '@supabase/supabase-js'

// Postgres error codes that mean "this id can never identify a row" — treat
// as definitively absent so malformed ids 404 instead of failing open to a
// blank shell. 22P02 = invalid_text_representation (bad UUID syntax).
const DEFINITELY_ABSENT_CODES = new Set(['22P02'])

export async function rowExistsById(
  // Loosely typed so layouts can pass createServerClient() without generics.
  client: Pick<SupabaseClient, 'from'>,
  table: string,
  id: string,
): Promise<boolean | null> {
  try {
    const { data, error } = await client
      .from(table)
      .select('id')
      .eq('id', id)
      .maybeSingle()

    if (error) {
      const code = (error as { code?: string }).code
      if (code && DEFINITELY_ABSENT_CODES.has(code)) return false
      // Any other error is a real query/transport failure → indeterminate.
      return null
    }

    return data != null
  } catch {
    // Thrown exception (network, client misconfig) → indeterminate.
    return null
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/entity-exists.test.ts`
Expected: PASS (5 tests, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add src/lib/entity-exists.ts src/lib/__tests__/entity-exists.test.ts
git commit -m "feat: add rowExistsById orphan-page existence helper"
```

---

## Task 2: Add `notFound` i18n namespace to all 5 locales

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

- [ ] **Step 1: Add the namespace to `en.json`**

Add this top-level key (insert as a new object member; keep JSON valid — add a comma after the previous closing brace). Place it after the existing `"betting"` entry (the current last key per the file's key order, or anywhere valid):

```json
  "notFound": {
    "title": "This page doesn't exist",
    "body": "The page you're looking for may have been removed, renamed, or never existed.",
    "cta": "Back to PadelNachos"
  }
```

- [ ] **Step 2: Add the namespace to `es.json`**

```json
  "notFound": {
    "title": "Esta página no existe",
    "body": "La página que buscas puede haber sido eliminada, renombrada o nunca existió.",
    "cta": "Volver a PadelNachos"
  }
```

- [ ] **Step 3: Add the namespace to `pt.json`**

```json
  "notFound": {
    "title": "Esta página não existe",
    "body": "A página que procuras pode ter sido removida, renomeada ou nunca existiu.",
    "cta": "Voltar ao PadelNachos"
  }
```

- [ ] **Step 4: Add the namespace to `it.json`**

```json
  "notFound": {
    "title": "Questa pagina non esiste",
    "body": "La pagina che cerchi potrebbe essere stata rimossa, rinominata o non è mai esistita.",
    "cta": "Torna a PadelNachos"
  }
```

- [ ] **Step 5: Add the namespace to `fr.json`**

```json
  "notFound": {
    "title": "Cette page n'existe pas",
    "body": "La page que vous recherchez a peut-être été supprimée, renommée ou n'a jamais existé.",
    "cta": "Retour à PadelNachos"
  }
```

- [ ] **Step 6: Verify all five files are valid JSON**

Run:
```bash
for l in en es pt it fr; do node -e "require('./src/messages/$l.json').notFound.title" && echo "$l ok"; done
```
Expected: `en ok`, `es ok`, `pt ok`, `it ok`, `fr ok` (no JSON parse errors).

- [ ] **Step 7: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "i18n: add notFound namespace for orphan-page 404"
```

---

## Task 3: Branded localized not-found page

**Files:**
- Create: `src/app/[locale]/not-found.tsx`

- [ ] **Step 1: Create the not-found page**

Create `src/app/[locale]/not-found.tsx`:

```tsx
// src/app/[locale]/not-found.tsx
//
// Branded, localized 404 boundary for the [locale] subtree. Rendered whenever
// notFound() fires inside any descendant segment — the tournament/player/match
// detail layouts (orphaned entity ids) plus the existing matches/[date] and
// news/[slug] notFound() calls. The ancestor [locale]/layout.tsx still runs
// (it sets the request locale + i18n provider), so getTranslations() resolves
// the correct locale here even though not-found components receive no params.
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import EmptyState from '@/components/EmptyState'

const BG_BASE = '#1A1A1A'
const GREEN = '#7ED321'
const CHUNKY_BUTTON = 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)'

export default async function LocaleNotFound() {
  const t = await getTranslations('notFound')

  return (
    <div
      style={{
        background: BG_BASE,
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div style={{ maxWidth: 420, width: '100%' }}>
        <EmptyState
          title={t('title')}
          subtitle={t('body')}
          action={
            <Link
              href="/"
              style={{
                display: 'inline-block',
                background: GREEN,
                color: '#0A0A0A',
                fontWeight: 800,
                fontSize: 14,
                padding: '10px 22px',
                textDecoration: 'none',
                clipPath: CHUNKY_BUTTON,
              }}
            >
              {t('cta')}
            </Link>
          }
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check the new file**

Run: `npx tsc --noEmit 2>&1 | grep "not-found" || echo "no type errors in not-found.tsx"`
Expected: `no type errors in not-found.tsx`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/not-found.tsx"
git commit -m "feat: branded localized not-found page for [locale] subtree"
```

---

## Task 4: Wire the existence gate into the three layouts

Each layout gets the same 5-line gate at the very top of its default export, **before** the existing `try` block, so `notFound()` is never swallowed.

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/layout.tsx`
- Modify: `src/app/[locale]/player/[id]/layout.tsx`
- Modify: `src/app/[locale]/match/[id]/layout.tsx`

- [ ] **Step 1: Tournament layout — add imports**

In `src/app/[locale]/(app)/tournaments/[id]/layout.tsx`, add to the import block (the file already imports `createServerClient` from `@/lib/supabase`):

```ts
import { notFound } from 'next/navigation'
import { rowExistsById } from '@/lib/entity-exists'
```

- [ ] **Step 2: Tournament layout — insert the gate**

The current default export starts (line ~76):

```ts
export default async function TournamentLayout({ params, children }: Props) {
  const { id, locale } = await params
  let jsonLd: object | null = null
```

Insert the gate immediately after `const { id, locale } = await params`:

```ts
export default async function TournamentLayout({ params, children }: Props) {
  const { id, locale } = await params

  // Orphan guard: 404 a confirmed-missing tournament (e.g. merged/deleted id).
  // Fail open on indeterminate DB errors so a Supabase blip can't 404 the app.
  let tournamentExists: boolean | null = null
  try {
    tournamentExists = await rowExistsById(createServerClient(), 'tournaments', id)
  } catch {
    tournamentExists = null
  }
  if (tournamentExists === false) notFound()

  let jsonLd: object | null = null
```

- [ ] **Step 3: Player layout — add imports**

In `src/app/[locale]/player/[id]/layout.tsx`, add (it already imports `createServerClient`):

```ts
import { notFound } from 'next/navigation'
import { rowExistsById } from '@/lib/entity-exists'
```

- [ ] **Step 4: Player layout — insert the gate**

The current default export (line ~96) starts:

```ts
export default async function PlayerLayout({ params, children }: Props) {
  let jsonLd: object | null = null
  let playerName: string | null = null
  let summary = null

  try {
    const { id } = await params
```

Replace that opening with (hoist `id`, add the gate before the `try`):

```ts
export default async function PlayerLayout({ params, children }: Props) {
  const { id } = await params

  // Orphan guard: 404 a confirmed-missing player (e.g. merged-away duplicate).
  // Fail open on indeterminate DB errors.
  let playerExists: boolean | null = null
  try {
    playerExists = await rowExistsById(createServerClient(), 'players', id)
  } catch {
    playerExists = null
  }
  if (playerExists === false) notFound()

  let jsonLd: object | null = null
  let playerName: string | null = null
  let summary = null

  try {
```

(Note: the original `const { id } = await params` inside the `try` is now removed — `id` is already in scope. Leave the rest of the `try` body unchanged.)

- [ ] **Step 5: Match layout — add imports**

In `src/app/[locale]/match/[id]/layout.tsx`, add (it already imports `createServerClient`):

```ts
import { notFound } from 'next/navigation'
import { rowExistsById } from '@/lib/entity-exists'
```

- [ ] **Step 6: Match layout — insert the gate**

The current default export starts:

```ts
export default async function MatchLayout({ params, children }: Props) {
  let jsonLd: object | null = null
  let h1Text: string | null = null
  let summary: ReturnType<typeof buildMatchSummary> | null = null
  let seoData: Awaited<ReturnType<typeof fetchSeoBroadcasters>> | null = null
  let seoSentence: string | null = null

  try {
    const { id, locale } = await params
```

Replace that opening with (hoist `id`, add gate before the `try`; keep `locale` resolved inside the try as before by re-destructuring, since the try body uses `locale`):

```ts
export default async function MatchLayout({ params, children }: Props) {
  const { id } = await params

  // Orphan guard: 404 a confirmed-missing match (e.g. dedup'd phantom id).
  // Fail open on indeterminate DB errors.
  let matchExists: boolean | null = null
  try {
    matchExists = await rowExistsById(createServerClient(), 'matches', id)
  } catch {
    matchExists = null
  }
  if (matchExists === false) notFound()

  let jsonLd: object | null = null
  let h1Text: string | null = null
  let summary: ReturnType<typeof buildMatchSummary> | null = null
  let seoData: Awaited<ReturnType<typeof fetchSeoBroadcasters>> | null = null
  let seoSentence: string | null = null

  try {
    const { locale } = await params
```

(Note: `id` is hoisted out; inside the `try`, change `const { id, locale } = await params` to `const { locale } = await params`. The match query already references `id` from the outer scope — leave `.eq('id', id)` unchanged.)

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "tournaments/\[id\]/layout|player/\[id\]/layout|match/\[id\]/layout" || echo "no type errors in the three layouts"`
Expected: `no type errors in the three layouts`.

- [ ] **Step 8: Lint the changed files**

Run: `npx eslint "src/app/[locale]/(app)/tournaments/[id]/layout.tsx" "src/app/[locale]/player/[id]/layout.tsx" "src/app/[locale]/match/[id]/layout.tsx" "src/app/[locale]/not-found.tsx" src/lib/entity-exists.ts`
Expected: no errors (warnings acceptable).

- [ ] **Step 9: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/layout.tsx" "src/app/[locale]/player/[id]/layout.tsx" "src/app/[locale]/match/[id]/layout.tsx"
git commit -m "feat: 404 orphaned tournament/player/match detail pages"
```

---

## Task 5: Manual verification in the running app

Per the project "test locally always" rule, verify behavior in the running app — code-reading is not sufficient. Use the dev server and the preview/browser tools.

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (serves on `http://localhost:3002`). Wait for "Ready".

- [ ] **Step 2: Verify a dead TOURNAMENT id 404s with the branded page**

Visit `http://localhost:3002/pt/tournaments/702e6071-7deb-4eb4-b639-50b04b97d3e9`.
Expected:
- The branded not-found page renders (dark background, mascot, "Esta página não existe", green "Voltar ao PadelNachos" button) — **not** a blank shell and **not** Next's default white 404.
- The CTA links to `/pt`.
- Confirm the response is a 404 for the document request:
  `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3002/pt/tournaments/702e6071-7deb-4eb4-b639-50b04b97d3e9`
  (Next streams app-router responses, so a 200 here is acceptable per Next's docs **as long as** the branded not-found UI renders and Next injects `<meta name="robots" content="noindex">` — verify that meta tag is present in the page source.)

- [ ] **Step 3: Verify locale resolution**

Visit the same dead id under `/it/...`, `/fr/...`, `/es/...`, and `/` (English):
- Each must render the not-found copy **in that locale** (e.g. `/it/...` → "Questa pagina non esiste").
- If any locale renders English instead, the request locale isn't reaching the not-found page. Fallback fix (apply only if needed): in `not-found.tsx`, read the locale from the request and pass it explicitly — `import { headers } from 'next/headers'`, derive the first path segment from `headers().get('x-next-intl-locale')` (set by the next-intl middleware in `proxy.ts`) or the referer/pathname, and call `getTranslations({ locale, namespace: 'notFound' })`. Re-verify all five locales, then re-commit.

- [ ] **Step 4: Verify a dead PLAYER and a dead MATCH id 404 the same way**

Visit (UUIDs that don't exist):
- `http://localhost:3002/player/00000000-0000-0000-0000-000000000000`
- `http://localhost:3002/match/00000000-0000-0000-0000-000000000000`
Expected: branded not-found page for both.

- [ ] **Step 5: Verify REAL entities still render (no regression)**

Pick a real tournament, player, and match id from the DB:
```bash
node -e "(async()=>{const{createServiceClient}=require('./src/lib/supabase');const s=createServiceClient();for(const t of ['tournaments','players','matches']){const{data}=await s.from(t).select('id').limit(1);console.log(t,data?.[0]?.id)}})()"
```
Visit each (`/tournaments/<id>`, `/player/<id>`, `/match/<id>`) and confirm the normal detail page renders — **no** not-found page.

- [ ] **Step 6: Verify a GHOST tournament does NOT 404**

A "ghost" row exists but has no `name`/`starts_at`. Find one if present:
```bash
node -e "(async()=>{const{createServiceClient}=require('./src/lib/supabase');const s=createServiceClient();const{data}=await s.from('tournaments').select('id,name,starts_at').or('name.is.null,starts_at.is.null').limit(1);console.log(data?.[0]??'no ghost rows present')})()"
```
If one exists, visit `/tournaments/<ghost-id>` and confirm it renders the existing (em-dash) detail page with `robots noindex` — **not** the not-found page. (If no ghost rows exist, note this and skip — the gate only 404s on *absent* rows, so present-but-incomplete rows are unaffected by construction.)

- [ ] **Step 7: Run the full unit suite + build to confirm no regressions**

Run: `npx vitest run src/lib/__tests__/entity-exists.test.ts && npm run build`
Expected: helper tests pass; production build succeeds.

- [ ] **Step 8: Final commit (if any fallback fix from Step 3 was applied)**

```bash
git add -A && git commit -m "fix: ensure not-found page resolves request locale" || echo "nothing to commit"
```

---

## Self-Review notes

- **Spec coverage:** existence gate (Task 4) ✓ · fail-open on DB error (Task 1 `null` + Task 4 try/catch) ✓ · 404 only on absent rows, ghosts unaffected (Task 4 gates on `=== false`; Step 6 verifies) ✓ · branded localized page (Task 3 + Task 2) ✓ · all three entities (Task 4) ✓ · emission side needs no work (spec-verified; no task) ✓ · Next 16 + next-intl wiring (Key facts + Task 5 Step 3 verification + fallback) ✓.
- **Type consistency:** helper named `rowExistsById` and called identically in all three layouts; tri-state `boolean | null` compared with `=== false` everywhere.
