// src/app/api/admin/migrate-equipment-images/route.ts
// One-time migration: downloads brand logos and racket images from external
// CDNs and rehosts them on Supabase Storage. Idempotent — already-hosted rows
// are skipped.
//
// Usage:
//   POST /api/admin/migrate-equipment-images                  → migrate brands + rackets
//   POST /api/admin/migrate-equipment-images?kind=brand       → brands only
//   POST /api/admin/migrate-equipment-images?kind=racket      → rackets only
//   POST /api/admin/migrate-equipment-images?limit=1          → test on a single row first
//
// Auth: Authorization: Bearer $CRON_SECRET

import { createServerClient } from '@/lib/supabase'
import {
  ensureEquipmentBucket,
  rehostEquipmentImageToSupabase,
  type EquipmentKind,
} from '@/lib/equipment-image-rehost'

const BATCH_SIZE = 20

function unauthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const header = request.headers.get('authorization')
  return header !== `Bearer ${expected}`
}

interface Row {
  id: string
  url: string
}

async function fetchRows(
  sb: ReturnType<typeof createServerClient>,
  kind: EquipmentKind,
  limit: number | null,
): Promise<Row[]> {
  const table = kind === 'brand' ? 'padel_brands' : 'padel_rackets'
  const column = kind === 'brand' ? 'logo_url' : 'image_url'

  let q = sb
    .from(table)
    .select(`id, ${column}`)
    .not(column, 'is', null)
    .not(column, 'ilike', '%.supabase.co/storage/%')
    .order('id')

  if (limit) q = q.limit(limit)

  const { data, error } = await q
  if (error) throw new Error(`fetch ${table}: ${error.message}`)

  return (data ?? []).map((r) => ({
    id: (r as Record<string, string>).id,
    url: (r as Record<string, string | null>)[column] ?? '',
  }))
}

export async function POST(request: Request) {
  if (unauthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const kindParam = url.searchParams.get('kind')
  const limitParam = url.searchParams.get('limit')
  const limit = limitParam ? Math.max(1, parseInt(limitParam, 10) || 0) : null

  const kinds: EquipmentKind[] =
    kindParam === 'brand'
      ? ['brand']
      : kindParam === 'racket'
        ? ['racket']
        : ['brand', 'racket']

  const sb = createServerClient()

  const bucket = await ensureEquipmentBucket(sb)
  if (!bucket.ok) {
    return Response.json(
      { error: 'Failed to create bucket', detail: bucket.error },
      { status: 500 },
    )
  }

  const allResults: Array<Awaited<ReturnType<typeof rehostEquipmentImageToSupabase>>> = []

  for (const kind of kinds) {
    let rows: Row[]
    try {
      rows = await fetchRows(sb, kind, limit)
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      )
    }

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE)
      const batchResults = await Promise.all(
        batch.map((row) => rehostEquipmentImageToSupabase(sb, kind, row.id, row.url)),
      )
      allResults.push(...batchResults)
    }
  }

  const migrated = allResults.filter((r) => r.status === 'ok').length
  const skipped = allResults.filter((r) => r.status.startsWith('skipped')).length
  const failed = allResults.filter((r) => !r.status.startsWith('skipped') && r.status !== 'ok')

  return Response.json({
    kinds,
    total: allResults.length,
    migrated,
    skipped,
    failed,
  })
}
