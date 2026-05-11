// src/app/api/cron/premier-discovery/route.ts
//
// **RETIRED 2026-05-11** — Premier Padel API is no longer used. Match
// stats source has moved exclusively to padelgod's `match-stats-fetcher`
// worker (Crionet widget). Tournament + match linking happens through
// padelgod's tournament-discovery + match identifier paths.
//
// This route stays in place returning HTTP 410 Gone so anything still
// pinging the URL (Vercel scheduler residue, external monitors) gets a
// clear "moved to padelgod" signal instead of a 404.

export async function GET(): Promise<Response> {
  return Response.json(
    {
      error: 'gone',
      moved_to: 'padelgod (tournament-discovery + match-stats-fetcher workers)',
      since: '2026-05-11',
    },
    { status: 410 },
  )
}
