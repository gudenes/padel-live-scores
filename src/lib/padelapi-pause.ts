// src/lib/padelapi-pause.ts
//
// Ops kill-switch for all padelapi-consuming cron jobs. When
// `PADELAPI_PAUSED=true` is set in Vercel env vars, the guarded routes
// return early with `{ paused: true, ... }` and do zero work — no HTTP
// calls to padelapi.org, no DB writes.
//
// The switch exists for troubleshooting windows where padelapi's writes
// (especially the `live → ended` transient without a subsequent `finished`
// resolution) are fighting our manual SQL patches or closeMatch logic in
// padelgod. Flip it on, troubleshoot, flip it off. No deploy required to
// toggle (Vercel restarts the function on env var changes).
//
// Routes guarded: `/api/cron/scores`, `/api/cron/sync`,
// `/api/cron/premier-stats`, `/api/cron/premier-discovery`.
//
// NOT guarded (these don't consume padelapi):
//   sync-articles, sync-highlights, social-drafts, oop-monitor,
//   fip-scores, fip-tournaments, nacho-health, editorial-gen,
//   sync-broadcasters, quality-scores

/**
 * Returns a Response.json payload when `PADELAPI_PAUSED=true`, else null.
 * Callers should return the response directly when non-null, otherwise
 * proceed with normal cron work.
 *
 * Usage (inside a cron route's GET handler, AFTER the CRON_SECRET auth
 * check):
 *
 *   const paused = padelapiPausedResponse('scores')
 *   if (paused) return paused
 */
export function padelapiPausedResponse(cronName: string): Response | null {
  if (process.env.PADELAPI_PAUSED !== 'true') return null
  return Response.json(
    {
      paused: true,
      reason: 'PADELAPI_PAUSED env var is set',
      cron: cronName,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  )
}
