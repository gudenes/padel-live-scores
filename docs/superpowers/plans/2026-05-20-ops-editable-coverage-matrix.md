# Ops-editable coverage capability matrix — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a small ops tab that lets operators view + edit a single markdown document (the coverage capability matrix) without going through git, backed by a new `public.ops_docs` table.

**Architecture:** One Supabase table (`ops_docs`) seeded with one row. One API route (`/api/ops/docs/[slug]`) with GET + PUT, auth via the existing `ops_token` cookie pattern. One ops tab (`CoverageMatrixTab.tsx`) with a split editor (textarea + live `react-markdown` preview).

**Tech Stack:** Next.js 16 App Router, Supabase (PostgreSQL + RLS), `react-markdown` + `remark-gfm` (already top-level deps), Vitest for unit tests.

**Spec:** [docs/superpowers/specs/2026-05-20-ops-editable-coverage-matrix-design.md](docs/superpowers/specs/2026-05-20-ops-editable-coverage-matrix-design.md)

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `supabase/migrations/20260520_create_ops_docs.sql` | new | Creates `public.ops_docs` table + RLS, seeds the `coverage-matrix` row |
| `src/app/api/ops/docs/[slug]/route.ts` | new | `GET` and `PUT` handlers, auth via `checkOpsAuth`, exports `validatePutInput` |
| `src/app/api/ops/docs/[slug]/__tests__/route.test.ts` | new | Unit tests for `validatePutInput` (matches `tournament-prize` pattern) |
| `src/app/ops/CoverageMatrixTab.tsx` | new | Tab component — view mode + split-editor edit mode |
| `src/app/ops/OpsClient.tsx` | modify | Register tab key in type union + navGroups + conditional render |

---

## Task 1: Create the `ops_docs` migration

**Files:**
- Create: `supabase/migrations/20260520_create_ops_docs.sql`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260520_create_ops_docs.sql` with this content:

```sql
-- ops_docs: small key-value store for operator-editable reference docs
-- (coverage capability matrix in v1; future docs are row inserts).
--
-- Auth model: the API route at /api/ops/docs/[slug] guards access via
-- the existing ops_token cookie (checkOpsAuth) + uses the service-role
-- key for the actual SELECT / UPSERT, bypassing RLS. We still enable
-- RLS as defence-in-depth so the anon key can never read or write,
-- even if the route's auth check were ever bypassed.

create table if not exists public.ops_docs (
  slug         text primary key,
  content      text not null,
  updated_at   timestamptz not null default now(),
  updated_by   text
);

alter table public.ops_docs enable row level security;

-- No policies for anon / authenticated. Service-role key bypasses RLS.
-- (Intentional — same pattern as our other ops-only tables.)

-- Seed the coverage matrix.
insert into public.ops_docs (slug, content, updated_by)
values (
  'coverage-matrix',
  $matrix$# PadelNachos coverage capability matrix

Last updated: 2026-05-20 — seeded version. Edit freely via this page.

---

## A. Active tournament levels

| Level | Source mix | Status |
|---|---|---|
| `finals` | mixed | Premier Padel — top circuit |
| `major` | mostly FIP-discovered | Premier Padel |
| `p1` | FIP-discovered | Premier Padel |
| `p2` | FIP-discovered | Premier Padel |
| `fip_platinum` | FIP-discovered | FIP Pro Tour |
| `fip_gold` | FIP-discovered | FIP Pro Tour |
| `fip_silver` | FIP-discovered | FIP Pro Tour |
| `fip_bronze` | FIP-discovered | FIP Pro Tour |
| `fip_championship` | FIP-discovered | FIP Marquee |
| `fip_promises` | FIP-discovered | FIP Development (junior) |
| `fip_beyond` | FIP-discovered | FIP Development (amateur) |
| `fip_other` | mixed | FIP catch-all |
| `wpt_*` | padelapi-historical | Legacy — circuit dissolved |
| `fip_hexagon` / `fip_star` / `fip_rise` / `fip_promotion` / `fip_finals` | — | Schema reserved, never seen |

## B. Capability matrix

Legend: ● automated production · ◐ partial / has known gaps · ○ manual-ops only · ✕ not available

| Capability | Premier (finals/major/p1/p2) | FIP Pro Tour (platinum→bronze) | FIP Championship | FIP Promises | FIP Beyond | WPT legacy |
|---|---|---|---|---|---|---|
| Discovery (tournament exists in DB) | ● | ● | ● | ● | ● | ○ history |
| Metadata — name, dates, country, level | ● | ● | ● | ● | ● | ○ |
| Venue — name + address | ● | ◐ | ◐ | ◐ | ✕ usually | ○ |
| Prize money | ● | ● | ● | ◐ | ✕ | ○ |
| Logo + cover image | ● | ● | ● | ● | ◐ | ○ |
| Entry list — players + pairs | ● | ● HTML+PDF | ● | ● | ◐ thin names | ✕ |
| Draw / bracket — FIP HTML AJAX | ● | ● when published | ● | ● | ◐ | ✕ |
| Draw / bracket — FIP PDF, manual ops upload | ● | ● | ● | ● | ● | n/a |
| Draw / bracket — FIP PDF, automated download | ✕ gap | ✕ gap | ✕ gap | ✕ gap | ✕ gap | n/a |
| Matches — bootstrap from OOP when no draw | ● | ● *(shipped 2026-05-19)* | ● | ● | ● | ✕ |
| OOP — court + day + label | ● | ● | ● | ● | ◐ | ✕ |
| Schedule — parsed `scheduled_at` UTC | ● | ● when OOP present | ● | ● | ◐ | ✕ |
| Live state — scheduled → live → finished | ● Pusher relay + Crionet poll | ● OOP + results sweep | ● | ● | ◐ | ✕ |
| Live point-by-point — per-point feed | ● Crionet live-poller-loop | ✕ Crionet doesn't expose | ✕ | ✕ | ✕ | ✕ |
| Live momentum chart (PBP-derived) | ● | ✕ | ✕ | ✕ | ✕ | ✕ |
| Final score — set scores + winner | ● | ● fip-results-writer | ● | ● | ◐ | historical only |
| Match stats — Crionet `getmatchstats` | ● Premier-tier only | ✕ | ✕ | ✕ | ✕ | ✕ |
| Push notifications — live start | ● with score updates | ● status-only | ● | ● | ◐ | n/a |
| Push notifications — finish | ● | ● | ● | ● | ◐ | n/a |
| Push largeIcon — avatar / circuit logo | ● padelapi-hosted | ● rehosted padelfip | ● | ● | ◐ | n/a |
| YouTube "Where to watch" | ● broadcaster groups | ● `fip_court_streams` | ● | ◐ | ✕ | n/a |
| Player profiles — ranking, race, history | ◐ above ranking cutoff only | ◐ above ranking cutoff only | ◐ | ◐ | ✕ | static |
| Player avatars in feed/UI | ● padelapi-hosted | ● padelfip rehosted | ● | ◐ | ✕ | static |

## C. Source-of-truth per tier

| Tier | Discovery | Metadata enrich | Entry list | Draw | OOP/Schedule | Live state | Live PBP | Stats | Final |
|---|---|---|---|---|---|---|---|---|---|
| Premier Padel | FIP WP + Premier API | FIP event page | FIP page / PDF | FIP HTML + Crionet draw widget | Crionet OOP widget | padelgod live-poller (Crionet) | padelgod live-poller (Crionet) | padelgod match-stats-fetcher (Crionet) | Crionet results widget |
| FIP Pro Tour | FIP WP API | FIP event page enricher | FIP page + auto-PDF via Sonnet | FIP HTML when published; otherwise ops PDF upload; OOP fallback when neither | Crionet OOP widget | OOP + results sweep | — | — | Crionet results widget |
| FIP Promises / Beyond | FIP WP API | FIP event page | thin / often absent | FIP HTML when published; ops PDF upload; OOP fallback | Crionet OOP widget | OOP + results sweep | — | — | Crionet results widget |
| WPT legacy | historical padelapi | none | none | none | none | none | none | none | snapshot in DB |

Note: padelapi.org is paused (`PADELAPI_PAUSED=true`) — padelgod owns all writes. Premier-tier still gets full coverage because padelgod's live-poller subscribes to Crionet's per-match endpoint, which is exposed for Premier-tier events.

## D. Do not regress

Working capabilities. Any change to draws, OOP, or live coverage must preserve these.

1. **Manual draw PDF upload.** ops UI → `POST src/app/api/ops/parse-draw` → `parseDrawPdfWithSonnet` → `POST src/app/api/ops/seed-draw` → `tournament_draws` rows. `DrawTab` reads `tournament_draws` and overlays markers onto the bracket.
2. **Automated entry-list PDF download.** `src/lib/fip-entry-list-pipeline.ts` — downloads `pdf:` URLs from FIP AJAX, parses with Sonnet, resolves to players. Already production-proven.
3. **Match-identifier pair sanity check.** `padelgod/src/lib/match-identifier.ts` court-only twin matching is gated by an unordered-pair check. Prevents court-swap hijacks (Brussels P2 incident, 2026-04-23).
4. **Schedule-review human approval flow.** Option-A safety: never overwrite a populated player FK; only fill NULLs. Any OOP-driven INSERT path must preserve this when later runs touch the same row.
5. **PBP live-poll subscription budget.** `live-poller-manager` spawns per-match loops, Premier-tier only. Don't widen the gate without budget review.
6. **`PADELAPI_PAUSED` kill-switch.** Currently `true`. Any new worker must NOT take a hard dependency on padelapi.
7. **OOP-as-draw fallback for all FIP tiers** *(shipped 2026-05-19, PR #353)*. `fip-draw-populator` creates thin matches from `oop_snapshots` for any `fip_*` tier when the bracket is empty. Composite-key UPDATE NULL-only enrichment backfills FKs when the bracket later arrives. Premier and WPT remain excluded.

## E. Known gaps

Gaps the matrix exposes today. Each is a candidate for a separate plan.

1. **Automated FIP draw PDF download.** FIP increasingly publishes Pro Tour draws as PDF-only. Entry lists already have this pattern (`fip-entry-list-pipeline.ts`); the same shape ports to draws. Until then, draws need either an FIP AJAX bracket or a manual ops PDF upload to land in `tournament_draws`.
2. **`tournament_draws` → `public.matches` enrichment.** Manual PDF uploads write to `tournament_draws` but `fip-draw-populator` doesn't read from there — so manual uploads enrich the DrawTab UI but don't backfill FKs on existing thin matches in `public.matches`. Fix: have the populator also read `tournament_draws` as an enrichment source.
3. **Entry-list player ranking ingestion.** FIP entry list pages and PDFs include per-player ranking in the source we already scrape, but `fip-entry-list-populator` currently drops the ranking column. Result: players below the public WP-JSON ranking cutoff (e.g. Leonardo Villa P208430, Francesco Carocci P208910 in Latina Q1) end up as bare shells in `players` with NULL `ranking` even though the data was visible upstream. Fix: extend the populator's player-row UPSERT to include ranking, gated through `filterUpdateByPriority` so it only fills NULLs when the WP-JSON-sourced cron hasn't already won the field.
4. **Player-profile worker isn't attempting low-ranked players.** `profile_attempt_at` is still epoch on shell rows. There's likely a gate in the `player-profile` worker excluding players with no ranking. Worth investigating once gap #3 is fixed.
$matrix$,
  'seed-migration'
)
on conflict (slug) do nothing;
```

- [ ] **Step 2: Apply the migration locally**

Run:

```bash
npx supabase db reset
```

Expected: no errors. The `ops_docs` table now exists and has one row.

If you don't run a local Supabase: alternatively, apply directly to your dev project with `npx supabase db push` — but make sure your `.env.local` points at a dev project, not prod.

- [ ] **Step 3: Verify the seed row exists**

Run:

```bash
npx supabase db execute --sql "select slug, length(content) as content_len, updated_by from public.ops_docs;"
```

Expected output: one row with `slug='coverage-matrix'`, `content_len` around 5500-7000 (the matrix is long), `updated_by='seed-migration'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260520_create_ops_docs.sql
git commit -m "feat(ops): create ops_docs table + seed coverage matrix"
```

---

## Task 2: API route — validatePutInput (TDD)

**Files:**
- Create: `src/app/api/ops/docs/[slug]/route.ts`
- Create: `src/app/api/ops/docs/[slug]/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/ops/docs/[slug]/__tests__/route.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { validatePutInput } from '../route'

describe('validatePutInput', () => {
  it('accepts a non-empty content string', () => {
    expect(validatePutInput({ content: '# Hello\n\nWorld' }))
      .toEqual({ ok: true, value: { content: '# Hello\n\nWorld' } })
  })

  it('accepts an empty content string (operator wants to blank the doc)', () => {
    expect(validatePutInput({ content: '' }))
      .toEqual({ ok: true, value: { content: '' } })
  })

  it('rejects missing content', () => {
    expect(validatePutInput({}).ok).toBe(false)
  })

  it('rejects non-string content', () => {
    expect(validatePutInput({ content: 123 as unknown as string }).ok).toBe(false)
  })

  it('rejects null body', () => {
    expect(validatePutInput(null).ok).toBe(false)
  })

  it('rejects array body', () => {
    expect(validatePutInput([] as unknown).ok).toBe(false)
  })

  it('caps content at 200_000 chars to avoid runaway payloads', () => {
    const huge = 'x'.repeat(200_001)
    expect(validatePutInput({ content: huge }).ok).toBe(false)
  })

  it('accepts content right at the 200_000 limit', () => {
    const exactly = 'x'.repeat(200_000)
    expect(validatePutInput({ content: exactly }).ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run src/app/api/ops/docs/'[slug]'/__tests__/route.test.ts
```

Expected: FAIL with `Cannot find module '../route'` (file doesn't exist yet).

- [ ] **Step 3: Write the route stub with the validator**

Create `src/app/api/ops/docs/[slug]/route.ts`:

```ts
// GET + PUT for /api/ops/docs/[slug] — small key-value store for
// operator-editable reference docs (coverage capability matrix in v1).
//
// Auth: ops_token cookie via checkOpsAuth (same pattern as every other
// /api/ops/* route). Underlying writes use the service-role key, bypassing
// RLS — RLS is defence-in-depth, not the primary access gate.

const MAX_CONTENT_LEN = 200_000

type PutInput = { content: string }

type ValidationResult =
  | { ok: true; value: PutInput }
  | { ok: false; reason: string }

export function validatePutInput(body: unknown): ValidationResult {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'body must be a JSON object' }
  }
  const b = body as Record<string, unknown>
  if (typeof b.content !== 'string') {
    return { ok: false, reason: 'content must be a string' }
  }
  if (b.content.length > MAX_CONTENT_LEN) {
    return { ok: false, reason: `content exceeds max length of ${MAX_CONTENT_LEN}` }
  }
  return { ok: true, value: { content: b.content } }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run src/app/api/ops/docs/'[slug]'/__tests__/route.test.ts
```

Expected: PASS — all 8 cases.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ops/docs/
git commit -m "feat(ops): scaffold /api/ops/docs/[slug] with validator"
```

---

## Task 3: API route — GET handler

**Files:**
- Modify: `src/app/api/ops/docs/[slug]/route.ts`

- [ ] **Step 1: Add the GET handler**

Append to `src/app/api/ops/docs/[slug]/route.ts`:

```ts
import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )
}

interface DocRow {
  slug: string
  content: string
  updated_at: string
  updated_by: string | null
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const { slug } = await params
  if (!slug || typeof slug !== 'string' || slug.length > 200) {
    return Response.json({ error: 'invalid slug' }, { status: 400 })
  }

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('ops_docs')
    .select('slug, content, updated_at, updated_by')
    .eq('slug', slug)
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ doc: null }, { status: 200 })

  return Response.json({ doc: data as DocRow })
}
```

Note: the `params` argument is a Promise in Next.js 16 App Router — different from Next 15. Always `await params` at the start of the handler.

- [ ] **Step 2: Verify the file compiles**

Run:

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "src/app/api/ops/docs" | head -5
```

Expected: no output (no errors in this file).

- [ ] **Step 3: Smoke-test the GET locally**

Start the dev server (separate terminal):

```bash
npm run dev
```

Then hit the endpoint with the ops token:

```bash
curl -s -b "ops_token=$CRON_SECRET" "http://localhost:3002/api/ops/docs/coverage-matrix" | head -c 500
```

Expected: JSON with `{"doc":{"slug":"coverage-matrix","content":"# PadelNachos coverage capability matrix...","updated_at":"...","updated_by":"seed-migration"}}`.

Also verify unauthenticated 401:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3002/api/ops/docs/coverage-matrix"
```

Expected: `401`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ops/docs/'[slug]'/route.ts
git commit -m "feat(ops): GET /api/ops/docs/[slug]"
```

---

## Task 4: API route — PUT handler

**Files:**
- Modify: `src/app/api/ops/docs/[slug]/route.ts`

- [ ] **Step 1: Add the PUT handler**

Append to `src/app/api/ops/docs/[slug]/route.ts`:

```ts
import { auth } from '@/auth'

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const { slug } = await params
  if (!slug || typeof slug !== 'string' || slug.length > 200) {
    return Response.json({ error: 'invalid slug' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }

  const v = validatePutInput(body)
  if (!v.ok) return Response.json({ error: v.reason }, { status: 400 })

  // Opportunistic: stamp updated_by with the operator's Auth.js session
  // email when one is present. Many ops requests are made cookie-only
  // (no full session) — in that case we leave updated_by as null.
  let updatedBy: string | null = null
  try {
    const session = await auth()
    updatedBy = session?.user?.email ?? null
  } catch {
    // No session — fine, leave null.
  }

  const supabase = getSupabase()
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('ops_docs')
    .upsert(
      {
        slug,
        content: v.value.content,
        updated_at: nowIso,
        updated_by: updatedBy,
      },
      { onConflict: 'slug' },
    )
    .select('slug, content, updated_at, updated_by')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ doc: data as DocRow })
}
```

- [ ] **Step 2: Verify the file still compiles**

Run:

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "src/app/api/ops/docs" | head -5
```

Expected: no output.

- [ ] **Step 3: Smoke-test PUT locally**

With dev server running, edit the doc:

```bash
curl -s -X PUT -b "ops_token=$CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"content":"# Matrix\n\nEdited via PUT smoke test"}' \
  "http://localhost:3002/api/ops/docs/coverage-matrix" | head -c 300
```

Expected: JSON with the updated row, `updated_at` is a fresh timestamp.

Re-GET to verify persisted:

```bash
curl -s -b "ops_token=$CRON_SECRET" "http://localhost:3002/api/ops/docs/coverage-matrix" | head -c 200
```

Expected: content shows the test string.

**Restore the seed content** before moving on (your local DB is now out of sync with the migration):

```bash
npx supabase db reset
```

Verify unauthenticated PUT 401s:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X PUT \
  -H "Content-Type: application/json" \
  -d '{"content":"x"}' \
  "http://localhost:3002/api/ops/docs/coverage-matrix"
```

Expected: `401`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ops/docs/'[slug]'/route.ts
git commit -m "feat(ops): PUT /api/ops/docs/[slug]"
```

---

## Task 5: Tab — view mode

**Files:**
- Create: `src/app/ops/CoverageMatrixTab.tsx`

- [ ] **Step 1: Create the tab with view mode only**

Create `src/app/ops/CoverageMatrixTab.tsx`:

```tsx
'use client'
// src/app/ops/CoverageMatrixTab.tsx
//
// Ops tab that hosts the coverage capability matrix as a single
// editable markdown document. Read-only view by default; click "Edit"
// for a split textarea + live react-markdown preview.
//
// Backend: GET / PUT /api/ops/docs/coverage-matrix. Auth piggybacks on
// the ops_token cookie set by middleware on /ops?token=$CRON_SECRET.

import { useEffect, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const SLUG = 'coverage-matrix'
const API = `/api/ops/docs/${SLUG}`

interface DocRow {
  slug: string
  content: string
  updated_at: string
  updated_by: string | null
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export default function CoverageMatrixTab() {
  const [doc, setDoc] = useState<DocRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(API, { credentials: 'include' })
      if (!res.ok) {
        setError(`Load failed (${res.status})`)
        return
      }
      const json = await res.json()
      if (!json.doc) {
        setError('Doc not found — re-run the seed migration.')
        return
      }
      setDoc(json.doc as DocRow)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) {
    return <div style={{ padding: 16, color: '#666' }}>Loading…</div>
  }
  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ color: '#b91c1c', marginBottom: 8 }}>{error}</div>
        <button onClick={load} style={{ padding: '6px 12px', cursor: 'pointer' }}>Retry</button>
      </div>
    )
  }
  if (!doc) return null

  return (
    <div style={{ padding: 16, maxWidth: 1200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Coverage Matrix</h2>
      </div>
      <div className="markdown-body" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: 20 }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: '#888' }}>
        Last edited {timeAgo(doc.updated_at)}
        {doc.updated_by && ` by ${doc.updated_by}`}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify the file compiles**

Run:

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "CoverageMatrixTab" | head -5
```

Expected: no output.

- [ ] **Step 3: Commit (no UI wiring yet — that's Task 7)**

```bash
git add src/app/ops/CoverageMatrixTab.tsx
git commit -m "feat(ops): CoverageMatrixTab view mode"
```

---

## Task 6: Tab — edit mode (split editor)

**Files:**
- Modify: `src/app/ops/CoverageMatrixTab.tsx`

- [ ] **Step 1: Add edit-mode state + split editor**

Replace the contents of `src/app/ops/CoverageMatrixTab.tsx` with:

```tsx
'use client'
// src/app/ops/CoverageMatrixTab.tsx
//
// Ops tab that hosts the coverage capability matrix as a single
// editable markdown document. Read-only view by default; click "Edit"
// for a split textarea + live react-markdown preview.
//
// Backend: GET / PUT /api/ops/docs/coverage-matrix. Auth piggybacks on
// the ops_token cookie set by middleware on /ops?token=$CRON_SECRET.

import { useEffect, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const SLUG = 'coverage-matrix'
const API = `/api/ops/docs/${SLUG}`

interface DocRow {
  slug: string
  content: string
  updated_at: string
  updated_by: string | null
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export default function CoverageMatrixTab() {
  const [doc, setDoc] = useState<DocRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(API, { credentials: 'include' })
      if (!res.ok) {
        setError(`Load failed (${res.status})`)
        return
      }
      const json = await res.json()
      if (!json.doc) {
        setError('Doc not found — re-run the seed migration.')
        return
      }
      setDoc(json.doc as DocRow)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const onEdit = () => {
    if (!doc) return
    setDraft(doc.content)
    setSaveError(null)
    setEditing(true)
  }

  const onCancel = () => {
    setEditing(false)
    setSaveError(null)
  }

  const onSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(API, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      })
      const json = await res.json()
      if (!res.ok) {
        setSaveError(json.error ?? `Save failed (${res.status})`)
        return
      }
      setDoc(json.doc as DocRow)
      setEditing(false)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div style={{ padding: 16, color: '#666' }}>Loading…</div>
  }
  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ color: '#b91c1c', marginBottom: 8 }}>{error}</div>
        <button onClick={load} style={{ padding: '6px 12px', cursor: 'pointer' }}>Retry</button>
      </div>
    )
  }
  if (!doc) return null

  return (
    <div style={{ padding: 16, maxWidth: 1600 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Coverage Matrix</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {!editing && (
            <button onClick={onEdit} style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>
              Edit
            </button>
          )}
          {editing && (
            <>
              <button
                onClick={onSave}
                disabled={saving}
                style={{
                  padding: '6px 12px', cursor: saving ? 'wait' : 'pointer',
                  fontSize: 13, fontWeight: 600,
                  background: '#111', color: '#fff', border: 'none', borderRadius: 4,
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={onCancel}
                disabled={saving}
                style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {saveError && (
        <div style={{
          marginBottom: 10, padding: 8, fontSize: 12,
          color: '#b91c1c', background: '#fee2e2', borderRadius: 4,
        }}>
          {saveError}
        </div>
      )}

      {!editing && (
        <div className="markdown-body" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: 20 }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
        </div>
      )}

      {editing && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, height: 'calc(100vh - 180px)' }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            style={{
              width: '100%', height: '100%', resize: 'none',
              fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
              fontSize: 13, lineHeight: 1.5,
              padding: 12, border: '1px solid #e5e7eb', borderRadius: 6,
            }}
          />
          <div
            className="markdown-body"
            style={{
              height: '100%', overflow: 'auto',
              background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: 20,
            }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
          </div>
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: 11, color: '#888' }}>
        Last edited {timeAgo(doc.updated_at)}
        {doc.updated_by && ` by ${doc.updated_by}`}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify the file still compiles**

Run:

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "CoverageMatrixTab" | head -5
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/app/ops/CoverageMatrixTab.tsx
git commit -m "feat(ops): CoverageMatrixTab split editor + save"
```

---

## Task 7: Wire the tab into OpsClient

**Files:**
- Modify: `src/app/ops/OpsClient.tsx`

- [ ] **Step 1: Add the import**

Open `src/app/ops/OpsClient.tsx`. After the existing tab imports near the top (around line 30, after `import TournamentCoversTab from './TournamentCoversTab'`), add:

```ts
import CoverageMatrixTab from './CoverageMatrixTab'
```

- [ ] **Step 2: Add 'coverage-matrix' to the tab key union**

Find this line (around line 326):

```ts
const [tab, setTab] = useState<'ongoing' | 'health' | 'data' | 'simulator' | 'players' | 'brands' | 'architecture' | 'padelgod-shadow' | 'padelgod-entries' | 'tournament-explorer' | 'tournament-dedup' | 'padelgod-health' | 'yt-channels' | 'news' | 'highlight-picker' | 'tournament-covers'>('ongoing')
```

Add `| 'coverage-matrix'` to the union (place it right before the closing `>`):

```ts
const [tab, setTab] = useState<'ongoing' | 'health' | 'data' | 'simulator' | 'players' | 'brands' | 'architecture' | 'padelgod-shadow' | 'padelgod-entries' | 'tournament-explorer' | 'tournament-dedup' | 'padelgod-health' | 'yt-channels' | 'news' | 'highlight-picker' | 'tournament-covers' | 'coverage-matrix'>('ongoing')
```

- [ ] **Step 3: Add the nav entry**

Find the `Data Management` group in `navGroups` (around line 448). Replace it with this version that adds the Coverage Matrix entry right before Architecture:

```ts
    {
      label: 'Data Management',
      items: [
        { key: 'players' as const, label: 'Players', badge: null },
        { key: 'brands' as const, label: 'Brands & Equipment', badge: null },
        { key: 'tournament-covers' as const, label: 'Tournament covers', badge: null },
        { key: 'yt-channels' as const, label: 'YT Channels', badge: null },
        { key: 'news' as const, label: 'News', badge: null },
        { key: 'highlight-picker' as const, label: 'Highlight Picker', badge: null },
        // Schedule tab retired — apply flow now inline in Tournament
        // Explorer → Matches → OOP subtab (see ScheduleReviewPanel).
        { key: 'coverage-matrix' as const, label: 'Coverage Matrix', badge: null },
        { key: 'architecture' as const, label: 'Architecture', badge: null },
      ],
    },
```

- [ ] **Step 4: Add the conditional render**

Find the existing conditional render block (around line 994):

```tsx
      {tab === 'architecture' && <>
        <ArchitectureTab />
```

Just above it, add:

```tsx
      {tab === 'coverage-matrix' && <CoverageMatrixTab />}
```

- [ ] **Step 5: Verify TypeScript still compiles**

Run:

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "OpsClient|CoverageMatrix" | head -5
```

Expected: no output.

- [ ] **Step 6: Smoke-test in the browser**

Start the dev server if it's not already running:

```bash
npm run dev
```

Open `http://localhost:3002/ops?token=$CRON_SECRET` (substitute the real `CRON_SECRET` value). Then:

1. Click **Coverage Matrix** in the left sidebar under Data Management.
2. Confirm the matrix renders with the seeded content — section A/B/C/D/E all visible, tables formatted as tables.
3. Click **Edit**. Confirm the textarea on the left shows the markdown and the right column re-renders the preview live as you type.
4. Add a single test character (e.g. append `!` to the title). Click **Save**. Confirm the "Saving…" label flashes and you return to view mode.
5. Refresh the page (`Cmd-R`). Confirm the `!` is still there.
6. Click **Edit** again, remove the `!`, click **Save**. Confirm content is back to the seeded version.

- [ ] **Step 7: Commit**

```bash
git add src/app/ops/OpsClient.tsx
git commit -m "feat(ops): register CoverageMatrixTab in OpsClient"
```

---

## Task 8: Open the PR

- [ ] **Step 1: Push the branch**

```bash
git push -u origin "$(git branch --show-current)"
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(ops): editable coverage capability matrix tab" --body "$(cat <<'EOF'
## Summary

Implements the [ops-editable coverage matrix spec](docs/superpowers/specs/2026-05-20-ops-editable-coverage-matrix-design.md). New Coverage Matrix tab in ops that hosts the capability matrix as an editable markdown document.

- New table: \`public.ops_docs\` (slug, content, updated_at, updated_by) + RLS, seeded with the matrix.
- New API: \`GET /api/ops/docs/[slug]\` and \`PUT /api/ops/docs/[slug]\`, auth via \`checkOpsAuth\`.
- New tab: split editor (textarea + live react-markdown preview), positioned next to Architecture.

## Why

The matrix is the kind of reference doc that goes stale fast (every new integration changes a cell). Letting operators edit it from ops avoids a PR for every typo or status flip, and keeps the doc next to the people who use it.

## Test plan

- [ ] \`npx vitest run src/app/api/ops/docs/'[slug]'/__tests__/route.test.ts\` — validator unit tests pass.
- [ ] \`npm run build\` — clean.
- [ ] Apply the migration to staging and confirm the seed row is present.
- [ ] Visit \`/ops?token=…\` → Coverage Matrix → confirm matrix renders.
- [ ] Edit → make a small change → Save → refresh → change persisted.
- [ ] Edit → make a small change → Cancel → confirm change discarded.
- [ ] Confirm unauthenticated \`PUT\` → 401.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checklist (for the implementing engineer)

After completing all tasks, run through this:

- [ ] Every task's "Run test" step actually ran and showed the expected outcome.
- [ ] All tests still pass: `npx vitest run`.
- [ ] No new lint warnings: `npm run lint`.
- [ ] The migration applied cleanly on a fresh `npx supabase db reset`.
- [ ] The dev-server smoke flow in Task 7 Step 6 worked end-to-end.
- [ ] PR description references the spec.
