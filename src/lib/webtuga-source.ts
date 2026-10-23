// Legacy function/API name retained for compatibility. Both Webtuga and Puntuate
// hide Score Recap because their polled point history can be incomplete.
// Server-side only: entity_external_ids requires the service-role client.
import type { SupabaseClient } from '@supabase/supabase-js'

export async function isMatchWebtugaSourced(
  supabase: SupabaseClient,
  matchId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('entity_external_ids')
    .select('entity_id')
    .eq('entity_type', 'match')
    .in('source', ['webtuga', 'puntuate'])
    .eq('entity_id', matchId)
    .limit(1)
    .maybeSingle()
  if (error) return false
  return !!data
}
