// apps/ops/src/lib/team-image.ts
// Storage helpers for team images. Separate bucket from `avatars` (people) and
// `equipment` (rackets) so a retention or access change on one never surprises
// the others.

import type { SupabaseClient } from '@supabase/supabase-js'

export const TEAM_BUCKET = 'teams'
export type TeamImageKind = 'cover' | 'crest'

export function isTeamImageKind(value: string): value is TeamImageKind {
  return value === 'cover' || value === 'crest'
}

export function pickExtension(contentType: string): string {
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  return 'jpg'
}

/** Creates the bucket on first use; treats "already exists" as success. */
export async function ensureTeamBucket(
  supabase: SupabaseClient,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.storage.createBucket(TEAM_BUCKET, {
    public: true,
    fileSizeLimit: 2 * 1024 * 1024,
    allowedMimeTypes: ['image/webp', 'image/jpeg', 'image/png'],
  })
  if (error && !error.message.includes('already exists')) {
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
