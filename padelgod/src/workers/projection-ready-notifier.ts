import { pairSlugFromNames } from '../lib/projection-slug.js';
import type { NotifyEventPayload } from '../lib/notify.js';

const ICON_BASE = 'https://padelnachos.com';
// Mirror of the Next app's premier-tier set (notification-icon fallback only).
const PREMIER_LEVELS = new Set(['major', 'p1', 'p2', 'finals', 'premier_mens', 'premier_womens', 'fip_platinum']);
function circuitIcon(level: string | null): string {
  return PREMIER_LEVELS.has((level ?? '').toLowerCase())
    ? `${ICON_BASE}/branding/premier-padel-star.png`
    : `${ICON_BASE}/branding/fip-tour-icon.png`;
}
function surname(name: string): string {
  const t = name.trim().split(/\s+/);
  // noUncheckedIndexedAccess: t is always non-empty (split on a string always yields ≥1 element).
  // Use length > 0 guard + non-null assertion to satisfy tsc without altering behaviour.
  return (t.length > 0 ? t[t.length - 1]! : name) || name;
}

export type ProjCategory = 'men' | 'women';
export interface ActiveTournament { id: string; name: string; level: string | null }
export interface ProjectionPairRow {
  tournament_id: string;
  category: ProjCategory;
  pair_key: string;
  pair_player_ids: string[];
  champion_prob: number;
}
export interface PlayerLite { id: string; name: string; avatar_url: string | null }
export interface Candidate { tournamentId: string; category: ProjCategory }

/** (tournament,category) that have projection rows, are active, and unclaimed. */
export function selectProjectionCandidates(
  active: ActiveTournament[],
  pairs: ProjectionPairRow[],
  claimed: Set<string>,
): Candidate[] {
  const activeIds = new Set(active.map((t) => t.id));
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const p of pairs) {
    if (!activeIds.has(p.tournament_id)) continue;
    const key = `${p.tournament_id}:${p.category}`;
    if (claimed.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ tournamentId: p.tournament_id, category: p.category });
  }
  return out;
}

/** Ordered NotifyEventPayloads for one claimed (tournament,category). */
export function buildProjectionPayloads(
  candidate: Candidate,
  tournament: ActiveTournament,
  allPairs: ProjectionPairRow[],
  playersById: Record<string, PlayerLite>,
): NotifyEventPayload[] {
  const pairs = allPairs
    .filter((p) => p.tournament_id === candidate.tournamentId && p.category === candidate.category)
    .sort((a, b) => b.champion_prob - a.champion_prob);

  const dedupeKey = `projection_ready:tournament:${candidate.tournamentId}`;
  const title = `Predictions for ${tournament.name} are ready`;
  const out: NotifyEventPayload[] = [];

  for (const pair of pairs) {
    const slugPlayers = pair.pair_player_ids.map((id) => ({ id, name: playersById[id]?.name ?? id }));
    const slug = pairSlugFromNames(slugPlayers);
    const label = slugPlayers.map((p) => surname(p.name)).join(' / ');
    const body = `See ${label}'s road to the title →`;
    const url = `/tournaments/${candidate.tournamentId}/projection/${slug}`;
    for (const id of pair.pair_player_ids) {
      const player = playersById[id];
      out.push({
        category: 'projection_ready',
        entityType: 'player',
        entityId: id,
        title,
        body,
        url,
        icon: player?.avatar_url ?? circuitIcon(tournament.level),
        metadata: { tournament_id: candidate.tournamentId, category: candidate.category, pair_key: pair.pair_key, player_id: id },
        dedupeKey,
      });
    }
  }
  return out;
}
