# Strategy A — Make the bare domain (`/`) the canonical homepage

> **Status: PARKED — do not execute yet.** Ship date depends on SEO observation, not engineering readiness. Wait until `/home` has cleanly recovered in Google Search Console (≈2–3 weeks after the 2026-05-30 technical-SEO sweep, PR #480) before starting. See "Why this is parked" below.

> **For agentic workers:** when this is un-parked, use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `https://padelnachos.com` (bare root) the indexed, canonical homepage — the URL Google shows in results and that users link to — instead of the current `https://padelnachos.com/home`.

**Author context:** Scoped 2026-05-30 against the codebase immediately after the technical-SEO sweep (PR #480) merged. All file paths / line numbers below were accurate at `d0b1d236`; re-verify before executing since `main` will have moved.

---

## Current state (as of 2026-05-30, post-PR #480)

Verified live with `curl`:

```
/        →(308)→  /v3  →(308)→  /home   (200, self-canonical to /home)
/home    →  200, <link rel="canonical" href="https://padelnachos.com/home">
```

- The home **content** lives at `src/app/[locale]/(app)/home/page.tsx` — a 591-line `'use client'` "thin orchestrator" whose sections import from `@/components/home/*`.
- Home **metadata** lives in `src/app/[locale]/(app)/home/layout.tsx` → `buildPageMetadata({ locale, pageKey: 'home', path: '/home' })`. The `path` drives the canonical, so today it self-canonicals to `/home`.
- `src/app/[locale]/page.tsx` is just a locale-aware `redirect({ href: '/home', locale })` (the bare-root → home redirect we added in PR #480).
- The **first** hop `/ → /v3` is a **Vercel-dashboard redirect** (NOT in `vercel.json` or `proxy.ts`). The **second** hop `/v3 → /home` is `src/proxy.ts:30`.
- Root layout (`src/app/layout.tsx:72`) already declares a default `alternates.canonical = 'https://padelnachos.com'` (i.e. `/`) — so Strategy A *aligns* with the existing default; the `/home` override is what currently diverges from it.

### The architectural snag (why this isn't a folder move)

`src/app/[locale]/(app)/layout.tsx` already exists and is **shared by every tab** (matches, rankings, feed, …). The home page is `'use client'`, so it cannot host `generateMetadata` itself — that's exactly why home currently has its *own* `home/layout.tsx`. To serve home at the `(app)` group root (`/`), we cannot add a second `(app)/layout.tsx`, and we cannot put home-specific metadata in the shared one. So we must do a **server/client split**:
- `src/app/[locale]/(app)/page.tsx` — thin **server** component: `export async function generateMetadata` (canonical `/`) + renders `<HomeClient/>`.
- `src/app/[locale]/(app)/HomeClient.tsx` (or `@/components/home/HomeClient.tsx`) — the existing 591-line `'use client'` body, moved verbatim.

---

## Target state

```
/        →  200, home content, <link rel="canonical" href="https://padelnachos.com/">   (and /es, /pt, /it, /fr at their roots)
/home    →(308)→  /            (locale-aware: /es/home →(308)→ /es, etc.)
/v3      →(308)→  /
```

---

## File map

```
src/app/[locale]/
  page.tsx                         # DELETE (was the / → /home redirect; conflicts with (app)/page.tsx)
  (app)/
    page.tsx                       # NEW — server wrapper: generateMetadata(path:'/') + <HomeClient/>
    HomeClient.tsx                 # NEW — the moved 591-line 'use client' home body
    home/page.tsx                  # DELETE (moved)
    home/layout.tsx                # DELETE (metadata folds into (app)/page.tsx generateMetadata)
    home/loading.tsx               # MOVE → (app)/loading.tsx  (verify it doesn't clobber a sibling)
src/proxy.ts                       # MODIFY — /v3 → / ; add locale-aware /home → / ; keep /home?view=tournaments + /v3/* legacy
src/lib/seo-metadata.ts            # (no change — buildPageMetadata already takes path; we pass '/')
public/manifest.json               # MODIFY — start_url "/home" → "/"
src/components/nav/BottomNavV3.tsx  # MODIFY — home href + active-state detection for locale roots
src/auth.ts                        # MODIFY — signIn/error pages /home → /
src/components/LoginSheet.tsx       # MODIFY — callbackUrl/redirect /home → /
# + ~10 more files with router.push('/home') / redirect('/home') — see Task 4
# Vercel dashboard                  # MANUAL — remove the / → /v3 redirect (no code)
```

---

## Tasks

### Task 1 — Server/client split so home renders at `/`
- [ ] Create `src/app/[locale]/(app)/HomeClient.tsx` with the full current body of `(app)/home/page.tsx` (keep `'use client'`). Imports from `@/components/home/*` are absolute and move cleanly.
- [ ] Create `src/app/[locale]/(app)/page.tsx` as a **server** component: `export async function generateMetadata({ params })` → `buildPageMetadata({ locale, pageKey: 'home', path: '/' })`, plus the `sr-only` `<h1>` from the old `home/layout.tsx`, rendering `<HomeClient/>`.
- [ ] Move `(app)/home/loading.tsx` → `(app)/loading.tsx` (confirm no existing `(app)/loading.tsx`; if one exists, reconcile).
- [ ] Delete `(app)/home/page.tsx`, `(app)/home/layout.tsx`.
- [ ] Delete `src/app/[locale]/page.tsx` (otherwise it and `(app)/page.tsx` both resolve to `/` → Next.js route conflict).
- [ ] Verify build: `npm run build` (catches the route conflict + any client/server boundary error).

### Task 2 — Redirect topology
- [ ] **Vercel dashboard:** remove the `/ → /v3` redirect (manual, no code). Without this, `/` keeps 308-ing and Task 1 never serves a 200 at root in prod.
- [ ] `src/proxy.ts:30`: change `/v3` → redirect to `/` (was `/home`).
- [ ] `src/proxy.ts`: add a locale-aware `'/home' → '/'` 308 (mirror the existing `localeStripped` pattern at :57 so `/es/home → /es`, etc.). Keep the existing `/home?view=tournaments → /tournaments` handler and all `/v3/*` legacy redirects.
- [ ] Verify: `curl -sIL /` is a single 200 (no /v3 hop); `/home`, `/es/home` → 308 → `/`, `/es`.

### Task 3 — Flip the canonical
- [ ] Confirmed by Task 1's `path: '/'`. Verify rendered `<link rel="canonical">` on `/` is `https://padelnachos.com/` and on `/es` is `https://padelnachos.com/es`.

### Task 4 — Repoint internal `/home` references to `/`
~18 references (grep `'/home'` across `src`, excluding the deleted `home/` dir). Mechanical:
- [ ] `src/auth.ts:146-147` — `signIn`/`error` pages `/home` → `/`.
- [ ] `src/components/LoginSheet.tsx:130,190,212` — `window.location.href` / `callbackUrl` `/home` → `/`.
- [ ] `src/app/[locale]/(app)/welcome/page.tsx:147,186` — `router.replace('/home')` → `'/'`.
- [ ] `src/app/[locale]/(app)/profile/page.tsx:56,172`, `profile/settings/page.tsx:175,292`, `achievements/page.tsx:41` — auth-guard / back-home `router.replace|push('/home')` → `'/'`.
- [ ] `src/app/[locale]/(app)/profile/settings/DeleteAccountModal.tsx:47` — `/home?deleted=1` → `/?deleted=1`.
- [ ] `src/app/[locale]/picks/page.tsx:11` — `redirect({ href: '/home', locale })` → `href: '/'`.
- [ ] `src/components/road-to-olympics/BackToHomeButton.tsx:26`, `tournaments/[id]/page.tsx:747` — `router.push('/home')` → `'/'`.
- [ ] `src/app/admin/feed/page.tsx:241,289` — admin `Link href="/home"` → `/` (low priority, internal).
- [ ] `src/app/[locale]/(app)/about/page.tsx:41` — `Link href="/home"` → `/`.
- [ ] Leave `src/middleware.ts.deprecated` untouched (not active).

### Task 5 — Bottom-nav active state
- [ ] `src/components/nav/BottomNavV3.tsx:115` — home tab `href: '/home'` → `'/'`.
- [ ] `src/components/nav/BottomNavV3.tsx:127` — active-state check `pathname === '/home'` must match the **locale roots** instead: `/`, `/es`, `/pt`, `/it`, `/fr` (and trailing-slash variants). Otherwise the Home tab never highlights. This is the only non-mechanical logic change.

### Task 6 — PWA + native
- [ ] `public/manifest.json:5` — `start_url: "/home"` → `"/"`.
- [ ] Grep `ios/` and `android/` (Capacitor) + push deep-link builders for hardcoded `/home`. The Task-2 `/home → /` 308 covers them at runtime, but update any hardcoded launch/deep-link URL for cleanliness.

### Task 7 — Verification (the bulk of the time)
- [ ] Home renders at `/`, `/es`, `/pt`, `/it`, `/fr` with the `(app)` nav + providers intact.
- [ ] Home tab highlights on every locale root.
- [ ] Auth flows land on `/`: Google/Apple login (`LoginSheet`), welcome, delete-account, and the unauth guards on profile/achievements.
- [ ] `/home`, `/es/home` → 308 → `/`, `/es`. Legacy `/home?view=tournaments` → `/tournaments` still works. `/v3/*` legacy redirects still work.
- [ ] Rendered canonical on `/` is self-referential; `/home` no longer returns 200 (it redirects).
- [ ] PWA installs/launches at `/` (manifest start_url).
- [ ] `npm run build` clean; `npm run lint` clean on touched files.

---

## Effort

Code: **~4–6 hours focused** (half a day). Low complexity, wide surface. Breakdown: split ~1h, redirects ~30m, canonical ~5m, link updates ~45m, nav active-state ~20m, PWA/native ~15m, verification ~1.5h.

---

## Why this is parked (the actual constraint)

The engineering is cheap; the risk is **canonical churn**. The homepage canonical has already moved twice recently:
- **2026-05-28** Google saw `/` as canonical.
- **Now** a recent `main` change made `/home` self-canonical, so the homepage is currently heading toward indexing as `padelnachos.com/home`.

Strategy A flips it back to `/` — a **third** state in ~2 weeks. Rapid canonical flip-flopping forces Google to re-process the homepage repeatedly and causes ranking instability exactly when it should be settling.

**Gate to un-park:** in Search Console, confirm `padelnachos.com/home` (or `/`) has recovered to "indexed" and is stable for ~1–2 weeks. Only then execute, flipping to `/` once, cleanly. The original technical-SEO sweep plan ([2026-05-26-technical-seo-sweep.md](2026-05-26-technical-seo-sweep.md)) deferred this deliberately for the same reason.

## Open decision before executing

Confirm the desired end-state URL: bare `padelnachos.com` (this plan) vs keeping `padelnachos.com/home`. If after observation the `/home` form is indexing fine and ranking well, **doing nothing is a legitimate outcome** — the only downside of `/home` is cosmetic (the URL shown in results), not functional.
