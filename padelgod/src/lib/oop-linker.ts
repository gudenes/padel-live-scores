// padelgod/src/lib/oop-linker.ts
//
// Match padelgod OOP snapshots to public.matches rows via player-name
// overlap + (round, court) filters. Produces a list of
// `entity_external_ids` rows to insert so the ops Tournament Explorer
// and cross-source reconcilers can resolve the Crionet composite
// `{tournamentWidgetId}:{matchWidgetId}` → real match UUID.
//
// Why this exists separately from match-identifier:
// match-identifier.findOrCreateMatch takes player UUIDs and is called
// from the live-poller when a match is observed on the Crionet widget.
// For OOP-only matches that padelgod never saw live (finals wrapped up
// before a poll tick, live-poller inactive during the window, etc.),
// no entity_external_ids row ever gets written — the ops page shows
// those rows as "Unlinked" forever.
//
// The static-reconciler has a player-UUID path too, but it needs the
// entry list to resolve OOP names → fip_ids → player UUIDs. Crionet
// returns "coming soon" for Premier tournaments, so the reconciler
// skips them — and we can't rely on it here either.
//
// This module takes a different approach: compare OOP's player-name
// strings directly against public.matches' joined player names. Pair-
// level name overlap with a (round, court) filter is usually enough to
// pick the right row unambiguously. When it's ambiguous (two matches
// on the same court / same round / similar names), we skip silently —
// better to leave unlinked than link wrong.
//
// Pure function module — no DB access inside `linkOopSnapshotsToPublicMatches`.
// Callers fetch public.matches rows separately and pass them in so
// testing is trivial (`oop-linker.test.ts`).

import type { ParsedOopMatch } from '../parsers/crionet-oop.js';

/**
 * A public.matches row enriched with player name joins. Shape mirrors
 * what Supabase returns for:
 *   .select('id, round, court, category, pair1_player1:players(name), …')
 */
export interface PublicMatchCandidate {
  id: string;
  round: string | null;
  court: string | null;
  category: 'men' | 'women' | null;
  pair1Player1Name: string | null;
  pair1Player2Name: string | null;
  pair2Player1Name: string | null;
  pair2Player2Name: string | null;
}

/** A linkage we propose to write: crionet widget external id → match UUID. */
export interface OopLinkage {
  /** The OOP parsed match this linkage is for — returned for caller logging. */
  matchWidgetId: string;
  /** `{tournamentWidgetId}:{matchWidgetId}` — the external_id column value. */
  compositeExternalId: string;
  /** public.matches UUID we matched this OOP row to. */
  matchId: string;
}

export interface LinkingOptions {
  /** Minimum number of player names (out of 4) that must overlap between the
   * OOP match and a public.matches candidate for a link to be considered.
   * Default 3 (3/4 surnames) — catches cases where one OOP name has a typo
   * or a nickname while avoiding false positives from same-tournament
   * common surnames. Use 4 for stricter matching. */
  minNameOverlap?: number;
  /** When two candidates tie on overlap score, skip linking. Default true —
   * "linked wrong" is worse than "not linked" for our use case. Set to
   * false only in tests where you explicitly want tie-break behaviour. */
  skipOnTie?: boolean;
}

/**
 * Build a list of `entity_external_ids` rows to insert, linking OOP parsed
 * matches to public.matches UUIDs via player-name overlap.
 *
 * Skips matches where:
 *   - matchWidgetId is missing (no composite to write)
 *   - fewer than minNameOverlap OOP player names are present
 *   - no public-match candidate meets the overlap threshold
 *   - multiple candidates tie on score (when skipOnTie=true)
 *
 * The overlap score is the number of OOP player LAST-NAMES that match
 * any of the public match's 4 player last names (case-insensitive,
 * whitespace-normalized). Last-name-only because OOP uses short-form
 * "M. Gonzalez Gallego" while public.matches can store longer variants.
 *
 * Matches are also filtered by round (canonicalized so "Quarterfinals"
 * == "Quarter") and category before scoring. Court is used only as a
 * tiebreaker when two candidates share the same score.
 */
export function linkOopSnapshotsToPublicMatches(
  parsed: ParsedOopMatch[],
  publicMatches: PublicMatchCandidate[],
  tournamentWidgetId: string,
  opts: LinkingOptions = {},
): OopLinkage[] {
  const minNameOverlap = opts.minNameOverlap ?? 3;
  const skipOnTie = opts.skipOnTie ?? true;

  // Index publicMatches by (canonical round, category) for fast filtering.
  // Key: "<canonicalRound>::<category>" → candidates
  const byRoundCat = new Map<string, PublicMatchCandidate[]>();
  for (const pm of publicMatches) {
    if (!pm.round || !pm.category) continue;
    const key = `${canonicalRound(pm.round)}::${pm.category}`;
    const arr = byRoundCat.get(key) ?? [];
    arr.push(pm);
    byRoundCat.set(key, arr);
  }

  const linkages: OopLinkage[] = [];
  // Track which public matches have already been claimed — don't link two
  // OOP widget ids to the same public match row.
  const claimedMatchIds = new Set<string>();

  for (const oop of parsed) {
    if (!oop.matchWidgetId) continue;
    const oopPlayers = playerTokensFromOopRow(oop);
    if (oopPlayers.filter((p) => p.length > 0).length < minNameOverlap) continue;

    if (!oop.roundLabel) continue;
    const roundCatKey = `${canonicalRound(oop.roundLabel)}::${oop.category}`;
    const candidates = byRoundCat.get(roundCatKey) ?? [];
    if (candidates.length === 0) continue;

    // Score each candidate by bipartite player matching; keep the top score(s).
    let bestScore = 0;
    let bestCandidates: PublicMatchCandidate[] = [];
    for (const pm of candidates) {
      if (claimedMatchIds.has(pm.id)) continue;
      const pmPlayers = playerTokensFromPublicMatch(pm);
      const overlap = countMatchedPlayers(oopPlayers, pmPlayers);
      if (overlap < minNameOverlap) continue;
      if (overlap > bestScore) {
        bestScore = overlap;
        bestCandidates = [pm];
      } else if (overlap === bestScore) {
        bestCandidates.push(pm);
      }
    }

    if (bestCandidates.length === 0) continue;

    // Tie-break by court match when possible.
    if (bestCandidates.length > 1 && oop.court) {
      const courtMatches = bestCandidates.filter(
        (c) => c.court && normalizeCourt(c.court) === normalizeCourt(oop.court),
      );
      if (courtMatches.length === 1) {
        bestCandidates = courtMatches;
      }
    }

    if (bestCandidates.length > 1 && skipOnTie) continue;

    const winner = bestCandidates[0]!;
    claimedMatchIds.add(winner.id);
    linkages.push({
      matchWidgetId: oop.matchWidgetId,
      compositeExternalId: `${tournamentWidgetId}:${oop.matchWidgetId}`,
      matchId: winner.id,
    });
  }

  return linkages;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Normalize a round label so "Quarterfinals" matches "Quarter",
 * "Semifinals" matches "Semi", etc. Same canonicalizer as
 * `src/app/api/ops/tournament-matches/route.ts` — keep in sync if you
 * add aliases. Lower-cased + trimmed so case variants match too.
 */
function canonicalRound(r: string): string {
  const s = r.toLowerCase().trim();
  if (s === 'quarterfinals' || s === 'quarter' || s === 'quarterfinal') return 'quarter';
  if (s === 'semifinals' || s === 'semi' || s === 'semifinal') return 'semi';
  if (s === 'finals' || s === 'final') return 'final';
  return s;
}

/**
 * Tokenize a player display name into lowercase "surname tokens": strip
 * single-letter initials ("M.", "J.") and return the remaining word list.
 *
 * OOP emits short-form names like "M. Gonzalez Gallego" → ["gonzalez",
 * "gallego"]. Public.matches stores long-form names like
 * "Marta Ortega Gallego" → ["marta", "ortega", "gallego"].
 *
 * We use these token lists for bipartite player matching (see
 * countMatchedPlayers below): an OOP player matches a public player
 * when every OOP token is also present in the public token list. That
 * rule correctly handles:
 *   - initial drift ("M." vs "Marta" — tokens still align on the
 *     shared surnames)
 *   - single-surname players ("M. Jensen" vs "Claudia Jensen")
 *   - compound surnames ("M. Calvo" vs "Martina Calvo Santamaria" —
 *     OOP tokens {calvo} are a subset of public {martina, calvo,
 *     santamaria})
 *   - reversed order ("Ortega M." would tokenize the same way)
 *
 * Non-ASCII + accents are preserved (toLowerCase keeps diacritics so
 * "Muñoz" doesn't collide with "Munoz" — if that becomes an issue we
 * can strip accents via normalize('NFD'), but for now exact-match is
 * fine since both sides come from the same Crionet pipeline and agree
 * on the codepoints).
 */
export function extractSurnameTokens(displayName: string): string[] {
  const trimmed = displayName.trim();
  if (trimmed.length === 0) return [];
  const cleaned = trimmed.replace(/[^\p{L}\p{M}\s.-]/gu, '').trim();
  const parts = cleaned.split(/\s+/);
  return parts
    .filter((p) => !/^\p{L}\.?$/u.test(p)) // drop initials like "M." or "M"
    .map((p) => p.toLowerCase());
}

function playerTokensFromOopRow(o: ParsedOopMatch): string[][] {
  return [
    o.team1Player1Name,
    o.team1Player2Name,
    o.team2Player1Name,
    o.team2Player2Name,
  ].map((n) => (n ? extractSurnameTokens(n) : []));
}

function playerTokensFromPublicMatch(m: PublicMatchCandidate): string[][] {
  return [
    m.pair1Player1Name,
    m.pair1Player2Name,
    m.pair2Player1Name,
    m.pair2Player2Name,
  ].map((n) => (n ? extractSurnameTokens(n) : []));
}

/**
 * Count how many OOP players can be uniquely matched to public players
 * (bipartite, greedy). An OOP player matches a public player iff every
 * one of the OOP player's surname tokens is present in the public
 * player's surname tokens. Each public player is claimed by at most
 * one OOP player — prevents double-counting when two OOP names share
 * a surname (e.g. two siblings on the same team).
 *
 * Returns 0..4. Callers compare this against `minNameOverlap` (default
 * 3) to decide whether to link.
 */
function countMatchedPlayers(
  oopPlayers: string[][],
  publicPlayers: string[][],
): number {
  const claimed = new Set<number>();
  let matched = 0;
  for (const ot of oopPlayers) {
    if (ot.length === 0) continue;
    for (let i = 0; i < publicPlayers.length; i++) {
      if (claimed.has(i)) continue;
      const pt = publicPlayers[i]!;
      if (pt.length === 0) continue;
      if (ot.every((t) => pt.includes(t))) {
        claimed.add(i);
        matched++;
        break;
      }
    }
  }
  return matched;
}

function normalizeCourt(c: string): string {
  return c.toLowerCase().trim().replace(/\s+/g, ' ');
}
