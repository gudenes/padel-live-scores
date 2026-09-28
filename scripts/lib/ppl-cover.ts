// Rehosts a Pro Padel League event's hero image onto Supabase Storage and
// points tournaments.cover_image_url at the copy.
//
// WHY REHOST RATHER THAN HOTLINK
//
// The existing FIP covers are hotlinked straight from padelfip.com, so
// rehosting is a departure. Two reasons force it here:
//
//   1. The images live on firebasestorage.googleapis.com, which is NOT in
//      next.config.ts's `remotePatterns`. TournamentCoverImage renders
//      through next/image, which refuses an unconfigured host outright.
//      Adding the host would work, but see (2).
//
//   2. Their URLs carry an access token:
//        .../hero.jpg?alt=media&token=b091b828-8050-48ba-8411-2347c5e18cc8
//      That token is upstream's to rotate, and when it rotates every cover
//      dies at once. This is the same reasoning that already rehosts player
//      avatars (src/lib/avatar-rehost.ts) so push icons survive upstream
//      hiccups.
//
// SHAPE IS CHECKED BEFORE ANYTHING IS WRITTEN
//
// `hero.image` is not consistently a cover. Measured across the season it is
// a portrait poster for New York, an ultra-wide banner for Los Angeles and a
// proper landscape photo for Playa del Carmen and Miami. Only the last shape
// survives a cover crop, so the bytes are measured and the rest are skipped
// in favour of the tier-gradient fallback that already exists.

import type { SupabaseClient } from '@supabase/supabase-js'
import { imageDimensions, isUsableCover } from '../../src/lib/image-dimensions'

const BUCKET = 'tournament-covers'
const SUPABASE_STORAGE_MARKER = '.supabase.co/storage/'

export type CoverStatus =
  | 'ok'
  | 'skipped-already-hosted'
  | 'skipped-no-source'
  | 'skipped-wrong-shape'
  | 'download-failed'
  | 'upload-failed'
  | 'db-update-failed'

export interface CoverResult {
  slug: string
  status: CoverStatus
  newUrl?: string
  detail?: string
}

function extensionFor(contentType: string): string {
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  return 'jpg'
}

/**
 * Idempotent: a cover already on Supabase Storage short-circuits before any
 * network call, so this is safe to run on every import.
 *
 * Never throws. A failed upstream image must not take down an import whose
 * real job is matches and results.
 */
export async function rehostCover(
  supabase: SupabaseClient,
  tournamentId: string,
  slug: string,
  sourceUrl: string | null | undefined,
  currentCover: string | null | undefined,
  opts: { apply: boolean } = { apply: true },
): Promise<CoverResult> {
  if (!sourceUrl) return { slug, status: 'skipped-no-source' }
  if (currentCover?.includes(SUPABASE_STORAGE_MARKER)) {
    return { slug, status: 'skipped-already-hosted' }
  }

  let bytes: Uint8Array
  let contentType: string
  try {
    const res = await fetch(sourceUrl)
    if (!res.ok) return { slug, status: 'download-failed', detail: `HTTP ${res.status}` }
    contentType = res.headers.get('content-type') ?? 'image/jpeg'
    bytes = new Uint8Array(await res.arrayBuffer())
  } catch (e) {
    return { slug, status: 'download-failed', detail: (e as Error).message }
  }

  const size = imageDimensions(bytes)
  if (!isUsableCover(size)) {
    return {
      slug,
      status: 'skipped-wrong-shape',
      detail: size ? `${size.width}x${size.height} (ratio ${(size.width / size.height).toFixed(2)})` : 'unreadable',
    }
  }

  if (!opts.apply) {
    return { slug, status: 'ok', detail: `${size!.width}x${size!.height} (dry run, not uploaded)` }
  }

  const ext = extensionFor(contentType)
  const key = `ppl/${slug}.${ext}`
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(key, bytes, { contentType, upsert: true })
  if (upErr) return { slug, status: 'upload-failed', detail: upErr.message }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(key)
  const newUrl = pub.publicUrl

  const { error: dbErr } = await supabase
    .from('tournaments')
    .update({ cover_image_url: newUrl })
    .eq('id', tournamentId)
  if (dbErr) return { slug, status: 'db-update-failed', detail: dbErr.message }

  return { slug, status: 'ok', newUrl, detail: `${size!.width}x${size!.height}` }
}
