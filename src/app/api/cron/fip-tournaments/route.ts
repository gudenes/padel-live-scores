// src/app/api/cron/fip-tournaments/route.ts
//
// **RETIRED 2026-04-28** — FIP tournament discovery + event-page
// enrichment moved to padelgod's `fip-event-page-enricher` worker
// (Railway service). See:
//   - padelgod/src/workers/fip-event-page-enricher.ts
//   - padelgod/src/workers/tournament-discovery.ts
//
// This route stays in place returning HTTP 410 Gone so anything still
// pinging the URL (Vercel scheduler residue, external monitors) gets a
// clear "moved to padelgod" signal instead of a 404.

export async function GET(): Promise<Response> {
  return Response.json(
    {
      error: 'gone',
      moved_to: 'padelgod fip-event-page-enricher worker',
      since: '2026-04-28',
    },
    { status: 410 },
  );
}
