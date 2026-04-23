// padelgod/src/lib/draw-linker.ts
//
// Match FIP draw snapshots to public.matches rows via player-name overlap,
// filtered by round + category. Produces a list of `entity_external_ids`
// rows to insert so the ops Tournament Explorer and cross-source
// reconcilers can resolve the Crionet composite
// `{tournamentWidgetId}:{matchWidgetId}` → real match UUID.
//
// Why this exists (separate from oop-linker)
// ------------------------------------------
// `oop-linker` matches OOP snapshots against public.matches. It works for
// matches that Crionet's Order of Play widget has scheduled with player
// names visible. It FAILS for:
//
//   1. TBD placeholders — matches like "Winner of R16 match A vs Winner
//      of R16 match B" where Crionet shows no player names until the
//      feeding matches finish. Brussels P2 2026 had 5 QFs in this state
//      for ~72h.
//   2. Qualifier slots that Crionet never schedules in OOP before they
//      start (WQ011 at Brussels — no OOP entry, no widget link, but the
//      match was finished and stored in public.matches via padelapi).
//
// The FIP event page's AJAX draw endpoint surfaces EVERY bracket slot
// with real player names as soon as the seeding is published — before
// Crionet schedules anything. So this linker can catch both cases.
//
// Structurally similar to `oop-linker` (same bipartite matching, same
// round canonicalizer), but the input rows are sparser: no court info,
// no scheduled_label, just widget id + 4 player names + round + teams'
// fip ids + (for completed matches) winner and set scores.
//
// Pure function module — no DB access. Callers fetch public.matches
// rows separately and pass them in so testing is trivial.

/**
 * A draw-snapshot row from `padelgod.draw_snapshots` where
 * source='fip_event_page'. Shape is the worker's projection of the
 * underlying DB row (NOT the parser's `ParsedFipDrawMatch`) — the parser
 * output is normalized into storage columns and this interface reflects
 * what the linker reads from Supabase.
 */
export interface DrawSnapshotCandidate {
  matchWidgetId: string;
  category: 'men' | 'women';
  roundLabel: string;
  team1Player1Name: string | null;
  team1Player2Name: string | null;
  team2Player1Name: string | null;
  team2Player2Name: string | null;
  /** FIP pair identifier, e.g. "P000456". Non-null for real teams; null
   *  (or starts with a digit) for Bye placeholders. */
  team1FipId: string | null;
  team2FipId: string | null;
  /** Status as stored by the fetcher — 'scheduled' for not-yet-played
   *  matches, 'walkover' for Bye rows. Linker only acts on rows where
   *  both teams are real. */
  status: 'scheduled' | 'live' | 'finished' | 'walkover' | 'retired';
}

/**
 * A public.matches row enriched with player name joins. Same shape as
 * `PublicMatchCandidate` in oop-linker.ts — kept as a local definition
 * so the two linker modules are decoupled and can evolve independently.
 */
export interface PublicMatchCandidate {
  id: string;
  round: string | null;
  category: 'men' | 'women' | null;
  pair1Player1Name: string | null;
  pair1Player2Name: string | null;
  pair2Player1Name: string | null;
  pair2Player2Name: string | null;
}

/** A linkage we propose to write: crionet widget composite external id → match UUID. */
export interface DrawLinkage {
  matchWidgetId: string;
  compositeExternalId: string;
  matchId: string;
}

export interface DrawLinkingOptions {
  /** Minimum number of draw-side player surnames (out of 4) that must
   *  overlap with a public match candidate for the linker to consider
   *  it. Default 3 — same as oop-linker. Increase for stricter matching. */
  minNameOverlap?: number;
  /** When two candidates tie on overlap score, skip linking. Default
   *  true — "linked wrong" is worse than "not linked". */
  skipOnTie?: boolean;
}

/**
 * Build a list of `entity_external_ids` rows to insert. Skips draw rows
 * that can't be matched unambiguously and rows that represent Bye slots
 * (either team missing an FIP id or status='walkover' with one real team).
 *
 * Callers should filter out draw rows whose widget id already has an
 * `entity_external_ids` row — the linker doesn't do that dedup itself
 * (the caller has already loaded the existing linkages and can filter
 * more efficiently there).
 */
export function linkDrawSnapshotsToPublicMatches(
  parsed: DrawSnapshotCandidate[],
  publicMatches: PublicMatchCandidate[],
  tournamentWidgetId: string,
  opts: DrawLinkingOptions = {},
): DrawLinkage[] {
  const minNameOverlap = opts.minNameOverlap ?? 3;
  const skipOnTie = opts.skipOnTie ?? true;

  // Index publicMatches by (canonical round, category) for fast filtering.
  const byRoundCat = new Map<string, PublicMatchCandidate[]>();
  for (const pm of publicMatches) {
    if (!pm.round || !pm.category) continue;
    const key = `${canonicalRound(pm.round)}::${pm.category}`;
    const arr = byRoundCat.get(key) ?? [];
    arr.push(pm);
    byRoundCat.set(key, arr);
  }

  const linkages: DrawLinkage[] = [];
  const claimedMatchIds = new Set<string>();

  for (const draw of parsed) {
    if (!draw.matchWidgetId) continue;

    // Skip Bye rows. In FIP event pages a Bye is represented either by
    // `status='walkover'` (Bye vs real team) or both teams' fip ids being
    // null/numeric placeholder ids. Either way there's no public.matches
    // counterpart to link to, because padelapi never surfaces a Bye match.
    if (draw.status === 'walkover') continue;
    if (!isPFipTeamId(draw.team1FipId) || !isPFipTeamId(draw.team2FipId)) continue;

    const drawPlayerTokens = playerTokensFromDrawRow(draw);
    const realNames = drawPlayerTokens.filter((p) => p.length > 0).length;
    if (realNames < minNameOverlap) continue;

    const roundCatKey = `${canonicalRound(draw.roundLabel)}::${draw.category}`;
    const candidates = byRoundCat.get(roundCatKey) ?? [];
    if (candidates.length === 0) continue;

    // Score each candidate by bipartite player name matching.
    let bestScore = 0;
    let bestCandidates: PublicMatchCandidate[] = [];
    for (const pm of candidates) {
      if (claimedMatchIds.has(pm.id)) continue;
      const pmTokens = playerTokensFromPublicMatch(pm);
      const overlap = countMatchedPlayers(drawPlayerTokens, pmTokens);
      if (overlap < minNameOverlap) continue;
      if (overlap > bestScore) {
        bestScore = overlap;
        bestCandidates = [pm];
      } else if (overlap === bestScore) {
        bestCandidates.push(pm);
      }
    }

    if (bestCandidates.length === 0) continue;
    if (bestCandidates.length > 1 && skipOnTie) continue;

    const winner = bestCandidates[0]!;
    claimedMatchIds.add(winner.id);
    linkages.push({
      matchWidgetId: draw.matchWidgetId,
      compositeExternalId: `${tournamentWidgetId}:${draw.matchWidgetId}`,
      matchId: winner.id,
    });
  }

  return linkages;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * FIP team ids are strings like "P000456". Bye slots carry numeric-only
 * ids that happen to fit in the same column. Treat anything starting with
 * "P" (case-insensitive) followed by digits as real; everything else is a
 * placeholder. Null is non-real.
 */
function isPFipTeamId(id: string | null): boolean {
  if (id == null) return false;
  return /^P\d+$/i.test(id);
}

/**
 * Same round canonicalizer as oop-linker — keep the two in sync if you
 * add aliases. Duplicated rather than imported so each linker module
 * stays independently editable.
 */
function canonicalRound(r: string): string {
  const s = r.toLowerCase().trim();
  if (s === 'quarterfinals' || s === 'quarter' || s === 'quarterfinal' || s === 'qf')
    return 'quarter';
  if (s === 'semifinals' || s === 'semi' || s === 'semifinal' || s === 'sf')
    return 'semi';
  if (s === 'finals' || s === 'final' || s === 'f') return 'final';
  // R32 / R16 pass through as-is; they match between FIP's round labels
  // and public.matches' padelapi-sourced labels.
  return s;
}

/**
 * Tokenize a player display name into lowercase surname tokens. Same
 * implementation as oop-linker.extractSurnameTokens — keep in sync.
 *
 * Strips single-letter initials ("M.", "J.") so "M. Ortega" and
 * "Marta Ortega" both tokenize to ["ortega"].
 */
export function extractSurnameTokens(displayName: string): string[] {
  const trimmed = displayName.trim();
  if (trimmed.length === 0) return [];
  const cleaned = trimmed.replace(/[^\p{L}\p{M}\s.-]/gu, '').trim();
  const parts = cleaned.split(/\s+/);
  return parts
    .filter((p) => !/^\p{L}\.?$/u.test(p))
    .map((p) => p.toLowerCase());
}

function playerTokensFromDrawRow(d: DrawSnapshotCandidate): string[][] {
  return [
    d.team1Player1Name,
    d.team1Player2Name,
    d.team2Player1Name,
    d.team2Player2Name,
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
 * Bipartite greedy matcher: count how many draw-side players can be
 * uniquely matched to a public-side player.
 *
 * Unlike oop-linker which uses a unidirectional rule (every OOP token
 * must appear on the public side — works because OOP always emits
 * SHORT-form names like "M. Gonzalez"), draw-linker uses a SYMMETRIC
 * subset rule: a pair matches iff the shorter token list is a subset
 * of the longer one.
 *
 * This is because FIP draws can emit EITHER form:
 *   - Long form:  "Camila Fassio Goyeneche" (3 tokens after initial strip)
 *   - Short form: "C. Fassio Goyeneche"     (2 tokens, C. stripped)
 * And public.matches (populated by padelapi sync) can ALSO emit either.
 * Requiring a specific direction would miss half the real-world pairings.
 *
 * Returns 0..4. Callers compare against `minNameOverlap`.
 */
function countMatchedPlayers(
  drawPlayers: string[][],
  publicPlayers: string[][],
): number {
  const claimed = new Set<number>();
  let matched = 0;
  for (const dt of drawPlayers) {
    if (dt.length === 0) continue;
    for (let i = 0; i < publicPlayers.length; i++) {
      if (claimed.has(i)) continue;
      const pt = publicPlayers[i]!;
      if (pt.length === 0) continue;
      // Symmetric subset rule: shorter side must be fully contained in
      // the longer side. This handles "M. Ortega" vs "Marta Ortega"
      // both ways without over-matching unrelated names.
      const [shorter, longer] = dt.length <= pt.length ? [dt, pt] : [pt, dt];
      if (shorter.every((t) => longer.includes(t))) {
        claimed.add(i);
        matched++;
        break;
      }
    }
  }
  return matched;
}
