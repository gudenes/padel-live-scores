import type { SupabaseClient } from '@supabase/supabase-js';
import { paginatedSelect } from './db-paginate.js';
import { strictPlayerLookup, normalizeIdentity, type IdentityPlayer, type IdentityResult } from './strict-player-resolver.js';
import { normalizeCountry } from './country.js';
import { roundCanonical } from './round-canonical.js';
import { courtbitPlayerKey, type CourtbitMatch } from './courtbit-client.js';
import type { Orientation, CourtbitSnapshot } from './courtbit-adapter.js';

export const courtbitPlayerSource = (tournamentId: string) => `courtbit_player:${tournamentId}`;
export const playerSlots = ['pair1_player1', 'pair1_player2', 'pair2_player1', 'pair2_player2'] as const;
export const playerColumns = ['pair1_player1_id', 'pair1_player2_id', 'pair2_player1_id', 'pair2_player2_id'] as const;
export interface CourtbitCandidate {
  id: string; category: string; round: string; status: string;
  pair1_player1_id: string | null; pair1_player2_id: string | null;
  pair2_player1_id: string | null; pair2_player2_id: string | null;
  pair1_player1_name: string | null; pair1_player2_name: string | null;
  pair2_player1_name: string | null; pair2_player2_name: string | null;
  pair1_player1_country?: string | null; pair1_player2_country?: string | null;
  pair2_player1_country?: string | null; pair2_player2_country?: string | null;
}
export interface CourtbitParticipant { slug: string; playerId: string | null; name: string; country: string; category: string }
export interface PlayerLink { slug: string; playerId: string; name: string; country: string; category: string }
export interface CourtbitContext {
  players: IdentityPlayer[];
  aliases: Map<string, string[]>;
  mappings: Map<string, { id: string; metadata: { name?: string; country?: string; category?: string } | null }>;
  matches: CourtbitCandidate[];
  cache: Map<string, { matchId: string; snapshot: CourtbitSnapshot | null }>;
}
const rosterCache = new WeakMap<SupabaseClient, { expires: number; players: IdentityPlayer[]; aliases: Map<string, string[]> }>();

export async function loadCourtbitContext(db: SupabaseClient, tournamentId: string): Promise<CourtbitContext> {
  let roster = rosterCache.get(db);
  if (!roster || roster.expires < Date.now()) {
    const rows = await paginatedSelect<any>((a, b) => db.from('players')
      .select('id,name,category,country,fip_id,external_id').neq('tier', 'amateur').order('id').range(a, b), { what: 'CourtBit Player Resolver roster' });
    const aliasRows = await paginatedSelect<any>((a, b) => db.from('entity_external_ids')
      .select('entity_id,external_id').eq('entity_type', 'player').eq('source', 'alias').order('id').range(a, b), { what: 'CourtBit Player Resolver aliases' });
    const aliases = new Map<string, string[]>();
    for (const row of aliasRows) {
      const key = normalizeIdentity(row.external_id);
      aliases.set(key, [...(aliases.get(key) ?? []), row.entity_id]);
    }
    roster = { expires: Date.now() + 60_000, aliases, players: rows.map(r => ({ ...r, fipId: r.fip_id, externalId: r.external_id })) };
    rosterCache.set(db, roster);
  }
  const mappings = await paginatedSelect<any>((a, b) => db.from('entity_external_ids').select('external_id,entity_id,metadata')
    .eq('entity_type', 'player').eq('source', courtbitPlayerSource(tournamentId)).order('id').range(a, b), { what: 'CourtBit player mappings' });
  const matches = await paginatedSelect<CourtbitCandidate>((a, b) => db.from('matches').select(`id,category,round,status,${playerColumns.join(',')},pair1_player1_name,pair1_player2_name,pair2_player1_name,pair2_player2_name,${playerSlots.map(s => `${s}_country`).join(',')}`)
    .eq('tournament_id', tournamentId).order('id').range(a, b), { what: 'CourtBit match candidates' });
  const cache = await paginatedSelect<any>((a, b) => db.from('entity_external_ids').select('external_id,entity_id,metadata')
    .eq('entity_type', 'match').eq('source', 'courtbit').like('external_id', `${tournamentId}:%`).order('id').range(a, b), { what: 'CourtBit state' });
  return {
    players: roster.players, aliases: roster.aliases, matches,
    mappings: new Map(mappings.map(m => [m.external_id, { id: m.entity_id, metadata: m.metadata }])),
    cache: new Map(cache.map(m => [m.external_id.slice(tournamentId.length + 1), { matchId: m.entity_id, snapshot: m.metadata?.snapshot ?? null }])),
  };
}

export function resolveCourtbitPlayer(p: CourtbitMatch['a']['players'][number], category: string, ctx: CourtbitContext): IdentityResult {
  const mapping = ctx.mappings.get(courtbitPlayerKey(p));
  if (mapping) {
    const player = ctx.players.find(c => c.id === mapping.id);
    // Validated mappings disambiguate duplicate names, but never bypass
    // category/country or a reused slug with a changed name.
    if (!player || player.category !== category || (player.country && normalizeCountry(player.country) !== normalizeCountry(p.country)) ||
        !mapping.metadata || normalizeIdentity(mapping.metadata.name ?? '') !== normalizeIdentity(p.name) ||
        mapping.metadata.category !== category || normalizeCountry(mapping.metadata.country) !== normalizeCountry(p.country)) {
      return { found: false, matchType: 'none', reason: 'identity_conflict', candidates: [mapping.id] };
    }
    return strictPlayerLookup({ name: p.name, category, country: p.country, playerId: mapping.id }, ctx.players, ctx.aliases);
  }
  return strictPlayerLookup({ name: p.name, category, country: p.country }, ctx.players, ctx.aliases);
}

const phaseMap: Record<string, string> = {
  'previa ronda 1': 'Q1', 'previa ronda 2': 'Q2', 'previa ronda 3': 'Q3',
  'dieciseisavos de final': 'R32', 'octavos de final': 'R16', 'cuartos de final': 'QF', 'semifinal': 'SF', 'final': 'F',
};
export type CourtbitResolution =
  | { ok: true; matchId: string; status: string; orientation: Orientation;
      players: (string | null)[]; expectedNames: (string | null)[];
      participants: CourtbitParticipant[]; links: PlayerLink[] }
  | { ok: false; reason: string; candidates: string[] };

/** Resolve the fixture separately from the four profile links. Exact full-name
 * evidence can identify a unique fixture while an ambiguous person stays thin.
 * Never let an existing FK disambiguate a duplicate player automatically. */
export function resolveCourtbitMatch(row: CourtbitMatch, ctx: CourtbitContext): CourtbitResolution {
  const category = row.category === 'Femenino' ? 'women' : 'men';
  const round = phaseMap[normalizeIdentity(row.phase)];
  if (!round) return { ok: false, reason: 'unknown_round', candidates: [] };
  if (row.a.players.length !== 2 || row.b.players.length !== 2) return { ok: false, reason: 'placeholder_players', candidates: [] };
  const incoming = [...row.a.players, ...row.b.players];
  const identities = incoming.map(p => resolveCourtbitPlayer(p, category, ctx));
  const conflict = identities.find(r => !r.found && r.reason === 'identity_conflict');
  if (conflict && !conflict.found) return { ok: false, reason: 'player_identity_conflict', candidates: conflict.candidates };
  const resolvedIds = identities.flatMap(r => r.found ? [r.playerId] : []);
  if (new Set(resolvedIds).size !== resolvedIds.length || new Set(incoming.map(p => normalizeIdentity(p.name))).size !== 4)
    return { ok: false, reason: 'duplicate_player', candidates: resolvedIds };
  const hits: Array<{ match: CourtbitCandidate; orientation: Orientation; order: number[] }> = [];
  for (const match of ctx.matches) {
    if (match.category !== category || roundCanonical(match.round) !== round) continue;
    const fits = (provider: number, slotIndex: number) => {
      const p = incoming[provider]!;
      const identity = identities[provider]!;
      const slot = playerSlots[slotIndex]!;
      const id = match[`${slot}_id`];
      if (identity.found && identity.playerId === id) return true;
      const linked = id ? ctx.players.find(c => c.id === id) : null;
      // A different known person/country is a conflict, even if a raw label matches.
      if (id && (!linked || linked.category !== category || normalizeIdentity(linked.name) !== normalizeIdentity(p.name))) return false;
      const name = match[`${slot}_name`] || linked?.name;
      const country = match[`${slot}_country`] || linked?.country;
      if (linked?.country && normalizeCountry(linked.country) !== normalizeCountry(p.country)) return false;
      if (country && normalizeCountry(country) !== normalizeCountry(p.country)) return false;
      // No initials, fuzzy labels or placeholder names in the fixture fallback.
      return !!name && normalizeIdentity(name).split(' ').length >= 2 && normalizeIdentity(name) === normalizeIdentity(p.name);
    };
    for (const orientation of ['AB', 'BA'] as const) {
      const sides = orientation === 'AB' ? [[0, 1], [2, 3]] : [[2, 3], [0, 1]];
      for (const first of [sides[0]!, [...sides[0]!].reverse()]) {
        for (const second of [sides[1]!, [...sides[1]!].reverse()]) {
          const order = [...first, ...second];
          if (order.every((provider, slot) => fits(provider!, slot))) hits.push({ match, orientation, order: order as number[] });
        }
      }
    }
  }
  if (hits.length !== 1) return { ok: false, reason: hits.length ? 'ambiguous_match' : 'match_requires_reconciliation', candidates: hits.map(h => h.match.id) };
  const { match, orientation, order } = hits[0]!;
  const cached = ctx.cache.get(row.id);
  if (cached && cached.matchId !== match.id) return { ok: false, reason: 'provider_id_reused', candidates: [cached.matchId, match.id] };
  const participants = order.map(i => {
    const p = incoming[i]!, identity = identities[i]!;
    return { slug: courtbitPlayerKey(p), name: p.name, country: p.country, category, playerId: identity.found ? identity.playerId : null };
  });
  return { ok: true, matchId: match.id, status: match.status, orientation,
    players: playerColumns.map(c => match[c]), expectedNames: playerSlots.map(s => match[`${s}_name`]),
    participants, links: participants.filter((p): p is PlayerLink => p.playerId !== null) };
}
