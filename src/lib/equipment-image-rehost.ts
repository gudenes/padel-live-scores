// src/lib/equipment-image-rehost.ts
// Downloads an external brand-logo or racket-image URL and rehosts it on
// Supabase Storage, then UPDATEs padel_brands.logo_url / padel_rackets.image_url
// to the new public URL. Used by:
//   - /api/admin/migrate-equipment-images (one-off batch)
//   - /api/ops/brands and /api/ops/rackets (server-side rehost on every write)
//
// Mirrors src/lib/avatar-rehost.ts. SVG is allowed (some brand logos are SVG).

import type { SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'equipment'
const SUPABASE_STORAGE_MARKER = '.supabase.co/storage/'

export type EquipmentKind = 'brand' | 'racket'

export type RehostStatus =
  | 'ok'
  | 'skipped-already-hosted'
  | 'skipped-no-source'
  | 'download-failed'
  | 'upload-failed'
  | 'db-update-failed'
  | 'error'

export interface RehostResult {
  kind: EquipmentKind
  entityId: string
  status: RehostStatus
  newUrl?: string
  detail?: string
}

export function pickExtension(contentType: string): string {
  if (contentType.includes('svg')) return 'svg'
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('gif')) return 'gif'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg'
  return 'jpg'
}

export function isSupabaseHosted(url: string | null | undefined): boolean {
  return !!url && url.includes(SUPABASE_STORAGE_MARKER)
}

function tableFor(kind: EquipmentKind): { table: string; column: 'logo_url' | 'image_url' } {
  return kind === 'brand'
    ? { table: 'padel_brands', column: 'logo_url' }
    : { table: 'padel_rackets', column: 'image_url' }
}

/**
 * Rehost a single brand logo or racket image. Idempotent + safe to call on
 * every ops write — when the current URL is already on Supabase Storage we
 * short-circuit before any network call. Errors are returned via the result
 * object rather than thrown so a failed upstream image never breaks the
 * calling write path.
 */
export async function rehostEquipmentImageToSupabase(
  supabase: SupabaseClient,
  kind: EquipmentKind,
  entityId: string,
  sourceUrl: string | null | undefined,
): Promise<RehostResult> {
  if (!sourceUrl) {
    return { kind, entityId, status: 'skipped-no-source' }
  }
  if (isSupabaseHosted(sourceUrl)) {
    return { kind, entityId, status: 'skipped-already-hosted', newUrl: sourceUrl }
  }

  const { table, column } = tableFor(kind)

  // Re-read the current row — if it's already Supabase-hosted, skip.
  const { data: current, error: readError } = await supabase
    .from(table)
    .select(column)
    .eq('id', entityId)
    .maybeSingle()
  if (readError) {
    return { kind, entityId, status: 'error', detail: `read failed: ${readError.message}` }
  }
  const currentUrl = (current as Record<string, string | null> | null)?.[column] ?? null
  if (isSupabaseHosted(currentUrl)) {
    return { kind, entityId, status: 'skipped-already-hosted', newUrl: currentUrl! }
  }

  try {
    const res = await fetch(sourceUrl)
    if (!res.ok) {
      return { kind, entityId, status: 'download-failed', detail: `${res.status} ${res.statusText}` }
    }
    const contentType = res.headers.get('Content-Type') ?? 'image/jpeg'
    const ext = pickExtension(contentType)
    const buffer = await res.arrayBuffer()
    const filePath = `${kind}-${entityId}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, buffer, { contentType, upsert: true })
    if (uploadError) {
      return { kind, entityId, status: 'upload-failed', detail: uploadError.message }
    }

    const newUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${filePath}`

    const { error: updateError } = await supabase
      .from(table)
      .update({ [column]: newUrl })
      .eq('id', entityId)
    if (updateError) {
      return { kind, entityId, status: 'db-update-failed', detail: updateError.message }
    }

    return { kind, entityId, status: 'ok', newUrl }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return { kind, entityId, status: 'error', detail }
  }
}

/**
 * Ensure the equipment bucket exists. Safe to call repeatedly — the
 * "already exists" error is treated as success.
 */
export async function ensureEquipmentBucket(
  supabase: SupabaseClient,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 2 * 1024 * 1024,
    allowedMimeTypes: ['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'image/svg+xml'],
  })
  if (error && !error.message.includes('already exists')) {
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
