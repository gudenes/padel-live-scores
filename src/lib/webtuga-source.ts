// Single source of the "is this match fed by the webtuga live worker" check.
// A match is webtuga-sourced iff it has an entity_external_ids row with
// (entity_type='match', source='webtuga') — written by padelgod's
// webtuga-live-fetcher on resolve. Used to hide the Score Recap for these
// matches (their recap would be a breaks-only view from a best-effort point
// log, not real Crionet stats). Server-side only: entity_external_ids is
// anon-RLS-locked, so this must run with the service-role client.
import type { SupabaseClient } from '@supabase/supabase-js'

export async function isMatchWebtugaSourced(
  supabase: SupabaseClient,
  matchId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('entity_external_ids')
    .select('entity_id')
    .eq('entity_type', 'match')
    .eq('source', 'webtuga')
    .eq('entity_id', matchId)
    .maybeSingle()
  if (error) return false
  return !!data
}
