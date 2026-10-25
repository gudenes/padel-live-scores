import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeName } from './draw-resolver.js';

/** Only official, unabbreviated names can create a profile. Team IDs are not player IDs. */
export function isFullFipPlayerName(name: string | null): name is string {
  if (!name || /[\d.%_]/u.test(name)) return false;
  const words = normalizeName(name).split(' ').filter(Boolean);
  return words.length >= 2 && words.every(w => w.length > 1) &&
    !/\b(bye|tbd|qualifier|qualifying|winner|loser|unknown|lucky|pending)\b/i.test(name);
}

export function fipDrawProfileId(name: string, category: string): string {
  // Stable UUID makes retries/concurrent draw runs idempotent without inventing a FIP ID.
  const h = createHash('sha1').update(`padelgod:fip-draw-player:v1:${category}:${normalizeName(name)}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}

export function createFipDrawPlayerResolver(supabase: SupabaseClient, dryRun: boolean) {
  const cache = new Map<string, Promise<string | null>>();
  return (name: string | null, category: 'men' | 'women'): Promise<string | null> => {
    if (!isFullFipPlayerName(name)) return Promise.resolve(null);
    const key = `${category}:${normalizeName(name)}`;
    if (!cache.has(key)) cache.set(key, (async () => {
      const { data, error } = await supabase.from('players').select('id,category')
        .ilike('name', name.trim());
      if (error) throw new Error(`FIP full-name lookup failed: ${error.message}`);
      const candidates = (data ?? []).filter(p => p.category === category || p.category == null);
      if (candidates.length > 1) return null; // Never choose between homonyms.
      if (candidates.length === 1) return candidates[0]!.id as string;
      if (dryRun) return null; // No speculative FK and no writes in previews.
      const id = fipDrawProfileId(name, category);
      const { error: insertError } = await supabase.from('players').upsert({
        id, name: name.trim(), category, last_updated_by: 'padelgod',
      }, { onConflict: 'id', ignoreDuplicates: true });
      if (insertError) throw new Error(`FIP full-name profile insert failed: ${insertError.message}`);
      return id;
    })());
    return cache.get(key)!;
  };
}

type DrawTeam = { player1_name: string | null; player2_name: string | null;
  player1_id: string | null; player2_id: string | null };
/** Preserve known identity by full name, including when FIP reverses partner order. */
export function preserveDrawPlayerLinks<T extends DrawTeam>(incoming: T, existing: DrawTeam | null): T {
  if (!existing) return incoming;
  const result = { ...incoming };
  for (const slot of [1, 2] as const) {
    const name = incoming[`player${slot}_name`];
    if (!name) continue;
    const matches = ([1, 2] as const).filter(i => existing[`player${i}_name`] &&
      normalizeName(existing[`player${i}_name`]!) === normalizeName(name));
    if (matches.length === 1) {
      const known = existing[`player${matches[0]!}_id`];
      if (known) result[`player${slot}_id`] = known;
    }
  }
  return result;
}

/** Upgrade a unique full-name profile when the entry list finally supplies its individual ID. */
export async function attachFipIdToDrawProfile(supabase: SupabaseClient, entry: {
  name: string; category: 'men' | 'women'; fipId: string; country: string | null;
}, dryRun: boolean): Promise<string | null> {
  if (!isFullFipPlayerName(entry.name)) return null;
  const { data, error } = await supabase.from('players').select('id,category,country,fip_id')
    .ilike('name', entry.name.trim());
  if (error) throw new Error(`FIP profile upgrade lookup failed: ${error.message}`);
  const candidates = (data ?? []).filter(p => p.category === entry.category);
  if (candidates.length !== 1) return null;
  const candidate = candidates[0]!;
  if (candidate.fip_id || (candidate.country && entry.country && candidate.country !== entry.country)) return null;
  if (!dryRun) {
    const { data: updated, error: updateError } = await supabase.from('players').update({
      fip_id: entry.fipId, external_id: entry.fipId, last_updated_by: 'padelgod',
      profile_attempt_at: '1970-01-01T00:00:00Z',
    }).eq('id', candidate.id).is('fip_id', null).select('id');
    if (updateError || updated?.length !== 1) {
      throw new Error(`FIP profile upgrade failed: ${updateError?.message ?? 'concurrent identity change; retry next run'}`);
    }
  }
  return candidate.id as string;
}
