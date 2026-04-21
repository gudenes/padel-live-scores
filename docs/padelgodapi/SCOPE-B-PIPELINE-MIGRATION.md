# Scope B — Move the FIP entry-list pipeline into padelgod

_Status: planned · Target: next working day · Author: handoff from 2026-04-21 session_

## Why

Three successive serverless bugs hit the FIP entry-list pipeline on Vercel:

1. **widget_id_cache constraint** — extraction_method column wasn't set on upsert. Fixed in PR, straightforward.
2. **DOMMatrix not defined** — pdfjs-dist (loaded by pdf-parse) references the browser-only DOMMatrix global at import time. Fixed with a minimal polyfill.
3. **pdfjs worker module missing** — Next.js bundler didn't trace `pdf.worker.mjs` into the function deployment. Fixed with `outputFileTracingIncludes`.
4. **players.source column missing** — schema drift; `public.players` doesn't have a `source` column but our insert set it. Hot-fix: remove the field (or actually add the column if we want the lineage).

Every individual fix is small; the pattern is the problem. Serverless isn't the right home for heavy scraping work that needs real filesystem access, arbitrary native deps, and unrestricted runtime APIs. **Padelgod (Railway) is a long-running Node service — it has none of these constraints.**

## What moves

Everything downstream of the ops trigger — the _pipeline_ itself, not the trigger endpoint.

| Stays on Vercel (parent repo) | Moves to padelgod (Railway) |
|---|---|
| `POST /api/ops/seed-fip-tournament` — thin orchestrator | FIP event page + admin-ajax scraping |
| widget_id_cache upsert (direct DB) | PDF download + parsing |
| Ops UI on `/ops` | Player resolution (DB lookup + FIP search fallback) |
| | Writing `padelgod.entry_list_snapshots` + `public.players` upserts |

The parent's endpoint becomes: "upsert widget_id cache → call padelgod's new endpoint → return the padelgod response to the ops client."

## New padelgod surfaces

### Worker

Add a new worker to padelgod's scheduler list — keeping the existing pattern:

```ts
// padelgod/src/workers/fip-pdf-entry-list-fetcher.ts
export async function runFipPdfEntryListFetcher(deps: {
  supabase: SupabaseClient
  httpClient: AxiosInstance
  logger: Logger
}): Promise<{ tournamentsProcessed: number; totalPlayersInserted: number }>
```

Logic mirrors what the parent-repo pipeline does today:

1. Query `public.tournaments` where `source = 'fip'` AND we have a cached widget AND the tournament is in the active-window RPC. (Or accept a per-tournament scoping param — see below.)
2. For each tournament:
   - `fetchEventPage(fipId)` → extract nonce + post_id
   - `POST /wp-admin/admin-ajax.php` with nonce → parse pdfMap
   - Download men + women PDFs in parallel
   - Parse via pdf-parse (works — no polyfill needed in Node)
   - Run `parseEntryListText` (pure regex parser, ported 1:1 from parent)
   - For each player: DB lookup with lenient PlayerResolver → FIP search fallback
   - Write `padelgod.scrape_jobs` + `padelgod.entry_list_snapshots` + `public.players` (new FIP-search-resolved players)
3. Return summary stats

### HTTP admin endpoint (for per-tournament scoping)

The existing `POST /admin/run-worker` runs against all active tournaments. Add a variant that accepts a tournament scope:

```ts
POST /admin/run-worker
Body: { worker: string; tournamentId?: string }
```

When `tournamentId` is set, the worker runs against just that tournament (bypasses the RPC). This matches what the parent's ops trigger wants to do.

### Parent-side wiring

Update `src/app/api/ops/seed-fip-tournament/route.ts`:

```ts
// Step 1: upsert widget_id_cache (parent-side, no change)
// Step 2: delete the old inline pipeline code
// Step 3: call padelgod
const result = await triggerPadelgodWorker('fip-pdf-entry-list-fetcher', {
  ...admin,
  tournamentId,  // new scoping param
})
```

## Files to port (from parent repo to padelgod)

Mechanical port; adjust imports to `.js` extensions (NodeNext) and use padelgod's logging/http-client conventions.

| Parent repo source | Padelgod destination |
|---|---|
| `src/lib/fip-event-page.ts` | `padelgod/src/lib/fip-event-page.ts` (unchanged) |
| `src/lib/fip-player-search.ts` | `padelgod/src/lib/fip-player-search.ts` (unchanged) |
| `src/lib/entry-list-parser.ts` | `padelgod/src/lib/fip-entry-list-parser.ts` (rename to avoid confusing with padelgod's existing `crionet-entry-list.ts`) |
| `src/lib/fip-entry-list-pipeline.ts` | `padelgod/src/workers/fip-pdf-entry-list-fetcher.ts` (restructure as a padelgod worker) |
| `src/lib/fip-entry-list-persist.ts` | fold into the worker — padelgod workers already have `runScrapeJob` helper |
| `src/lib/player-resolver.ts` (the PlayerResolver class, _not_ the normalize/similarity helpers — those are pure and fine to copy) | `padelgod/src/lib/player-resolver.ts` OR reuse padelgod's `tournament-dictionary` pattern and skip the class entirely — evaluate per use case |

## Files to remove (from parent) once it's working

- `src/lib/pdf-node-polyfills.ts` + test
- `src/lib/fip-entry-list-pipeline.ts` + live test
- `src/lib/fip-entry-list-persist.ts` + test
- `src/lib/fip-event-page.ts` + tests (parent no longer needs them — now in padelgod)
- `src/lib/fip-player-search.ts` + tests (same)
- `next.config.ts` — remove `outputFileTracingIncludes` block
- `package.json` — remove `pdf-parse` from parent deps (still needed in padelgod's own package.json)

Keep:
- `src/lib/entry-list-parser.ts` (still used by ops route `/api/ops/parse-entry-list` for operator PDF upload)
- `src/lib/player-resolver.ts` (used by other ops routes)
- `src/lib/padelgod-admin-client.ts` (used by the trigger endpoint)

## Test strategy

1. **Port the unit tests alongside the library files.** They're pure-function tests; no adjustments needed beyond import paths.
2. **Live integration test in padelgod**: a vitest `LIVE=1`-gated test that hits real padelfip.com for Ijuí and validates 43 teams parsed + 86 player slots resolved. Same shape as the parent-repo test.
3. **End-to-end smoke test**: after deploy, call the parent's `/api/ops/seed-fip-tournament` → watch it delegate to padelgod → see `padelgod.entry_list_snapshots` populate → run the static reconciler → Ijuí renders in the UI.

## Estimated work

| Task | Estimate |
|---|---|
| Port lib files with minor import-path adjustments | 30 min |
| Rewrite pipeline as padelgod worker (restructure for NodeNext + scheduler.ts integration) | 1 hour |
| Add `tournamentId` scoping param to `/admin/run-worker` | 30 min |
| Update parent endpoint to delegate | 15 min |
| Port tests + add live integration test | 45 min |
| Live E2E on Ijuí | 30 min |
| Clean up parent repo (remove migrated files) | 30 min |
| PR review + merge + deploy both services | 30 min |
| **Total** | **~4.5 hours of focused work** |

## Risks

1. **padelgod's `NodeNext` module resolution**: requires `.js` extensions on all relative imports. Tedious to port but mechanical.
2. **axios vs fetch**: padelgod uses axios, parent uses fetch. Port decision — either switch the lib files to axios, or keep them using fetch and make sure fetch is available (Node 18+, so yes).
3. **Supabase client shape**: padelgod already has `padelgod/src/lib/supabase.ts`. Use that instead of creating a new one.
4. **Auth secrets**: `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY` — already present in padelgod's env on Railway. PADELGOD_ADMIN_TOKEN is the only new one the parent needs to know about.
5. **Rollback**: merge the new padelgod code first, deploy to Railway, verify it works manually, THEN flip the parent endpoint to delegate. Gives a clean rollback path.

## Open questions

- Should we keep the parent-repo's `/api/ops/seed-fip-tournament` endpoint at all after the migration? **Yes** — it owns widget_id_cache upsert, which is a parent-side DB write. Just trims it to steps 1 + 2 (upsert + delegate).
- Add per-tournament scoping to all padelgod workers at the same time, or just `fip-pdf-entry-list-fetcher`? **Just the one** — separate PR later if we want to scope the others.
- Does `public.players` actually need a `source` column? If yes, do the migration separately (cleaner), not as part of this move.

## Sequencing (if you're doing this in one sitting)

1. Branch off `main` after the three Vercel hotfixes land (widget_id_cache + polyfill + worker bundle)
2. Port the lib files (~30 min)
3. Restructure as padelgod worker (~1 hr)
4. Port tests; run vitest in padelgod dir, verify pass (~30 min)
5. Add `tournamentId` scoping to `/admin/run-worker` (~30 min)
6. Deploy padelgod to Railway
7. Test padelgod endpoint with curl — should hit the pipeline directly
8. Update parent endpoint to delegate (~15 min)
9. Deploy parent to Vercel
10. Run the full `/api/ops/seed-fip-tournament` curl for Ijuí — verify end-to-end
11. Clean up parent repo files (~30 min, separate commit)
12. Update the `/padelgodapi/architecture` and `/padelgodapi/workers` pages to reflect the new worker — one more commit before merge

## Post-migration validation

- [ ] Ijuí end-to-end: widget_id_cache upsert → entry_list_snapshots populated → draw/oop/results snapshots populated → reconciler runs → public.matches + public.sets populated → `/tournaments/{ijui_uuid}` renders in UI
- [ ] No pdf-parse / pdfjs-dist references in parent repo
- [ ] Parent's Vercel deployment size drops (no more pdfjs worker bundle)
- [ ] Padelgod logs show the new worker in the scrape_jobs table
