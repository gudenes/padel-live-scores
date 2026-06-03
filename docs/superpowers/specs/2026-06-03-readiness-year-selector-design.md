# Data Readiness — year selector

**Date:** 2026-06-03
**Status:** Approved (design)
**App:** `apps/ops/` — Data Readiness view (`/system/data-readiness`)
**Builds on:** the readiness route + view (currently hardcoded to 2026).

## Goal

Let an operator pick which year's tournaments the Data Readiness view shows, via a dropdown in the filter row populated with every year we have in-scope tournament data for — instead of being locked to 2026.

## Approach

Parameterize the existing readiness endpoint with a `?year=YYYY` window and have it also return the list of available years; the client renders a single-select dropdown and re-fetches on change. One sound approach (folding the years list into the existing endpoint avoids a second round-trip); a separate `/years` endpoint was considered and rejected as an unnecessary extra request.

## Changes

### API — `apps/ops/src/app/api/internal/tournament-readiness/route.ts`
- Add `const year = Number(url.searchParams.get('year')) || new Date().getUTCFullYear()` (validated to a 4-digit year; fall back to current year).
- Replace the hardcoded `FROM`/`TO` constants with `const FROM = \`${year}-01-01\`` / `const TO = \`${year}-12-31\``.
- Add one lightweight query for the distinct in-scope years (independent of the selected year), e.g. an RPC or a direct select:
  `SELECT DISTINCT date_part('year', starts_at)::int AS year FROM public.tournaments WHERE level = ANY(<IN_SCOPE_TIERS>) AND starts_at IS NOT NULL ORDER BY year DESC`.
  (PostgREST: `.select('starts_at').in('level', IN_SCOPE_TIERS).not('starts_at','is',null)` then derive distinct years client-side in the route, OR a small RPC `readiness_years()`. Prefer a tiny RPC `readiness_years()` returning `int[]` to keep it one cheap indexed query and avoid pulling every tournament row.)
- Response shape becomes `{ rows: ReadinessRow[], years: number[] }` (years sorted descending). The `?id=` single-tournament re-check path is unchanged and year-agnostic — it still returns just `{ rows }`.

### Migration — `supabase/migrations/<ts>_readiness_years.sql`
A tiny RPC:
```sql
create or replace function readiness_years()
returns int[] language sql stable as $$
  select coalesce(array_agg(distinct date_part('year', starts_at)::int order by date_part('year', starts_at)::int desc), '{}')
  from public.tournaments
  where starts_at is not null
    and level in ('major','p1','p2','finals','fip_platinum','fip_gold','fip_silver','fip_bronze')
$$;
```
Applied to the shared DB via the repo's `pg`-script workflow; reversible (`drop function`).

### Client — `ReadinessView.tsx`
- Add `const [year, setYear] = useState<number>(new Date().getUTCFullYear())`.
- The fetch effect depends on `year` and requests `/api/internal/tournament-readiness?year=${year}`; store both `rows` and the returned `years`.
- Render a Year `<select>` as the first control in the filter row, options from `years` (descending), value `year`, onChange `setYear`.
- **Fallback:** after the first response, if `years` is non-empty and does not include the current `year`, set `year` to `years[0]` (most recent) — re-fetches and avoids an empty page.
- Selecting a different year resets bulk selection (`selectedIds`) and any in-progress bulk state (call `bulk.reset()` / clear selection) so stale selections from another year don't carry over.

### Calendar — `ReadinessCalendar.tsx`
- Accept a `year: number` prop and initialize its displayed year to it (it currently hardcodes `useState(2026)`), so the calendar opens in the selected year. The month default stays "current month" only when the selected year is the current year; otherwise default to January of the selected year.

## Unchanged
- Tier / stage / verdict filters; bulk + single refresh (year-agnostic via `id`); stage derivation (`today`-relative — past-year events read as Completed). Readiness scoring, RPC `readiness_presence`, list/dimension matrix.

## Testing
- The route + RPC are integration-level; verify via the running app + a direct DB call to `readiness_years()`.
- Manual: dropdown lists all in-scope years (desc); switching year reloads KPIs + list + calendar; default lands on the current year (or most-recent-with-data if the current year is empty); calendar opens in the selected year.

## Non-goals
- No "All years" option (fetching every year's matches at once is heavy).
- No multi-year multi-select (single dropdown).
- No per-year persistence/localStorage (default is always current year unless empty).

## Acceptance
- `/api/internal/tournament-readiness?year=2025` returns 2025's rows; the response includes `years` (all in-scope years, desc).
- The view shows a Year dropdown listing those years; default = current year (fallback most-recent); changing it reloads list + calendar; calendar opens in the chosen year.
- `?id=` re-check unaffected; build + lint pass.
