// src/app/api/admin/migrate-avatars/route.ts
// One-time migration: downloads player avatars from an external source
// (Google Storage or padelfip.com) and rehosts them on Supabase Storage,
// then updates players.avatar_url.
//
// Usage:
//   POST /api/admin/migrate-avatars                          → defaults to source=googlestorage (back-compat)
//   POST /api/admin/migrate-avatars?source=padelfip          → migrate padelfip.com/wp-content/uploads/* rows
//   POST /api/admin/migrate-avatars?source=padelfip&limit=1  → test on a single row first
//
// Auth: Authorization: Bearer $CRON_SECRET

import { createServerClient } from '@/lib/supabase'
import { ensureAvatarsBucket, rehostAvatarToSupabase } from '@/lib/avatar-rehost'

const BATCH_SIZE = 20

const SOURCE_PREFIXES: Record<string, string> = {
  googlestorage: 'https://storage.googleapis.com/fantasypadeltour/',
  padelfip: 'https://www.padelfip.com/wp-content/uploads/',
}

function unauthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const header = request.headers.get('authorization')
  return header !== `Bearer ${expected}`
}

export async function POST(request: Request) {
  if (unauthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const source = (url.searchParams.get('source') ?? 'googlestorage').toLowerCase()
  const prefix = SOURCE_PREFIXES[source]
  if (!prefix) {
    return Response.json(
      { error: `Unknown source: ${source}`, validSources: Object.keys(SOURCE_PREFIXES) },
      { status: 400 },
    )
  }

  const limitParam = url.searchParams.get('limit')
  const limit = limitParam ? Math.max(1, parseInt(limitParam, 10) || 0) : null

  const sb = createServerClient()

  const bucket = await ensureAvatarsBucket(sb)
  if (!bucket.ok) {
    return Response.json({ error: 'Failed to create bucket', detail: bucket.error }, { status: 500 })
  }

  let query = sb
    .from('players')
    .select('id, name, avatar_url')
    .like('avatar_url', `${prefix}%`)
    .order('id')

  if (limit) query = query.limit(limit)

  const { data: players, error: fetchError } = await query

  if (fetchError) {
    return Response.json({ error: 'Failed to fetch players', detail: fetchError.message }, { status: 500 })
  }

  if (!players || players.length === 0) {
    return Response.json({ source, message: 'No players to migrate', migrated: 0 })
  }

  const results: Array<{ id: string; name: string; status: string; newUrl?: string; detail?: string }> = []

  for (let i = 0; i < players.length; i += BATCH_SIZE) {
    const batch = players.slice(i, i + BATCH_SIZE)
    await Promise.all(
      batch.map(async (player) => {
        const result = await rehostAvatarToSupabase(sb, player.id, player.avatar_url)
        results.push({
          id: player.id,
          name: player.name,
          status: result.status,
          newUrl: result.newUrl,
          detail: result.detail,
        })
      }),
    )
  }

  const migrated = results.filter(r => r.status === 'ok').length
  const skipped = results.filter(r => r.status.startsWith('skipped')).length
  const failed = results.filter(r => !r.status.startsWith('skipped') && r.status !== 'ok')

  return Response.json({
    source,
    message: `Migrated ${migrated}/${players.length} avatars (skipped ${skipped})`,
    migrated,
    skipped,
    total: players.length,
    failed,
  })
}
