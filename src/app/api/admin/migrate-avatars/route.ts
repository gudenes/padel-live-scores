// src/app/api/admin/migrate-avatars/route.ts
// One-time migration: downloads player avatars from Google Storage
// and uploads them to Supabase Storage, then updates the avatar_url in DB.

import { createServerClient } from '@/lib/supabase'

const BUCKET = 'avatars'
const BATCH_SIZE = 20
const GOOGLE_PREFIX = 'https://storage.googleapis.com/fantasypadeltour/'

export async function POST(request: Request) {
  const sb = createServerClient()

  // 1. Ensure bucket exists (creates if not, ignores if already there)
  const { error: bucketError } = await sb.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 2 * 1024 * 1024, // 2MB
    allowedMimeTypes: ['image/webp', 'image/jpeg', 'image/png', 'image/gif'],
  })
  if (bucketError && !bucketError.message.includes('already exists')) {
    return Response.json({ error: 'Failed to create bucket', detail: bucketError.message }, { status: 500 })
  }

  // 2. Fetch players with Google Storage avatar URLs
  const { data: players, error: fetchError } = await sb
    .from('players')
    .select('id, name, avatar_url')
    .like('avatar_url', `${GOOGLE_PREFIX}%`)
    .order('id')

  if (fetchError) {
    return Response.json({ error: 'Failed to fetch players', detail: fetchError.message }, { status: 500 })
  }

  if (!players || players.length === 0) {
    return Response.json({ message: 'No players to migrate', migrated: 0 })
  }

  // 3. Process in batches
  const results: { id: string; name: string; status: string; newUrl?: string }[] = []
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!

  for (let i = 0; i < players.length; i += BATCH_SIZE) {
    const batch = players.slice(i, i + BATCH_SIZE)

    await Promise.all(batch.map(async (player) => {
      try {
        // Download from Google Storage
        const res = await fetch(player.avatar_url)
        if (!res.ok) {
          results.push({ id: player.id, name: player.name, status: `download failed: ${res.status}` })
          return
        }

        const contentType = res.headers.get('Content-Type') ?? 'image/webp'
        const ext = contentType.includes('png') ? 'png' : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg' : 'webp'
        const buffer = await res.arrayBuffer()
        const filePath = `${player.id}.${ext}`

        // Upload to Supabase Storage
        const { error: uploadError } = await sb.storage
          .from(BUCKET)
          .upload(filePath, buffer, {
            contentType,
            upsert: true,
          })

        if (uploadError) {
          results.push({ id: player.id, name: player.name, status: `upload failed: ${uploadError.message}` })
          return
        }

        // Build public URL
        const newUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${filePath}`

        // Update player record
        const { error: updateError } = await sb
          .from('players')
          .update({ avatar_url: newUrl })
          .eq('id', player.id)

        if (updateError) {
          results.push({ id: player.id, name: player.name, status: `db update failed: ${updateError.message}` })
          return
        }

        results.push({ id: player.id, name: player.name, status: 'ok', newUrl })
      } catch (err: any) {
        results.push({ id: player.id, name: player.name, status: `error: ${err.message}` })
      }
    }))
  }

  const migrated = results.filter(r => r.status === 'ok').length
  const failed = results.filter(r => r.status !== 'ok')

  return Response.json({
    message: `Migrated ${migrated}/${players.length} avatars`,
    migrated,
    total: players.length,
    failed,
  })
}
