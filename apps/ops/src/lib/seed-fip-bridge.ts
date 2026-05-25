// apps/ops/src/lib/seed-fip-bridge.ts
//
// Server-side bridge to the legacy main-app /api/ops/seed-fip-entry-list
// route. Authenticates with the shared CRON_SECRET as the ops_token cookie.
// Will be replaced with a direct port of the FIP scrape pipeline when the
// legacy ops route is retired.

export interface SeedResult {
  ok: boolean
  scrapeJobId?: string
  playersInserted?: number
  snapshotsInserted?: number
  stats?: Record<string, number>
  unresolved?: Array<{ name: string; category: string; reason: string }>
  pdfUrls?: Record<string, string | null>
  error?: string
}

export async function seedTournamentViaLegacy(input: { tournamentId: string; only?: 'men' | 'women' }): Promise<SeedResult> {
  const baseUrl = process.env.OPS_PUBLIC_APP_URL
  const secret = process.env.CRON_SECRET
  if (!baseUrl) return { ok: false, error: 'OPS_PUBLIC_APP_URL not configured' }
  if (!secret) return { ok: false, error: 'CRON_SECRET not configured' }
  let res: Response
  try {
    res = await fetch(`${baseUrl}/api/ops/seed-fip-entry-list`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Cookie: `ops_token=${secret}`,
      },
      body: JSON.stringify(input),
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'fetch failed' }
  }
  let body: Partial<SeedResult> = {}
  try {
    body = (await res.json()) as Partial<SeedResult>
  } catch {
    return { ok: false, error: `legacy returned ${res.status} with non-JSON body` }
  }
  if (!res.ok) {
    return { ok: false, error: body.error ?? `legacy returned ${res.status}` }
  }
  return { ...body, ok: true }
}
