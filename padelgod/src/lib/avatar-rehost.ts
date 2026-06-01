// padelgod/src/lib/avatar-rehost.ts
//
// Mirror of src/lib/avatar-rehost.ts (Next.js project). Padelgod runs
// as a separate Railway service and doesn't share imports with the
// Next.js app — same trade-off used by `db-paginate.ts` and
// `fip-player-search.ts`. Keep this file BYTE-IDENTICAL with the
// Next.js side except for this header. If you edit one, mirror the
// other.

// Downloads a raw external avatar URL (padelfip.com, padelapi.org, googlestorage,
// etc.) and rehosts it on Supabase Storage, then updates players.avatar_url to
// the new public URL. Used by the one-time `migrate-avatars` admin endpoint AND
// by the daily `sync-fip-rankings` cron so brand-new players landing via the
// FIP rankings feed don't accumulate raw padelfip.com URLs.

import type { SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'avatars'
const SUPABASE_STORAGE_MARKER = '.supabase.co/storage/'

export type RehostStatus =
  | 'ok'
  | 'skipped-already-hosted'
  | 'skipped-no-source'
  | 'download-failed'
  | 'upload-failed'
  | 'db-update-failed'
  | 'error'

export interface RehostResult {
  playerId: string
  status: RehostStatus
  newUrl?: string
  detail?: string
}

function pickExtension(contentType: string): string {
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('gif')) return 'gif'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg'
  return 'jpg'
}

function isSupabaseHosted(url: string | null | undefined): boolean {
  return !!url && url.includes(SUPABASE_STORAGE_MARKER)
}

export function storageKeyFor(playerId: string, keySuffix: string, ext: string): string {
  return `${playerId}${keySuffix}.${ext}`
}

export interface RehostOptions {
  /** Which players column to read/write. Default 'avatar_url'. */
  column?: 'avatar_url' | 'photo_url'
  /** Suffix appended to the storage key, e.g. '-full'. Default ''. */
  keySuffix?: string
}

/**
 * Rehost a single avatar. Idempotent + safe to call from the daily ranking
 * sync — when the player's current avatar is already on Supabase Storage we
 * short-circuit before any network call.
 *
 * Errors are returned via the result object rather than thrown so a failed
 * upstream image never breaks the calling cron.
 */
export async function rehostAvatarToSupabase(
  supabase: SupabaseClient,
  playerId: string,
  sourceUrl: string | null | undefined,
  opts: RehostOptions = {},
): Promise<RehostResult> {
  const column = opts.column ?? 'avatar_url'
  const keySuffix = opts.keySuffix ?? ''

  if (!sourceUrl) {
    return { playerId, status: 'skipped-no-source' }
  }
  if (isSupabaseHosted(sourceUrl)) {
    return { playerId, status: 'skipped-already-hosted', newUrl: sourceUrl }
  }

  const { data: current, error: readError } = await supabase
    .from('players')
    .select(column)
    .eq('id', playerId)
    .maybeSingle()
  if (readError) {
    return { playerId, status: 'error', detail: `read failed: ${readError.message}` }
  }
  const currentUrl = (current as Record<string, string | null> | null)?.[column] ?? null
  if (isSupabaseHosted(currentUrl)) {
    return { playerId, status: 'skipped-already-hosted', newUrl: currentUrl! }
  }

  try {
    const res = await fetch(sourceUrl)
    if (!res.ok) {
      return { playerId, status: 'download-failed', detail: `${res.status} ${res.statusText}` }
    }
    const contentType = res.headers.get('Content-Type') ?? 'image/jpeg'
    const ext = pickExtension(contentType)
    const buffer = await res.arrayBuffer()
    const filePath = storageKeyFor(playerId, keySuffix, ext)

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, buffer, { contentType, upsert: true })
    if (uploadError) {
      return { playerId, status: 'upload-failed', detail: uploadError.message }
    }

    const newUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${filePath}`

    const { error: updateError } = await supabase
      .from('players')
      .update({ [column]: newUrl })
      .eq('id', playerId)
    if (updateError) {
      return { playerId, status: 'db-update-failed', detail: updateError.message }
    }

    return { playerId, status: 'ok', newUrl }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return { playerId, status: 'error', detail }
  }
}

/**
 * Ensure the avatars bucket exists. Safe to call repeatedly — the
 * "already exists" error is treated as success.
 */
export async function ensureAvatarsBucket(supabase: SupabaseClient): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 2 * 1024 * 1024,
    allowedMimeTypes: ['image/webp', 'image/jpeg', 'image/png', 'image/gif'],
  })
  if (error && !error.message.includes('already exists')) {
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
