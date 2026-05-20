# Ops-editable coverage capability matrix

**Status:** Spec
**Date:** 2026-05-20
**Author(s):** Gu + Claude
**Related:** Conversation that started this — see "Background" below.

---

## Background

While diagnosing the FIP Pro Tour matches gap (Latina / Yogyakarta / Marnes / Hop London / London / Oeiras stuck without visible matches), we wrote a **coverage capability matrix** — a single-page reference that names every active tournament level, which data integrations cover it, and which capabilities are automated vs partial vs manual vs missing.

The matrix is the kind of document that:
- Goes stale fast (every new integration changes a cell).
- Future plans should be able to cite by name ("the matrix already marks this row as `◐` — that's why this PR exists").
- Should be editable without a PR for a typo or a cell flip.

This spec describes a small ops tab that hosts the matrix as a single editable markdown document.

## Goals

- A single source-of-truth document in ops that operators can view + edit.
- Edits persist instantly with no git overhead.
- Lives next to the rest of the ops dashboard so the people who already use ops can update it.
- Future-proof for adding more docs **later**, but v1 is scoped to one doc.

## Non-goals (v1)

- Edit history / revision log.
- Diff view between saves.
- Multi-doc browsing.
- Markdown toolbar / WYSIWYG.
- Cross-doc linking from other ops tabs (e.g. clicking a tournament tier to jump to its matrix row).
- Auto-syncing the matrix back into the git repo.

These can be re-evaluated once we have more than one doc and see real usage patterns.

## Architecture

Three components, sized to the smallest scope that actually ships value:

### 1. Supabase table — `ops_docs`

```sql
create table public.ops_docs (
  slug         text primary key,
  content      text not null,
  updated_at   timestamptz not null default now(),
  updated_by   text          -- email from the ops auth session, nullable
);

alter table public.ops_docs enable row level security;
-- No SELECT/INSERT/UPDATE policies for anon role; the API route uses the
-- service role key (same pattern as every other /api/ops/* writer).
```

One row per doc. v1 seeds a single row with `slug = 'coverage-matrix'`. Adding more docs in the future is just inserting more rows — no schema change.

### 2. API route — `src/app/api/ops/docs/[slug]/route.ts`

Auth: same pattern as every other `/api/ops/*` route — read the httpOnly `ops_token` cookie set by middleware when the operator hits `/ops?token=$CRON_SECRET`. On mismatch, return 401 `{ reason: 'token_mismatch' }`.

- `GET` — fetch the doc row by slug. Returns `{ slug, content, updated_at, updated_by } | null` (null if doc not found).
- `PUT` — body `{ content: string }`. Upserts the row with `updated_at = now()` and `updated_by` set opportunistically from the Auth.js session email if available, else left null. Returns the updated row.

No DELETE in v1 — the matrix shouldn't be deletable from the UI. If someone needs to nuke it, they can blank the content from the editor.

### 3. Ops tab — `src/app/ops/CoverageMatrixTab.tsx`

Two modes, toggled by an Edit / View button in the tab header:

**View mode (default):**
- Render the markdown content via `react-markdown` + `remark-gfm` (GFM tables required for the capability grid).
- Last-edited footer at the bottom: `Last edited <relative time> by <email>`.

**Edit mode:**
- Split editor — CSS grid, two columns:
  - Left column: `<textarea>` pre-filled with the current content, monospace font, full height.
  - Right column: live `react-markdown` preview, scrolling independently.
- Header buttons: Save (PUT to API → on success, exit edit mode + refresh metadata) / Cancel (revert state, exit edit mode).
- No autosave — explicit save only.

Co-located with the rest of the ops tabs in `src/app/ops/`, following the existing `*Tab.tsx` sibling-file convention. Wired into [src/app/ops/OpsClient.tsx](src/app/ops/OpsClient.tsx) tabs list, positioned next to the Architecture tab since both are reference views.

## Data flow

1. Tab mounts → `GET /api/ops/docs/coverage-matrix` → render markdown.
2. User clicks **Edit** → split editor opens, textarea pre-filled with current content.
3. User types → preview re-renders in-browser only (no API call per keystroke).
4. **Save** → `PUT /api/ops/docs/coverage-matrix` with the new content → on 200, update local state + the "last edited" footer; on error, stay in edit mode with content preserved + show a small error message.
5. **Cancel** → revert to last-fetched content, exit edit mode.

## Edge cases

- **Concurrent edits:** last-write-wins. No locking, no merge UI. For a doc updated by one operator every few days, this is fine. If concurrent edits ever become a real problem, add an `updated_at` field to the PUT payload for optimistic concurrency. Not in v1.
- **Markdown render errors:** `react-markdown` is forgiving — malformed tables render as text rather than throwing. The split preview means operators see formatting issues before saving.
- **Empty content:** PUT accepts empty string. The seed migration guarantees the row always exists, so GET will never 404 in normal operation.
- **Auth failure:** 401 `{ reason: 'token_mismatch' }`; tab shows "session expired, refresh" hint.
- **Doc missing from DB:** GET returns null; tab shows "doc not found, re-run seed migration" (operator-facing — this can only happen if someone manually deletes the row).

## Testing

- **API route unit test** — `src/app/api/ops/docs/[slug]/__tests__/route.test.ts`:
  - GET returns the row by slug.
  - GET 401s when the `ops_token` cookie is missing/wrong.
  - PUT upserts content + writes `updated_at` and `updated_by`.
  - PUT 401s when unauthenticated.
- **No unit tests for the tab UI** — it's a thin shell over fetch + react-markdown + a textarea. Visual verification is more useful than RTL tests here.
- **Manual smoke test after deploy:** navigate to ops Coverage Matrix tab → confirm matrix renders → edit a typo → save → refresh the page → confirm change persisted.

## Migration

Single migration `supabase/migrations/<ts>_create_ops_docs.sql`:

1. Creates `public.ops_docs` table + RLS.
2. Inserts the initial `coverage-matrix` row with the seed content from the Appendix below.

The seed content is committed to the migration file itself (single-quoted dollar-tag string) so the matrix doesn't depend on any external file at install time.

## Files touched

| File | Why |
|---|---|
| `supabase/migrations/<ts>_create_ops_docs.sql` | New table + RLS + seed row |
| `src/app/api/ops/docs/[slug]/route.ts` | GET + PUT handlers (new) |
| `src/app/api/ops/docs/[slug]/__tests__/route.test.ts` | API unit tests (new) |
| `src/app/ops/CoverageMatrixTab.tsx` | Tab component (new) |
| `src/app/ops/OpsClient.tsx` | Add tab to tabs list (edit) |

No `package.json` change — `react-markdown` and `remark-gfm` are both already top-level dependencies (`remark-gfm` is used by [NewsTab.tsx](src/app/ops/NewsTab.tsx) and the news page renderer).

---

## Appendix A — Initial seed content (matrix)

The migration inserts this as `content` for `slug = 'coverage-matrix'`. The operator can edit it freely from the ops tab afterwards.

> ```markdown
> # PadelNachos coverage capability matrix
>
> Last updated: 2026-05-20 — seeded version. Edit freely via this page.
>
> ---
>
> ## A. Active tournament levels
>
> | Level | Source mix | Status |
> |---|---|---|
> | `finals` | mixed | Premier Padel — top circuit |
> | `major` | mostly FIP-discovered | Premier Padel |
> | `p1` | FIP-discovered | Premier Padel |
> | `p2` | FIP-discovered | Premier Padel |
> | `fip_platinum` | FIP-discovered | FIP Pro Tour |
> | `fip_gold` | FIP-discovered | FIP Pro Tour |
> | `fip_silver` | FIP-discovered | FIP Pro Tour |
> | `fip_bronze` | FIP-discovered | FIP Pro Tour |
> | `fip_championship` | FIP-discovered | FIP Marquee |
> | `fip_promises` | FIP-discovered | FIP Development (junior) |
> | `fip_beyond` | FIP-discovered | FIP Development (amateur) |
> | `fip_other` | mixed | FIP catch-all |
> | `wpt_*` | padelapi-historical | Legacy — circuit dissolved |
> | `fip_hexagon` / `fip_star` / `fip_rise` / `fip_promotion` / `fip_finals` | — | Schema reserved, never seen |
>
> ## B. Capability matrix
>
> Legend: ● automated production · ◐ partial / has known gaps · ○ manual-ops only · ✕ not available
>
> | Capability | Premier (finals/major/p1/p2) | FIP Pro Tour (platinum→bronze) | FIP Championship | FIP Promises | FIP Beyond | WPT legacy |
> |---|---|---|---|---|---|---|
> | Discovery (tournament exists in DB) | ● | ● | ● | ● | ● | ○ history |
> | Metadata — name, dates, country, level | ● | ● | ● | ● | ● | ○ |
> | Venue — name + address | ● | ◐ | ◐ | ◐ | ✕ usually | ○ |
> | Prize money | ● | ● | ● | ◐ | ✕ | ○ |
> | Logo + cover image | ● | ● | ● | ● | ◐ | ○ |
> | Entry list — players + pairs | ● | ● HTML+PDF | ● | ● | ◐ thin names | ✕ |
> | Draw / bracket — FIP HTML AJAX | ● | ● when published | ● | ● | ◐ | ✕ |
> | Draw / bracket — FIP PDF, manual ops upload | ● | ● | ● | ● | ● | n/a |
> | Draw / bracket — FIP PDF, automated download | ✕ gap | ✕ gap | ✕ gap | ✕ gap | ✕ gap | n/a |
> | Matches — bootstrap from OOP when no draw | ● | ● *(shipped 2026-05-19)* | ● | ● | ● | ✕ |
> | OOP — court + day + label | ● | ● | ● | ● | ◐ | ✕ |
> | Schedule — parsed `scheduled_at` UTC | ● | ● when OOP present | ● | ● | ◐ | ✕ |
> | Live state — scheduled → live → finished | ● Pusher relay + Crionet poll | ● OOP + results sweep | ● | ● | ◐ | ✕ |
> | Live point-by-point — per-point feed | ● Crionet live-poller-loop | ✕ Crionet doesn't expose | ✕ | ✕ | ✕ | ✕ |
> | Live momentum chart (PBP-derived) | ● | ✕ | ✕ | ✕ | ✕ | ✕ |
> | Final score — set scores + winner | ● | ● fip-results-writer | ● | ● | ◐ | historical only |
> | Match stats — Crionet `getmatchstats` | ● Premier-tier only | ✕ | ✕ | ✕ | ✕ | ✕ |
> | Push notifications — live start | ● with score updates | ● status-only | ● | ● | ◐ | n/a |
> | Push notifications — finish | ● | ● | ● | ● | ◐ | n/a |
> | Push largeIcon — avatar / circuit logo | ● padelapi-hosted | ● rehosted padelfip | ● | ● | ◐ | n/a |
> | YouTube "Where to watch" | ● broadcaster groups | ● `fip_court_streams` | ● | ◐ | ✕ | n/a |
> | Player profiles — ranking, race, history | ◐ above ranking cutoff only | ◐ above ranking cutoff only | ◐ | ◐ | ✕ | static |
> | Player avatars in feed/UI | ● padelapi-hosted | ● padelfip rehosted | ● | ◐ | ✕ | static |
>
> ## C. Source-of-truth per tier
>
> | Tier | Discovery | Metadata enrich | Entry list | Draw | OOP/Schedule | Live state | Live PBP | Stats | Final |
> |---|---|---|---|---|---|---|---|---|---|
> | Premier Padel | FIP WP + Premier API | FIP event page | FIP page / PDF | FIP HTML + Crionet draw widget | Crionet OOP widget | padelgod live-poller (Crionet) | padelgod live-poller (Crionet) | padelgod match-stats-fetcher (Crionet) | Crionet results widget |
> | FIP Pro Tour | FIP WP API | FIP event page enricher | FIP page + auto-PDF via Sonnet | FIP HTML when published; otherwise ops PDF upload; OOP fallback when neither | Crionet OOP widget | OOP + results sweep | — | — | Crionet results widget |
> | FIP Promises / Beyond | FIP WP API | FIP event page | thin / often absent | FIP HTML when published; ops PDF upload; OOP fallback | Crionet OOP widget | OOP + results sweep | — | — | Crionet results widget |
> | WPT legacy | historical padelapi | none | none | none | none | none | none | none | snapshot in DB |
>
> Note: padelapi.org is paused (`PADELAPI_PAUSED=true`) — padelgod owns all writes. Premier-tier still gets full coverage because padelgod's live-poller subscribes to Crionet's per-match endpoint, which is exposed for Premier-tier events.
>
> ## D. Do not regress
>
> Working capabilities. Any change to draws, OOP, or live coverage must preserve these.
>
> 1. **Manual draw PDF upload.** ops UI → `POST src/app/api/ops/parse-draw` → `parseDrawPdfWithSonnet` → `POST src/app/api/ops/seed-draw` → `tournament_draws` rows. `DrawTab` reads `tournament_draws` and overlays markers onto the bracket.
> 2. **Automated entry-list PDF download.** [src/lib/fip-entry-list-pipeline.ts](src/lib/fip-entry-list-pipeline.ts) — downloads `pdf:` URLs from FIP AJAX, parses with Sonnet, resolves to players. Already production-proven.
> 3. **Match-identifier pair sanity check.** [padelgod/src/lib/match-identifier.ts](padelgod/src/lib/match-identifier.ts) court-only twin matching is gated by an unordered-pair check. Prevents court-swap hijacks (Brussels P2 incident, 2026-04-23).
> 4. **Schedule-review human approval flow.** Option-A safety: never overwrite a populated player FK; only fill NULLs. Any OOP-driven INSERT path must preserve this when later runs touch the same row.
> 5. **PBP live-poll subscription budget.** `live-poller-manager` spawns per-match loops, Premier-tier only. Don't widen the gate without budget review.
> 6. **`PADELAPI_PAUSED` kill-switch.** Currently `true`. Any new worker must NOT take a hard dependency on padelapi.
> 7. **OOP-as-draw fallback for all FIP tiers** *(shipped 2026-05-19, PR #353)*. `fip-draw-populator` creates thin matches from `oop_snapshots` for any `fip_*` tier when the bracket is empty. Composite-key UPDATE NULL-only enrichment backfills FKs when the bracket later arrives. Premier and WPT remain excluded.
>
> ## E. Known gaps
>
> Gaps the matrix exposes today. Each is a candidate for a separate plan.
>
> 1. **Automated FIP draw PDF download.** FIP increasingly publishes Pro Tour draws as PDF-only. Entry lists already have this pattern (`fip-entry-list-pipeline.ts`); the same shape ports to draws. Until then, draws need either an FIP AJAX bracket or a manual ops PDF upload to land in `tournament_draws`.
> 2. **`tournament_draws` → `public.matches` enrichment.** Manual PDF uploads write to `tournament_draws` but `fip-draw-populator` doesn't read from there — so manual uploads enrich the DrawTab UI but don't backfill FKs on existing thin matches in `public.matches`. Fix: have the populator also read `tournament_draws` as an enrichment source.
> 3. **Entry-list player ranking ingestion.** FIP entry list pages and PDFs include per-player ranking in the source we already scrape, but `fip-entry-list-populator` currently drops the ranking column. Result: players below the public WP-JSON ranking cutoff (e.g. Leonardo Villa P208430, Francesco Carocci P208910 in Latina Q1) end up as bare shells in `players` with NULL `ranking` even though the data was visible upstream. Fix: extend the populator's player-row UPSERT to include ranking, gated through `filterUpdateByPriority` so it only fills NULLs when the WP-JSON-sourced cron hasn't already won the field.
> 4. **Player-profile worker isn't attempting low-ranked players.** `profile_attempt_at` is still epoch on shell rows. There's likely a gate in the `player-profile` worker excluding players with no ranking. Worth investigating once gap #3 is fixed.
> ```

## Appendix B — Decisions log

- **Scope:** single doc, not a generic /docs tab. We can extend to N docs by inserting more rows; v1 ships the matrix alone.
- **Storage:** Supabase table, not git-committed markdown file. Edits are operational state, not architecture-of-record — same trade-off the entry-list/draws status flags make.
- **Editor UX:** split editor (textarea + live preview), not plain textarea or structured table editor. Tables are formatting-sensitive; live preview catches errors before save.
- **Auth:** existing `ops_token` cookie. No new auth surface.
- **Concurrency:** last-write-wins, no locking. Acceptable for a doc updated weekly.
