import type { CandidateMatch as BaseCandidate, ResolveResult } from './webtuga-resolve.js';
import type { PuntuateRow } from './puntuate-client.js';
export interface CandidateMatch extends BaseCandidate { status?: string }

function tokens(name: string): string[] {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
}
function playerMatches(short: string, full: string | null): boolean {
  if (!full) return false;
  const a = tokens(short), b = tokens(full);
  const surnames = a.filter(t => t.length > 1);
  return surnames.length > 0 && surnames.every(t => b.includes(t)) &&
    (a[0]?.length !== 1 || !!b[0]?.startsWith(a[0]));
}
function teamMatches(team: string, one: string | null, two: string | null): boolean {
  const names = team.split('/').map(s => s.trim());
  if (names.length !== 2) return false;
  return (playerMatches(names[0]!, one) && playerMatches(names[1]!, two)) ||
    (playerMatches(names[0]!, two) && playerMatches(names[1]!, one));
}
/** Require all four players and a unique orientation; never revive terminal matches. */
export function resolvePuntuateMatch(row: PuntuateRow, candidates: CandidateMatch[]): ResolveResult {
  const hits: Array<{ m: CandidateMatch; orientation: 'AB' | 'BA' }> = [];
  for (const m of candidates) {
    if (m.category !== row.category || (m.status && !['scheduled', 'live', 'on_court'].includes(m.status))) continue;
    if (teamMatches(row.teamA, m.pair1Player1Name, m.pair1Player2Name) && teamMatches(row.teamB, m.pair2Player1Name, m.pair2Player2Name)) hits.push({ m, orientation: 'AB' });
    if (teamMatches(row.teamB, m.pair1Player1Name, m.pair1Player2Name) && teamMatches(row.teamA, m.pair2Player1Name, m.pair2Player2Name)) hits.push({ m, orientation: 'BA' });
  }
  if (hits.length > 1) return { ambiguous: true };
  const hit = hits[0];
  if (!hit) return null;
  const { m, orientation } = hit;
  return { matchId: m.id, orientation, resolvedPlayers: {
    pair1Player1Id: m.pair1Player1Id, pair1Player2Id: m.pair1Player2Id,
    pair2Player1Id: m.pair2Player1Id, pair2Player2Id: m.pair2Player2Id,
  } };
}
