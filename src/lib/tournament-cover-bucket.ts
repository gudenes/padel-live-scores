import type { SupabaseClient } from '@supabase/supabase-js'

export const TOURNAMENT_COVERS_BUCKET = 'tournament-covers'

let bucketEnsured = false

/**
 * Creates the `tournament-covers` storage bucket if it doesn't exist.
 * Public read; service-key write. Idempotent — safe to call on every request.
 */
export async function ensureTournamentCoversBucket(supabase: SupabaseClient): Promise<void> {
  if (bucketEnsured) return
  const { data: buckets, error: listError } = await supabase.storage.listBuckets()
  if (listError) throw new Error(`listBuckets failed: ${listError.message}`)
  const exists = buckets?.some((b) => b.name === TOURNAMENT_COVERS_BUCKET)
  if (!exists) {
    const { error: createError } = await supabase.storage.createBucket(TOURNAMENT_COVERS_BUCKET, {
      public: true,
    })
    if (createError && !createError.message.includes('already exists')) {
      throw new Error(`createBucket failed: ${createError.message}`)
    }
  }
  bucketEnsured = true
}
