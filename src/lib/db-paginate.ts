// src/lib/db-paginate.ts
//
// Pagination helper for PostgREST reads that can plausibly return
// more rows than the server-side cap.
//
// Why this exists: Supabase's PostgREST defaults to a 1000-row response
// cap (`db_max_rows`). Without explicit pagination, ANY unranged
// `.select()` against a table that grows past that limit silently
// truncates — no error, no warning, just missing data. The Leiria
// 2026-04 incident: 5,369 entry_list_snapshots rows, the women's
// roster fell past the cap, every women's match failed to resolve in
// the populator. Diagnosed only by querying the DB by hand.
//
// Project policy (see CLAUDE.md → "PostgREST 1k cap" section):
//   1. The Supabase project has `db_max_rows` raised to 10,000 as a
//      defense-in-depth safety net.
//   2. Reads that can plausibly grow past 10k rows MUST use this
//      helper. Examples: cross-tournament historical aggregations,
//      multi-tournament snapshot scans, archive backfills.
//   3. Per-tournament reads (≤10k almost always) can stay unpaginated
//      — the project cap absorbs them.
//
// Usage:
//
//   import { paginatedSelect } from '@/lib/db-paginate'
//
//   const rows = await paginatedSelect<MyRowType>(
//     (start, end) =>
//       supabase
//         .from('big_table')
//         .select('id, name')
//         .eq('tournament_id', tournamentId)
//         .range(start, end),
//     { what: `big_table (tournament=${tournamentId})` },
//   )
//
// The callback receives `start`/`end` (0-indexed inclusive, PostgREST
// `.range()` semantics) and must return a Supabase query builder
// thenable resolving to `{ data, error }`. The helper loops, fetching
// pages of `pageSize` rows, and stops when a page returns fewer than
// `pageSize` rows (last page) or `maxRows` rows in total.

/**
 * Shape of a Supabase / PostgREST response after `await`. We use
 * `unknown[]` for `data` so the helper accepts the full range of
 * supabase-js's typed builders (which sometimes resolve to
 * `GenericStringError[]` on partial column-list selects). Callers
 * supply the row type via the `paginatedSelect<T>(...)` generic and
 * the helper casts internally.
 */
interface SupabaseLikeResult {
  data: unknown[] | null
  error: { message: string } | null
}

/**
 * Loop `.range()`-paginated fetches until the query is exhausted.
 * Returns the concatenated rows in the order PostgREST returned them
 * (callers needing a deterministic order should `ORDER BY` in the
 * query OR sort client-side after).
 *
 * Throws on the first page that errors. The error message is prefixed
 * with `opts.what` so logs make the failing read obvious.
 */
export async function paginatedSelect<T>(
  buildQuery: (start: number, end: number) => PromiseLike<SupabaseLikeResult>,
  opts: {
    /** Rows per request. Defaults to 1000 (the conservative pre-bump
     *  PostgREST cap). Bump to match `db_max_rows` if you want fewer
     *  round-trips on big reads — currently 10k matches the project cap. */
    pageSize?: number
    /** Hard cap on total rows fetched. A safety against runaway loops
     *  if the data is much larger than expected. Default 100k. */
    maxRows?: number
    /** Short label for error messages. e.g. `entry_list_snapshots
     *  (tournament=…)`. Required so failures are debuggable. */
    what: string
  },
): Promise<T[]> {
  const pageSize = opts.pageSize ?? 1000
  const maxRows = opts.maxRows ?? 100_000
  const out: T[] = []
  let start = 0
  while (start < maxRows) {
    const end = start + pageSize - 1
    const { data, error } = await buildQuery(start, end)
    if (error) {
      throw new Error(`${opts.what} read failed at offset ${start}: ${error.message}`)
    }
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < pageSize) break // last page
    start += pageSize
  }
  return out
}
