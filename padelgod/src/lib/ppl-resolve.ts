import type { SupabaseClient } from '@supabase/supabase-js';
import { paginatedSelect } from './db-paginate.js';
import { normalizeIdentity, strictPlayerLookup, type IdentityPlayer } from './strict-player-resolver.js';
import type { PplSnapshot } from './ppl-adapter.js';
import reviewedIdentities from './ppl-reviewed-identities.json' with { type: 'json' };

export const pplPlayerColumns = ['pair1_player1_id', 'pair1_player2_id', 'pair2_player1_id', 'pair2_player2_id'] as const;
export interface PplCandidate {
  id: string; tie_id: string; category: string; status: string;
  pair1_player1_id: string | null; pair1_player2_id: string | null;
  pair2_player1_id: string | null; pair2_player2_id: string | null;
}
export interface PplContext {
  players: IdentityPlayer[]; aliases: Map<string, string[]>;
  mappings: Map<string, { id: string; name?: string; category?: string }>;
  matches: PplCandidate[]; ties: Array<{ id: string; tie_key: string }>;
  matchMappings: Map<string, string>;
}
export async function loadPplContext(db: SupabaseClient, tournamentId: string): Promise<PplContext> {
  const read = async <T>(table: string, columns: string, filter: (q: any) => any): Promise<T[]> =>
    paginatedSelect<T>((a, b) => filter(db.from(table).select(columns)).order('id').range(a, b), { what: `PPL ${table}` });
  const [players, aliases, mappings, matches, ties, links] = await Promise.all([
    read<IdentityPlayer>('players', 'id,name,category,country', q => q),
    read<{ entity_id: string; external_id: string }>('entity_external_ids', 'id,entity_id,external_id', q => q.eq('entity_type', 'player').eq('source', 'alias')),
    read<{ entity_id: string; external_id: string; metadata: { name?: string; category?: string } | null }>('entity_external_ids', 'id,entity_id,external_id,metadata', q => q.eq('entity_type', 'player').eq('source', 'ppl')),
    read<PplCandidate>('matches', `id,tie_id,category,status,${pplPlayerColumns.join(',')}`, q => q.eq('tournament_id', tournamentId)),
    read<{ id: string; tie_key: string }>('league_ties', 'id,tie_key', q => q.eq('tournament_id', tournamentId)),
    read<{ entity_id: string; external_id: string }>('entity_external_ids', 'id,entity_id,external_id', q => q.eq('entity_type', 'match').eq('source', 'ppl')),
  ]);
  const aliasMap = new Map<string, string[]>();
  for (const a of aliases) { const k = normalizeIdentity(a.external_id); aliasMap.set(k, [...(aliasMap.get(k) ?? []), a.entity_id]); }
  return { players, aliases: aliasMap, mappings: new Map(mappings.map(m => [m.external_id, { id: m.entity_id, ...m.metadata }])),
    matches, ties, matchMappings: new Map(links.map(m => [m.external_id, m.entity_id])) };
}
export type PplResolution = { ok: true; matchId: string; oldPlayers: Array<string | null>; playerIds: string[]; tieKey: string }
  | { ok: false; reason: string; candidates: string[] };

/** Reconcile missing source IDs using the event-scoped team tie + division.
 * Never insert a second match just because its external mapping is missing. */
export function resolvePplSnapshot(s: PplSnapshot, ctx: PplContext): PplResolution {
  // Static imports use an empty session; early adapter versions used "null".
  // Preserve the stored key for the writer and never choose between duplicates.
  const keys = new Set([`${s.stage}|${s.session ?? ''}|${s.homeTeam}|${s.awayTeam}`,
    `${s.stage}|${s.session ?? 'null'}|${s.homeTeam}|${s.awayTeam}`]);
  const ties = ctx.ties.filter(t => keys.has(t.tie_key));
  if (ties.length > 1) return { ok: false, reason: 'ambiguous_fixture', candidates: ties.map(t => t.id) };
  const tieKey = ties[0]?.tie_key ?? '';
  const tieIds = ties.map(t => t.id);
  const hits = ctx.matches.filter(m => tieIds.includes(m.tie_id) && m.category === s.category);
  if (hits.length !== 1) return { ok: false, reason: hits.length ? 'ambiguous_fixture' : 'fixture_requires_onboarding', candidates: hits.map(m => m.id) };
  const m = hits[0]!, link = ctx.matchMappings.get(s.providerId);
  if (link && link !== m.id) return { ok: false, reason: 'provider_id_conflict', candidates: [link, m.id] };
  if (s.players.length !== 4) return { ok: false, reason: 'lineup_unconfirmed', candidates: [] };
  const playerIds: string[] = [];
  for (const p of s.players) {
    // Explicit decision already recorded in scripts/ppl-player-map.json.
    // This is not an inference from an existing lineup or a namesake's rank.
    const reviewed = (reviewedIdentities as Record<string, { id: string; name: string; category: string }>)[p.slug];
    const stored = ctx.mappings.get(p.slug);
    if (stored && reviewed && stored.id !== reviewed.id) return { ok: false, reason: 'reviewed_identity_conflict', candidates: [stored.id, reviewed.id] };
    const mapped = stored ?? reviewed;
    if (mapped && (normalizeIdentity(mapped.name ?? '') !== normalizeIdentity(p.name) || mapped.category !== p.category))
      return { ok: false, reason: 'player_mapping_requires_review', candidates: [mapped.id] };
    const result = strictPlayerLookup({ name: p.name, category: p.category, country: p.country,
      ...(mapped ? { playerId: mapped.id } : {}) }, ctx.players, ctx.aliases);
    if (!result.found) return { ok: false, reason: `player_${result.reason}:${p.slug}`, candidates: result.candidates };
    playerIds.push(result.playerId);
  }
  if (new Set(playerIds).size !== 4) return { ok: false, reason: 'duplicate_player', candidates: playerIds };
  const oldPlayers = pplPlayerColumns.map(c => m[c]);
  // Pair slots may be reversed, but changing membership requires explicit review.
  for (const offset of [0, 2]) {
    if (oldPlayers.slice(offset, offset + 2).some(p => p && !playerIds.slice(offset, offset + 2).includes(p)))
      return { ok: false, reason: 'existing_lineup_conflict', candidates: [m.id] };
  }
  return { ok: true, matchId: m.id, oldPlayers, playerIds, tieKey };
}
