// src/app/api/cron/premier-stats/route.ts
//
// **RETIRED 2026-05-11** — match stats are now sourced exclusively from
// padelgod's `match-stats-fetcher` worker (Crionet widget). See:
//   - padelgod/src/workers/match-stats-fetcher.ts
//   - src/app/api/match-stats/route.ts (read-only DB endpoint)
//
// This route stays in place returning HTTP 410 Gone so anything still
// pinging the URL (Vercel scheduler residue, external monitors) gets a
// clear "moved to padelgod" signal instead of a 404.

export async function GET(): Promise<Response> {
  return Response.json(
    {
      error: 'gone',
      moved_to: 'padelgod match-stats-fetcher worker (crionet_widget source)',
      since: '2026-05-11',
    },
    { status: 410 },
  )
}
