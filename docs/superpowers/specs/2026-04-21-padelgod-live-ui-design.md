# Padelgod Live UI — Design Spec

**Status:** Draft · ready for review
**Date:** 2026-04-21
**Author:** brainstormed with the team
**Related:** `2026-04-20-padelgod-shadow-mode-design.md` (Phase 1 validation layer)

---

## Problem

Padelgod (Railway) is now capturing live matches from shadow-enrolled tournaments — today, 3 live Brussels P2 qualifier matches. That data currently has no user-facing surface; we can only inspect it via SQL. We want a lightweight UI to:

1. **Visualise** the live matches padelgod is consuming, using the existing PadelNachos card style
2. **Verify** the per-point data is correct — especially the new `server_team` signal — via a plain point-by-point log
3. **Dogfood** padelgod's coverage ahead of promoting it from `shadow_enabled=true` to `live_source='padelgod'`

## Scope

### In scope (v1)

- A new API route that returns live / upcoming / recently-finished matches for shadow-enrolled tournaments
- A `<ShadowMatchCard />` component mirroring the production `MatchCard` visual, with a 🎾 indicator on the serving team
- A `<PointLog />` component rendering every captured point in a plain monospace list (server, score, winner, golden-point flag)
- Two surfaces consuming the same API:
  - **Ops view** — extension of `PadelgodShadowTab`, engineering-dense, point log always expanded
  - **PadelNachos view** — hidden page at `/x/live-preview`, production-looking, point log collapsed by default
- Polling every 5s
- Non-indexing on the PadelNachos page (`noindex,nofollow`, sitemap-excluded, no nav links)
- A "Preview live UI" button inside the ops shadow tab linking to the hidden page

### Explicitly out of scope

- Supabase Realtime subscriptions (polling is enough for v1)
- Match-detail drill-down from a shadow card
- Point-stream visualisation beyond the log (no charts, no per-set momentum)
- i18n on the hidden preview page
- Any auth / password / cookie gate — relying on obscurity + `noindex`
- Changes to the canonical `matches` / `sets` / `games` tables
- Schema migrations — feature uses existing shadow tables only

## Decisions made during brainstorm

| Decision | Choice |
|---|---|
| Audience | Both ops and a hidden PadelNachos page |
| PadelNachos scope | Live matches only |
| Ops scope | Live + next 6 upcoming + last 6 finished |
| Server indicator visual | 🎾 emoji next to serving team's names |
| Hiding strategy | Obscure URL + `noindex,nofollow` + sitemap exclusion + no public linking |
| Refresh mechanism | Client-side polling, 5s interval |
| Point log | Plain monospace `<pre>` list, newest at bottom, 50-point cap per match |
| Point log default state | Collapsed on PadelNachos, expanded on ops |
| Golden-point styling | `🥇` prefix in the log line; gold accent on game score cell |

## Architecture

### Single shared API route

```
GET /api/ops/padelgod-shadow/live-cards?scope=<live|live+next+recent>&tournament_id=<uuid?>
```

- `scope=live` → only `matches.status='live'`
- `scope=live+next+recent` → live, plus next 6 by `scheduled_at`, plus last 6 finished by `updated_at`
- `tournament_id` optional; when absent, returns data for every tournament with `shadow_enabled=true`
- Auth: two branches by cookie presence
  - **Authed (`ops_token` valid):** all `scope` values allowed; full response shape
  - **Unauthed:** only `scope=live` allowed (anything else → 403). Response shape is identical — `points[]`, `servingTeam`, `currentGame` included. We're not *hiding* fields from unauth; we're *limiting buckets*. The hidden `/x/live-preview` page polls unauth and gets live matches only, which is exactly the design.

### Response shape

```jsonc
{
  "observedAt": "2026-04-21T09:15:00.000Z",
  "matches": [
    {
      "id": "15bdc0a6-0059-4dcf-b4b6-825af9add014",
      "tournamentId": "b91c4c7d-dfdf-47bd-af99-e6d97515634e",
      "tournamentName": "Brussels P2 2026",
      "status": "live",                      // live | scheduled | finished
      "court": "COURT NEXTENSA",
      "round": "Q3",
      "scheduledAt": null,
      "pair1": {
        "player1": { "name": "Coello",   "country": "ESP" },
        "player2": { "name": "Tapia",    "country": "ARG" }
      },
      "pair2": {
        "player1": { "name": "Galán",    "country": "ESP" },
        "player2": { "name": "Chingotto","country": "ARG" }
      },
      "sets": [
        { "setNumber": 1, "pair1Games": 6, "pair2Games": 3, "isCurrent": false },
        { "setNumber": 2, "pair1Games": 3, "pair2Games": 4, "isCurrent": true  }
      ],
      "currentGame": {
        "pair1Score": "40",
        "pair2Score": "30",
        "isGoldenPoint": false
      },
      "servingTeam": 1,                       // 1 | 2 | null
      "points": [
        { "set": 1, "game": 1, "pt": 1, "server": 2,
          "score": "0-15", "winner": 2,
          "isGoldenPoint": false,
          "at": "2026-04-21T09:06:39.292Z" }
        // ... up to 50 most-recent points, oldest first
      ]
    }
  ]
}
```

### Data sources

| Field | Source table | Notes |
|---|---|---|
| `court`, `round`, `scheduledAt`, `status` | `public.matches` | Filtered by `tournament_id` IN shadow-enrolled |
| `pair*.player*.*` | `public.players` via the 4 FKs on `matches` | Nulls filtered; qualifier matches may show "TBD" placeholders |
| `sets[]` | `padelgod.shadow_sets` | Sorted by `set_number` |
| `currentGame`, `servingTeam` | Latest row of `padelgod.shadow_match_points` by `(set_number desc, game_number desc, point_number desc)` | `score_after` string parsed into two strings |
| `points[]` | `padelgod.shadow_match_points` | Latest 50 rows per match, ordered oldest-first in the response |

### Component structure

```
src/components/ShadowMatchCard.tsx            // new — MatchCard-lookalike with 🎾
src/components/PointLog.tsx                   // new — monospace <pre> list
src/app/ops/PadelgodShadowTab.tsx             // existing — add "Live cards" section + preview button
src/app/x/live-preview/page.tsx               // new — hidden preview page (top-level, outside [locale])
src/app/api/ops/padelgod-shadow/live-cards/route.ts
                                              // new — shared API
```

**Why outside `[locale]`:** the page is English-only and must not participate in i18n routing (no `/es/x/live-preview`, no locale negotiation). Placing it at `src/app/x/live-preview/page.tsx` bypasses the next-intl proxy per existing project convention (`src/proxy.ts` skips `/api`, `/ops`, `/admin`, `/auth` — we add `/x/` to that skip-list).

## User-facing behaviour

### Ops surface

1. Open `/ops` → Padelgod Shadow tab → scroll to new "Live cards" section
2. See cards for all live/upcoming/recent matches in all shadow-enrolled tournaments, one card per match
3. Each card has the point log expanded below it
4. Below each card, a small dev overlay strip (toggleable, off by default in localStorage): `server_team=1 · last_point=15s ago · latency vs padelapi=+320ms · agreement=✓`. Latency values only present if `matches.padelapi_id` exists.
5. Top-right of the section: "Preview live UI →" button, opens `/x/live-preview` in a new tab

### PadelNachos hidden surface

1. Navigate directly to `https://padel-nacho.vercel.app/x/live-preview` (no link from anywhere)
2. Header: app-style `<AppHeader />` + `<BottomNav />`, so it feels like the rest of the app
3. Body: list of `<ShadowMatchCard />`s with point logs collapsed (`Show point log ▸`)
4. 🎾 on the serving team's row
5. Empty state: "No matches currently live in shadow mode."
6. `<meta name="robots" content="noindex,nofollow">` via `generateMetadata`

### Server indicator semantics

- `servingTeam` is 1 or 2 for the *currently-serving* team — derived from `server_team` on the latest `shadow_match_points` row. Padel service games are single-server, so "who served the last point" == "who is serving the current game" until the game ends.
- When `servingTeam=null` (no points captured yet, or parser returned null), no 🎾 is shown and no error surfaces.
- Between games, the value can briefly reflect the previous server until the first point of the new game lands. That's an acceptable 5–15s window; we document it rather than special-case it.

### Polling behaviour

- 5-second `setInterval` kicks off a fetch from the client
- On success: replace state, update freshness dot
- On failure: keep stale state visible, grey out the freshness dot, quiet log to console
- Polling pauses when the document is `hidden` (via `document.visibilitychange`) to be polite in background tabs
- No exponential backoff — we want to recover fast on transient errors

## Testing

Pragmatic coverage, not exhaustive.

### API route — `src/app/api/ops/padelgod-shadow/live-cards/__tests__/route.test.ts`

- Match with 0 shadow points → `servingTeam=null`, `currentGame` reflects `"0-0"`, empty `points[]`
- Match with points but `server_team=null` on latest → `servingTeam=null`, other fields populated
- Match mid-set → latest set marked `isCurrent=true`, prior set `isCurrent=false`
- Finished match → `status='finished'`, `servingTeam` omitted from payload
- Tournament without `shadow_enabled` → not returned, even if `tournament_id` query param names it
- `scope=live` unauth → returns live-only minimal payload
- `scope=live+next+recent` unauth → rejected 403
- `scope=live+next+recent` auth → returns all three buckets, sorted as specified

### `<ShadowMatchCard />` — `src/components/__tests__/ShadowMatchCard.test.tsx`

- `servingTeam=1` → 🎾 in pair 1's row, not pair 2's
- `servingTeam=null` → no 🎾 anywhere
- `currentGame.isGoldenPoint=true` → gold accent class on the game score cell
- `observedAt` older than 30s → freshness dot has `data-stale` attribute

### `<PointLog />` — `src/components/__tests__/PointLog.test.tsx`

- Empty `points[]` → renders "No points yet."
- Renders lines in oldest-first order
- Golden point line includes `🥇` prefix
- New points cause auto-scroll-to-bottom when user is already at the bottom; if they scrolled up, respect their position

### Sitemap test — extend `src/app/__tests__/sitemap.test.ts` (create if missing)

- `/x/live-preview` is not in sitemap output for any locale

### Smoke test

- After deploy: visit `/x/live-preview`, confirm 3 Brussels Q3 cards render with 🎾 on serving teams; expand a log, see points streaming; verify every line's `server_team` matches the column in the DB.

## Observability

- Route logs a `warn` with counter `shadow_live_cards.null_servingTeam` when >30% of live matches return `servingTeam=null`. Logged to Vercel logs; no Sentry wiring for v1.
- No new Supabase RLS policies needed (`padelgod.*` stays service-key only; the route runs server-side with service key).

## Rollout plan

1. Create branch `feat/padelgod-live-ui`
2. Implement per the implementation plan (to be generated next)
3. Local verification: `npm run dev`, hit `/x/live-preview`, confirm Brussels cards render
4. Open PR → CI green → merge
5. Production smoke test on Vercel
6. Leave running for ~24h while Brussels tournament progresses; verify main-draw R32 matches (with `padelapi_id`) exercise the ops overlay's padelapi-comparison column

## Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| PadelNachos page leaks via Vercel preview URLs or accidental link | Low | `noindex,nofollow` is the primary defence; sitemap exclusion prevents Google; no nav linking prevents discovery |
| Polling 5s × active users saturates Supabase | Very low (hidden page, no traffic) | Route uses service key with a 2s DB query; can move to 10s if we ever see it in analytics |
| `server_team` parser in padelgod returns wrong team | Medium | Point log surfaces this directly — anomalies will be obvious to ops within the first hour of running |
| Latest-point lookup is slow under load | Low | Index already exists on `(match_id, set_number, game_number, point_number)` in `shadow_match_points` — confirmed during shadow-mode design |
| Payload grows if a match has >50 points worth streaming | Handled | Hard cap at 50, oldest-first; log scroll handles it |

## Open questions (for reviewer)

None blocking implementation. Flag any here if I missed something.
