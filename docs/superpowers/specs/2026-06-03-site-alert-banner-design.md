# Site-Wide Alert Banner — Design

**Date:** 2026-06-03
**Status:** Approved (design); pending implementation plan

## Problem

When something affecting the whole site happens — e.g. *"Matches suspended due to court conditions"* — there is no way to tell users. Operators need a way to publish a short, prominent message that appears at the top of the user-facing app, and to take it down (or let it expire) without a code deploy.

## Goals

- Operator publishes/edits/retires a single site-wide banner from **admin.padelnachos.com** (`apps/ops/`).
- Banner renders at the **top of the main user app** across all pages and all 5 locales.
- Three severities (info / warning / critical) with distinct styling.
- Users can **dismiss** the banner; it stays dismissed until the alert changes (new alert, or message edited).
- No deploy required to change copy or visibility.

## Non-Goals (YAGNI)

- Per-tournament / per-route scoping. Site-wide only.
- Multiple simultaneous banners. **Exactly one active banner at a time** (newest wins).
- Rich text, links, images, or CTAs in the banner. Plain single-string message.
- Per-locale translated copy. Operator writes one message string shown to everyone. (i18n of the message can be added later behind the same table — see "Future".)

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Control surface | DB-backed, managed in `apps/ops/` (admin.padelnachos.com) |
| Placement | Top of app, above the page header |
| Dismissible | Yes — remembered in `localStorage`, re-shows when the alert changes |
| Scope | Site-wide only |
| Severity | Per-alert: `info` (blue) / `warning` (amber) / `critical` (red) |

## Architecture

Two apps, one shared Supabase project:

```
admin.padelnachos.com (apps/ops)            padelnachos.com (main app, src/)
 ┌─────────────────────────────┐             ┌───────────────────────────────┐
 │ Announcements page          │             │ AlertBanner (client)          │
 │  → /api/internal/announce…  │  writes     │  → useActiveAnnouncement()    │
 │     (service-key client)    │ ───────────▶│     → GET /api/announcements/  │
 └─────────────────────────────┘  Supabase   │        active (public read)   │
                                  site_announcements                          │
                                              └───────────────────────────────┘
```

### 1. Data — table `site_announcements`

New migration in `supabase/migrations/` (e.g. `20260603xxxxxx_site_announcements.sql`).

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK default `gen_random_uuid()` | |
| `message` | `text not null` | banner copy, single line, plain text |
| `type` | `text not null default 'info'` | check in (`'info'`,`'warning'`,`'critical'`) |
| `active` | `boolean not null default false` | master on/off |
| `starts_at` | `timestamptz` | nullable; null = active immediately |
| `expires_at` | `timestamptz` | nullable; null = no expiry |
| `updated_at` | `timestamptz not null default now()` | bumped on every edit (drives re-show) |
| `created_at` | `timestamptz not null default now()` | |

**"The active banner"** = the row where
`active = true AND (starts_at is null OR now() >= starts_at) AND (expires_at is null OR now() < expires_at)`,
ordered by `updated_at desc`, **limit 1**.

**RLS:** enable RLS. Add a SELECT policy for the `anon` role restricted to currently-active rows (the banner is public, anon-readable). All writes happen through the ops app's **service-key** client (bypasses RLS). This mirrors how other public/ops-written tables are handled.

`updated_at` is maintained by the ops API on update (set explicitly) — no trigger needed, but a `moddatetime`/`updated_at` trigger is acceptable if it matches existing migration conventions.

### 2. Ops management — `apps/ops/` (admin.padelnachos.com)

Follows the existing **News** feature as the template.

- **Page:** `apps/ops/src/app/(app)/announcements/page.tsx`
  - Built on the `ui` primitives (`Panel`, `Section`, `Field`, `Button`, `DataTable`, segmented control) — token-driven, no hardcoded hex (per the design-system rules).
  - Form: message textarea, severity segmented control (Info/Warning/Critical), optional `starts_at` / `expires_at`, an **Active** toggle, Publish + Save-draft actions.
  - Below the form: a list of recent announcements with status pills (LIVE / scheduled / expired / off) and edit/delete.
- **API:** `apps/ops/src/app/api/internal/announcements/route.ts` (GET list, POST create) + `apps/ops/src/app/api/internal/announcements/[id]/route.ts` (GET, PUT, DELETE). Use `createServiceClient()` from `apps/ops/src/lib/supabase.ts`. Mirror the auth/shape of `/api/internal/news`.
  - On PUT, set `updated_at = now()` so dismissals reset when copy changes.
- **Nav:** add an "Announcements" item to `apps/ops/src/components/shell/Rail.tsx`.

### 3. Banner on the user app — `src/`

- **Public read API:** `src/app/api/announcements/active/route.ts` — returns the single active announcement (or `null`). Reads via the server Supabase client. This mirrors the `/api/ads/active` indirection that `useActiveBanner` already uses (keeps anon RLS details server-side and gives us one cacheable endpoint). Short `Cache-Control` (e.g. `s-maxage=30`) so a published alert appears quickly without hammering the DB.
- **Hook:** `src/hooks/useActiveAnnouncement.ts` — fetches `/api/announcements/active`, follows the module-cache + inflight-dedupe pattern of `useActiveBanner`. Adds light polling (~60s) so a newly published/retired alert appears/disappears without a manual reload. Returns the announcement or `null`.
- **Component:** `src/components/announcements/AlertBanner.tsx` (client)
  - Renders the active announcement; `null` → renders nothing.
  - Styling keyed by `type`: info=blue, warning=amber, critical=red. Icon + message + ✕ close button.
  - **Placement:** rendered as the **first element in normal document flow**, above `{children}`, so it pushes page content (and the page's own `sticky` header) down. It is **not** itself sticky — on scroll it scrolls away above the page's sticky header, avoiding a double-sticky/top:0 overlap. Respects `env(safe-area-inset-top)` so it clears the iOS status bar / Dynamic Island.
  - **Dismissal:** clicking ✕ writes the dismissed identity to `localStorage` under a key like `dismissed_announcement`, storing `"<id>:<updated_at>"`. The banner is hidden only when the stored value matches the current active announcement's `id:updated_at`. Editing the message (new `updated_at`) or publishing a new row (new `id`) makes it reappear.
- **Mount:** in `src/app/[locale]/layout.tsx`, render `<AlertBanner />` **before** `{children}` inside `NotificationNudgeProvider` (the other global chrome — ConsentBanner, StickyAdBanner — stays where it is). Because it must push content down, it goes before children rather than after.

## Data Flow

1. Operator fills the form on admin.padelnachos.com, toggles Active, clicks Publish.
2. Ops API upserts the row via the service-key client, sets `updated_at = now()`.
3. Within ~30–60s the main app's `useActiveAnnouncement` poll (or next navigation) fetches `/api/announcements/active` and the banner appears for all users who haven't dismissed *this* `id:updated_at`.
4. Operator toggles Active off (or `expires_at` passes) → endpoint returns `null` → banner disappears on next poll.

## Error Handling

- Public read endpoint failure or empty → hook returns `null` → no banner (fail-safe: the app never shows a broken bar).
- Malformed `localStorage` value → treated as "not dismissed" (show the banner).
- Multiple rows accidentally active → newest `updated_at` wins (the query's `limit 1`).

## Testing

- **Unit:** the "active banner" selection predicate (active + start/expiry window + newest-wins) and the dismissal-match logic (`id:updated_at` comparison, malformed-value tolerance). Pure functions, vitest.
- **Manual / preview:** publish each severity from a local ops run, confirm it renders at the top of the main app, dismiss persists across reload, and an edit re-shows it. (Per the repo's "test locally" rule.)

## Future (out of scope now)

- Per-locale translated copy (add a `translations jsonb` column; banner picks `NEXT_LOCALE`, falls back to `message`).
- Per-tournament / per-route targeting (add a nullable scope column + route filter in the component).
- Optional inline link/CTA.
