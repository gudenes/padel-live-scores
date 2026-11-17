/** Shared, side-effect-free strict branch of Player Resolver.
 * Used by both the app's PlayerResolver.lookup and provider ingestion.
 * Ambiguity is a result, never a database-order tie breaker.
 */
import { normalizeCountry } from './country.js';

export interface IdentityPlayer {
  id: string; name: string; category: string | null; country: string | null;
  fipId?: string | null; externalId?: string | null;
}
export interface IdentityInput {
  name: string; category?: string | null; country?: string | null;
  fipId?: string | null; externalId?: string | null;
  /** Only supply after validating a stored provider mapping's fingerprint. */
  playerId?: string;
}
export type IdentityResult =
  | { found: true; playerId: string; playerName: string; matchType: 'exact' | 'fuzzy'; candidates: string[] }
  | { found: false; matchType: 'none'; reason: 'ambiguous' | 'not_found' | 'identity_conflict'; candidates: string[] };

export function normalizeIdentity(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export function strictPlayerLookup(
  input: IdentityInput,
  players: readonly IdentityPlayer[],
  aliases: ReadonlyMap<string, readonly string[]> = new Map(),
): IdentityResult {
  const country = normalizeCountry(input.country);
  if (input.country && !country) return { found: false, matchType: 'none', reason: 'identity_conflict', candidates: [] };
  const compatible = (p: IdentityPlayer) => (!input.category || p.category === input.category) &&
    (!country || !p.country || normalizeCountry(p.country) === country);
  const select = (rows: IdentityPlayer[], matchType: 'exact' | 'fuzzy'): IdentityResult => {
    const unique = [...new Map(rows.map(p => [p.id, p])).values()];
    if (unique.length !== 1) return { found: false, matchType: 'none', reason: unique.length ? 'ambiguous' : 'not_found', candidates: unique.map(p => p.id) };
    const p = unique[0]!;
    return { found: true, playerId: p.id, playerName: p.name, matchType, candidates: [p.id] };
  };
  const ids = players.filter(p => (input.playerId && p.id === input.playerId) || (input.fipId && p.fipId === input.fipId) || (input.externalId && p.externalId === input.externalId));
  if (input.playerId || input.fipId || input.externalId) {
    if (!ids.length || ids.some(p => !compatible(p)) || new Set(ids.map(p => p.id)).size !== 1) {
      return { found: false, matchType: 'none', reason: 'identity_conflict', candidates: ids.map(p => p.id) };
    }
    return select(ids, 'exact');
  }
  const name = normalizeIdentity(input.name);
  if (!name) return select([], 'exact');
  const aliasIds = new Set(aliases.get(name) ?? []);
  // Include exact-name collisions even when an alias exists: an alias must
  // not quietly hide a second equally named identity or a country conflict.
  const exact = players.filter(p => normalizeIdentity(p.name) === name || aliasIds.has(p.id));
  const compatibleExact = exact.filter(compatible);
  if (compatibleExact.length) return select(compatibleExact, 'exact');
  if (exact.length) return { found: false, matchType: 'none', reason: 'identity_conflict', candidates: exact.map(p => p.id) };
  const tokens = name.split(' ').filter(t => t.length > 1);
  // Conservative full-token subset only. No initials-only or surname-only
  // fallback; all tied candidates survive for explicit disambiguation.
  if (tokens.length < 2) return select([], 'fuzzy');
  return select(players.filter(p => {
    if (!compatible(p)) return false;
    const other = normalizeIdentity(p.name).split(' ').filter(t => t.length > 1);
    return other.length >= 2 && tokens[0] === other[0] &&
      (tokens.every(t => other.includes(t)) || other.every(t => tokens.includes(t)));
  }), 'fuzzy');
}
