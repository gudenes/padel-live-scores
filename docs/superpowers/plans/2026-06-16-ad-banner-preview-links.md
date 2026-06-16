# Ad Banner Preview Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shareable `?ad_preview=<bannerId>` link that surfaces one specific ad banner (ignoring its `active` flag, country targeting, and the consent gate) on the live site, so stakeholders can sign off before it goes live.

**Architecture:** Pure URL-param feature, no schema change. A new public endpoint fetches a single banner by id without the `active` filter. The public `StickyAdBanner` detects the param via a `useAdPreview()` hook (sessionStorage-persisted, `useSyncExternalStore`), force-renders that banner bypassing country + consent, and suppresses impression/click tracking while showing a "PREVIEW" badge. The admin `/ads` page gets a "Copy preview link" action per banner.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Supabase, Vitest. Spec: `docs/superpowers/specs/2026-06-16-ad-banner-preview-links-design.md`.

> **Convention note:** the public site host is hardcoded as `https://padelnachos.com` throughout this repo (`src/app/layout.tsx`, the sitemap routes). This plan follows that convention rather than introducing a new env var (a divergence from the spec's "e.g. NEXT_PUBLIC_PUBLIC_SITE_URL" suggestion — the hardcoded host is the established pattern).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/ad-preview.ts` (**new**) | Pure `pickPreviewId(fromUrl, fromStorage)` resolver. Framework-free, unit-tested. |
| `src/lib/__tests__/ad-preview.test.ts` (**new**) | Tests for `pickPreviewId`. |
| `src/app/api/ads/preview/route.ts` (**new**) | `GET /api/ads/preview?id=` → one banner, no `active` filter. Exports pure `parsePreviewId`. |
| `src/app/api/ads/preview/__tests__/route.test.ts` (**new**) | Tests for `parsePreviewId`. |
| `src/hooks/useAdPreview.ts` (**new**) | Thin `useSyncExternalStore` hook reading `?ad_preview` + sessionStorage. |
| `src/components/ads/SponsorCard.tsx` (modify) | `preview` prop: suppress tracking, render "PREVIEW" badge. |
| `src/components/ads/AdSlot.tsx` (modify) | Pass `preview` through. |
| `src/components/ads/StickyAdBanner.tsx` (modify) | Preview branch: fetch + override + bypass gates. |
| `apps/ops/src/app/(app)/ads/_components/AdsTab.tsx` (modify) | "Copy preview link" row action. |

No database migration. `/api/ads/active`, `src/lib/ad-banner-resolver.ts` (`pickBanner`), and the impression/click endpoints are untouched.

---

## Task 1: Pure preview-id resolver

**Files:**
- Create: `src/lib/ad-preview.ts`
- Test: `src/lib/__tests__/ad-preview.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/ad-preview.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pickPreviewId } from '@/lib/ad-preview'

describe('pickPreviewId', () => {
  it('prefers the URL param over the stored value', () => {
    expect(pickPreviewId('url-id', 'stored-id')).toBe('url-id')
  })

  it('falls back to the stored value when no URL param', () => {
    expect(pickPreviewId(null, 'stored-id')).toBe('stored-id')
  })

  it('returns null when neither is present', () => {
    expect(pickPreviewId(null, null)).toBeNull()
  })

  it('treats empty / whitespace as absent', () => {
    expect(pickPreviewId('  ', '')).toBeNull()
    expect(pickPreviewId('', 'stored-id')).toBe('stored-id')
    expect(pickPreviewId('  url-id  ', null)).toBe('url-id')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/ad-preview.test.ts`
Expected: FAIL — cannot resolve `@/lib/ad-preview` (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/lib/ad-preview.ts`:

```ts
// src/lib/ad-preview.ts
// Pure helper for the ad-banner preview-link feature. Framework-free so it's
// trivially unit-testable; the useAdPreview hook consumes it.

/** sessionStorage key the preview id is persisted under for the session. */
export const AD_PREVIEW_STORAGE_KEY = 'ad_preview'

/**
 * Decide the active preview banner id. A fresh ?ad_preview=<id> in the URL wins;
 * else the value persisted for the session; else null. Empty / whitespace is
 * treated as "no preview".
 */
export function pickPreviewId(
  fromUrl: string | null,
  fromStorage: string | null,
): string | null {
  const url = (fromUrl ?? '').trim()
  if (url) return url
  const stored = (fromStorage ?? '').trim()
  return stored || null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/ad-preview.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ad-preview.ts src/lib/__tests__/ad-preview.test.ts
git commit -m "feat(ads): pure preview-id resolver for banner preview links"
```

---

## Task 2: Public `/api/ads/preview` endpoint

**Files:**
- Create: `src/app/api/ads/preview/route.ts`
- Test: `src/app/api/ads/preview/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/ads/preview/__tests__/route.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parsePreviewId } from '../route'

describe('parsePreviewId', () => {
  it('returns the trimmed id', () => {
    expect(parsePreviewId('abc-123')).toBe('abc-123')
    expect(parsePreviewId('  abc-123  ')).toBe('abc-123')
  })

  it('returns null for missing / empty input', () => {
    expect(parsePreviewId(null)).toBeNull()
    expect(parsePreviewId('')).toBeNull()
    expect(parsePreviewId('   ')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/ads/preview/__tests__/route.test.ts`
Expected: FAIL — cannot resolve `../route` (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/app/api/ads/preview/route.ts`. Mirrors `src/app/api/ads/active/route.ts` (same column set, same client factory) but selects ONE banner by id and drops the `.eq('active', true)` filter:

```ts
// src/app/api/ads/preview/route.ts
// Public read of a SINGLE banner by id, WITHOUT the active filter — powers the
// shareable ?ad_preview=<id> link so an operator can show a not-yet-live banner
// to reviewers for sign-off. Distinct from /api/ads/active, which hard-filters
// active=true and is aggressively cached for every visitor.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import type { AdBanner } from '@/lib/ad-banner-resolver'

/** Pull a usable banner id from ?id=. Returns null when absent / blank. */
export function parsePreviewId(raw: string | null): string | null {
  const id = (raw ?? '').trim()
  return id || null
}

export async function GET(req: NextRequest) {
  const id = parsePreviewId(req.nextUrl.searchParams.get('id'))
  if (!id) return NextResponse.json({ banner: null })

  const supabase = createServerClient()
  try {
    const { data } = await supabase
      .from('ad_banners')
      .select('id, name, country_codes, slot, image_url, click_url, active, weight')
      .eq('id', id)
      .maybeSingle()
    return NextResponse.json(
      { banner: (data ?? null) as AdBanner | null },
      // Per-id and used rarely; do not cache like /active.
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch {
    // Degrade to "no banner" rather than erroring the caller.
    return NextResponse.json({ banner: null })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/ads/preview/__tests__/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ads/preview/route.ts src/app/api/ads/preview/__tests__/route.test.ts
git commit -m "feat(ads): /api/ads/preview returns one banner ignoring active flag"
```

---

## Task 3: `useAdPreview` hook

**Files:**
- Create: `src/hooks/useAdPreview.ts`

No unit test (the pure decision logic is covered by Task 1's `pickPreviewId`; the hook is a thin browser-API wrapper verified manually in Task 6). Mirrors `src/hooks/useGeoCountry.ts`'s `useSyncExternalStore` pattern so the server snapshot is `null` (no hydration mismatch).

- [ ] **Step 1: Write the implementation**

Create `src/hooks/useAdPreview.ts`:

```ts
// src/hooks/useAdPreview.ts
'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { pickPreviewId, AD_PREVIEW_STORAGE_KEY } from '@/lib/ad-preview'

/**
 * Active preview banner id, or null. Reads ?ad_preview=<id> from the URL; the
 * URL param wins and is persisted to sessionStorage so it survives in-app
 * navigation (which drops the query string) and clears when the tab closes.
 *
 * Mirrors useGeoCountry: useSyncExternalStore keeps the server snapshot null
 * (no preview during SSR) so there is no hydration mismatch. getSnapshot stays
 * pure — the sessionStorage WRITE happens in a mount effect, not in read().
 */
function read(): string | null {
  if (typeof window === 'undefined') return null
  const fromUrl = new URLSearchParams(window.location.search).get('ad_preview')
  let stored: string | null = null
  try {
    stored = window.sessionStorage.getItem(AD_PREVIEW_STORAGE_KEY)
  } catch {
    stored = null
  }
  return pickPreviewId(fromUrl, stored)
}

const subscribe = () => () => {}

export function useAdPreview(): string | null {
  const id = useSyncExternalStore(subscribe, read, () => null)
  // Persist a fresh ?ad_preview id for the session so later in-app navigation
  // (which drops the query string) keeps previewing. Mirrors the ?geo cookie
  // write in StickyAdBanner.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('ad_preview')
    if (fromUrl && fromUrl.trim()) {
      try {
        window.sessionStorage.setItem(AD_PREVIEW_STORAGE_KEY, fromUrl.trim())
      } catch {
        // ignore (private mode / storage disabled)
      }
    }
  }, [])
  return id
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "useAdPreview\|ad-preview" || echo "no type errors in new files"`
Expected: `no type errors in new files`.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAdPreview.ts
git commit -m "feat(ads): useAdPreview hook reads ?ad_preview, persists for session"
```

---

## Task 4: Wire preview into the public render path

Three coordinated edits: `SponsorCard` (suppress tracking + badge), `AdSlot` (pass-through), `StickyAdBanner` (fetch + override + bypass gates).

**Files:**
- Modify: `src/components/ads/SponsorCard.tsx`
- Modify: `src/components/ads/AdSlot.tsx`
- Modify: `src/components/ads/StickyAdBanner.tsx`

- [ ] **Step 1: Add `preview` to `SponsorCard`**

In `src/components/ads/SponsorCard.tsx`, add `preview` to the props type and destructure (default `false`):

```tsx
export function SponsorCard({
  banner,
  slot,
  variant,
  matchId,
  preview = false,
}: {
  banner: AdBanner
  slot: AdSlotId
  variant: 'feed' | 'detail' | 'sticky'
  matchId?: string
  preview?: boolean
}) {
```

Guard the impression effect so preview views are never tracked — replace the existing effect body:

```tsx
  const impressionFired = useRef(false)
  useEffect(() => {
    if (preview) return // preview / sign-off views are not tracked
    if (impressionFired.current) return
    impressionFired.current = true
    trackImpression(slot, banner.id)
  }, [slot, banner.id, preview])
```

Guard the click handler — replace the `onClick` on the `<a>`:

```tsx
      onClick={() => { if (!preview) trackClick(slot, banner.id, matchId) }}
```

Swap the disclosure tag for a PREVIEW badge in preview mode — replace the `<span>...Ad</span>` block (the absolutely-positioned tag) with:

```tsx
      {/* Disclosure tag — "PREVIEW" (amber) for sign-off links, else "Ad". */}
      <span
        style={{
          position: 'absolute',
          top: 3,
          right: 3,
          fontSize: 7,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          color: preview ? '#1f2937' : '#e5e7eb',
          background: preview ? '#fbbf24' : 'rgba(0,0,0,0.5)',
          padding: '1px 4px',
          borderRadius: 3,
          fontWeight: 700,
          lineHeight: 1.4,
        }}
      >
        {preview ? 'Preview' : 'Ad'}
      </span>
```

- [ ] **Step 2: Pass `preview` through `AdSlot`**

In `src/components/ads/AdSlot.tsx`, add `preview` to props and forward it to `SponsorCard`:

```tsx
export function AdSlot({
  slot,
  variant,
  banner,
  context,
  preview = false,
}: {
  slot: AdSlotId
  variant: 'feed' | 'detail' | 'sticky'
  banner: AdBanner | null
  context?: { matchId?: string }
  preview?: boolean
}) {
  if (banner) {
    return <SponsorCard banner={banner} slot={slot} variant={variant} matchId={context?.matchId} preview={preview} />
  }
  return <NetworkAdSlot slot={slot} variant={variant} />
}
```

- [ ] **Step 3: Add the preview branch to `StickyAdBanner`**

In `src/components/ads/StickyAdBanner.tsx`, add imports near the top (alongside the existing imports):

```tsx
import { useAdPreview } from '@/hooks/useAdPreview'
import type { AdBanner } from '@/lib/ad-banner-resolver'
```

Inside `StickyAdBanner()`, after the existing `const active = useActiveBanner('sticky-bottom')` line, add the preview fetch and override. Replace the existing `const banner = ...` line and the `const visible = ...` block with:

```tsx
  // Preview mode: a ?ad_preview=<id> link force-shows one specific banner
  // (even if active=false) for stakeholder sign-off — bypassing country
  // targeting and the consent gate. Resolves to null when no link / unknown id.
  const previewId = useAdPreview()
  const [previewBanner, setPreviewBanner] = useState<AdBanner | null>(null)
  useEffect(() => {
    if (!previewId) {
      setPreviewBanner(null)
      return
    }
    let alive = true
    void fetch(`/api/ads/preview?id=${encodeURIComponent(previewId)}`)
      .then((r) => (r.ok ? r.json() : { banner: null }))
      .then((d: { banner: AdBanner | null }) => {
        if (alive) setPreviewBanner(d.banner)
      })
      .catch(() => {
        if (alive) setPreviewBanner(null)
      })
    return () => {
      alive = false
    }
  }, [previewId])

  const isPreview = !!previewId && !!previewBanner
  // While a preview link is open we never show the default ad — only the
  // resolved preview banner (null until it loads / if the id is unknown).
  const banner = previewId
    ? previewBanner
    : active
      ? pickBanner(active.banners, country)
      : null
  // Preview bypasses country + consent (still gated to ad routes); otherwise the
  // normal consent / native gate applies.
  const visible = previewId
    ? !!previewBanner && isAdRoute(pathname)
    : !!banner && isAdRoute(pathname) && (hasDecided || testingGeo || isNative)
```

Then pass `preview={isPreview}` to the `AdSlot` at the bottom — replace the existing `<AdSlot .../>` line:

```tsx
      <AdSlot slot="sticky-bottom" variant="sticky" banner={banner} preview={isPreview} />
```

> Note: `useState` and `useEffect` are already imported at the top of `StickyAdBanner.tsx`. The `country`, `pathname`, `hasDecided`, `testingGeo`, `isNative` consts above are unchanged.

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "SponsorCard|AdSlot|StickyAdBanner" || echo "no type errors in ad components"`
Expected: `no type errors in ad components`.

Run: `npm run lint 2>&1 | grep -iE "SponsorCard|AdSlot|StickyAdBanner" || echo "lint clean for ad components"`
Expected: `lint clean for ad components`.

- [ ] **Step 5: Commit**

```bash
git add src/components/ads/SponsorCard.tsx src/components/ads/AdSlot.tsx src/components/ads/StickyAdBanner.tsx
git commit -m "feat(ads): force-show preview banner on ?ad_preview, untracked, badged"
```

---

## Task 5: Admin "Copy preview link" action

**Files:**
- Modify: `apps/ops/src/app/(app)/ads/_components/AdsTab.tsx`

The preview URL is inlined here (the public `ad-preview.ts` lib lives in the separate root app and isn't import-reachable from `apps/ops`; the host is hardcoded across the repo anyway).

- [ ] **Step 1: Add the copy handler**

In `apps/ops/src/app/(app)/ads/_components/AdsTab.tsx`, add this function inside the `AdsTab` component, next to `deleteBanner` (around line 108–113):

```tsx
  async function copyPreviewLink(id: string) {
    const url = `https://padelnachos.com/matches?ad_preview=${encodeURIComponent(id)}`
    try {
      await navigator.clipboard.writeText(url)
      setMsg('Preview link copied — share it for sign-off.')
    } catch {
      // Clipboard blocked (e.g. non-secure context): surface the URL to copy by hand.
      setMsg(`Preview link: ${url}`)
    }
  }
```

- [ ] **Step 2: Add the button to the Actions cell**

In the row Actions `<td>` (currently the Edit + Delete buttons, around line 178–181), add a "Copy preview link" button before Edit, shown only when the banner has a creative to preview:

```tsx
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {b.image_url && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => copyPreviewLink(b.id)}>Copy preview link</Button>{' '}
                          </>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => { setEditing(b); setMsg('') }}>Edit</Button>{' '}
                        <Button variant="danger" size="sm" onClick={() => deleteBanner(b.id, b.name)}>Delete</Button>
                      </td>
```

- [ ] **Step 3: Typecheck the ops app**

Run: `cd apps/ops && npx tsc --noEmit 2>&1 | grep -i "AdsTab" || echo "no type errors in AdsTab"; cd ../..`
Expected: `no type errors in AdsTab`.

- [ ] **Step 4: Commit**

```bash
git add apps/ops/src/app/\(app\)/ads/_components/AdsTab.tsx
git commit -m "feat(ads): copy-preview-link action on each banner row"
```

---

## Task 6: Manual end-to-end verification

No automated browser test exists for this UI; verify in the running app (project rule: verify previewable changes locally before calling work done).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (serves on `localhost:3002`). Ensure there is at least one banner row — the existing **AceProGrip** banner (ES, `active=Off`) is ideal because it's inactive, which proves the `active` bypass.

- [ ] **Step 2: Grab a preview link from admin**

Open the local ops `/ads` page, find the AceProGrip row, click **Copy preview link**. Confirm the toast shows "Preview link copied…". The link is `https://padelnachos.com/matches?ad_preview=<uuid>` — for local testing replace the host with `http://localhost:3002`.

- [ ] **Step 3: Confirm the preview renders (active bypass + country bypass)**

Open `http://localhost:3002/matches?ad_preview=<uuid>` (use the AceProGrip id). Verify:
  - The banner renders at the bottom **despite `active=false`**.
  - It renders **regardless of your geo** (the banner targets ES; you should see it even if your `geo-country` is not ES — confirm by also trying `?ad_preview=<uuid>&geo=US`).
  - The disclosure tag reads **"Preview"** (amber), not "Ad".
  - It appears with **no cookie-consent interaction** required.

- [ ] **Step 4: Confirm navigation persistence**

From that page, navigate to a match detail (`/match/...`) or player page within the app (no query string). The preview banner should still show (sessionStorage). Open a brand-new tab to `http://localhost:3002/matches` with **no** param — the preview banner must **NOT** show (fresh session, default behavior intact).

- [ ] **Step 5: Confirm tracking is suppressed**

With the preview banner visible, check `ad_impressions` / `ad_clicks` are not written for the preview view. Either watch the Network tab for **no** POST to `/api/ads/impression` or `/api/ads/click` while previewing, or query the DB before/after and confirm the counts are unchanged. Clicking the preview banner should still open `click_url` (in a new tab) but must not POST to `/api/ads/click`.

- [ ] **Step 6: Confirm the default path is unchanged**

On a normal `/matches` load (no `ad_preview`), behavior matches today: only `active=true` banners matching the visitor country show, behind the consent gate. (If no active banner targets your country, nothing shows — expected.)

- [ ] **Step 7: Final build check + commit (if any fixes were needed)**

Run: `npm run build`
Expected: build succeeds.

```bash
git add -A
git commit -m "chore(ads): verification fixes for preview links" # only if Step 1-6 surfaced fixes
```

---

## Self-Review notes

- **Spec coverage:** link format (Task 5 + 6), Copy-preview-link admin action (Task 5), `useAdPreview` + sessionStorage (Task 3), `/api/ads/preview` no-active-filter (Task 2), render override bypassing country + consent on ad routes (Task 4 Step 3), suppressed tracking + PREVIEW badge (Task 4 Step 1), graceful null on unknown id (Task 2 + Task 4's `!!previewBanner` gate), `pickBanner` untouched (no task modifies it), no migration (none present). All spec sections map to a task.
- **Type consistency:** `preview?: boolean` flows `StickyAdBanner (isPreview)` → `AdSlot (preview)` → `SponsorCard (preview)`. `parsePreviewId`/`pickPreviewId` signatures match their call sites. `AdBanner` type reused from `ad-banner-resolver.ts` everywhere. `AD_PREVIEW_STORAGE_KEY` defined in Task 1, consumed in Task 3.
- **Divergence from spec:** preview link host is hardcoded `https://padelnachos.com` (repo convention) rather than an env var; the public `buildPreviewUrl` helper from the spec is dropped (the admin app can't import the root lib, and the one-liner is inlined) — `pickPreviewId` is the only shared pure helper.
