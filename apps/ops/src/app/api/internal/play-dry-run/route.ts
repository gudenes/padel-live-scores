// apps/ops/src/app/api/internal/play-dry-run/route.ts
// Trigger a DRY RUN of a Play market worker and return what it would do.
//
// Forwards to padelgod's POST /admin/run-worker. Deliberately a forward rather
// than reimplementing the generator here: the gates, caps and pricing live in
// padelgod as the single source, and a second copy in the admin would drift —
// the admin would then preview a different result than the cron produces.
//
// Admin-triggered runs are dry-run-safe by construction: the `market-generator`
// and `market-resolver` cases in padelgod's scheduler hardcode `dryRun: true`,
// so this endpoint cannot create a market no matter what.

import { auth } from '@/lib/auth'

const ALLOWED = new Set(['market-generator', 'market-resolver'])

/** Derive the run-worker URL from the refresh URL — same host, same token. */
function runWorkerUrl(): string | null {
  const refresh = process.env.PADELGOD_REFRESH_URL
  if (!refresh) return null
  try {
    return new URL('/admin/run-worker', refresh).toString()
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = runWorkerUrl()
  const adminToken = process.env.PADELGOD_ADMIN_TOKEN
  if (!url) return Response.json({ error: 'PADELGOD_REFRESH_URL is not set' }, { status: 500 })
  if (!adminToken) {
    return Response.json({ error: 'PADELGOD_ADMIN_TOKEN is not set' }, { status: 500 })
  }

  let body: { worker?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const worker = body.worker?.trim() ?? 'market-generator'
  if (!ALLOWED.has(worker)) {
    return Response.json(
      { error: `worker must be one of ${[...ALLOWED].join(', ')}` },
      { status: 400 },
    )
  }

  let upstream: Response
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ worker }),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: `padelgod unreachable: ${message}` }, { status: 502 })
  }

  const text = await upstream.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return Response.json(
      { error: `padelgod returned non-JSON (${upstream.status})`, body: text.slice(0, 400) },
      { status: 502 },
    )
  }

  if (!upstream.ok) {
    return Response.json({ error: json, status: upstream.status }, { status: upstream.status })
  }
  return Response.json({ worker, result: json })
}
