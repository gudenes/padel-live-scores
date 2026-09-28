/**
 * Shapes served by the padeldev live-score feed behind FIP's `Live Score` tab
 * (widget: https://ws.padeldev.com/live/fip/tournament.html?key=<uuid>).
 *
 * Both levels come from the same unauthenticated AWS Lambda origin:
 *   tournament : ?id=<key uuid>.json
 *   match      : ?id=<6-char id>.json   (the `url` on each tournament entry)
 *
 * Captured 2026-09-23 from FIP Platinum Lyon 2026.
 */

/** One match entry inside the tournament feed's day → court buckets. */
export interface PadeldevTournamentMatch {
  /** Absolute URL of the per-match feed; the `id=` query param is the match id. */
  url: string;
  idlocal: number;
  idwatch: number;
  /** e.g. "Women - Round of 32", "Men Q1" — gender is the leading token. */
  category: string;
  /** "YYYYMMDDHHmmssSSS" in the tournament's timezone. */
  scheduled: string;
  playername1: string;
  nationality1: string;
  playername2: string;
  nationality2: string;
  playername3: string;
  nationality3: string;
  playername4: string;
  nationality4: string;
  isfinished: number;
  winningteam: number;
  retiredteam: number;
  /** See padeldev-score.ts for the grammar. */
  score: string;
}

/**
 * GET ?id=<key>.json — the whole event.
 *
 * `tournament` mixes fixed metadata keys with dynamic "YYYYMMDD" day keys, each
 * mapping court name → matches. Callers must pick out the numeric-looking keys.
 */
export interface PadeldevTournamentFeed {
  tournament: {
    name?: string;
    timezone?: string;
    startdatetime?: string;
    enddatetime?: string;
    [dayOrMeta: string]:
      | string
      | Record<string, PadeldevTournamentMatch[]>
      | undefined;
  };
}

/** The `score` object on the per-match feed. */
export interface PadeldevMatchScore {
  /** 1 | 2 while a point is in play, 0 when undetermined. */
  teamserving: number;
  /** 1..4 — the individual server, indexed like `playername1..4`. */
  playerserving: number;
  winningteam: number;
  retiredteam: number;
  /** See padeldev-score.ts for the grammar. */
  value: string;
  /**
   * Golden-point flag. Named from the field only — not yet observed non-zero in
   * a live payload, so consumers must degrade safely if it means something else.
   */
  starpoint: number;
  extratop: string | null;
  extrabottom: string | null;
}

/** GET ?id=<6-char>.json — per-match live state. */
export interface PadeldevMatchFeed {
  id_match: number;
  /** Uppercase 6-char vendor id, e.g. "VCFQRI". */
  idmatch: string;
  playername1: string;
  playername2: string;
  playername3: string;
  playername4: string;
  idplayer1?: number;
  idplayer2?: number;
  idplayer3?: number;
  idplayer4?: number;
  isfinished: number;
  winningteam: number;
  retiredteam: number;
  court: string;
  /** "YYYYMMDDHHmmssSSS" — changes only when the match state actually moves. */
  lastupdate: number;
  scheduleddatetime?: number;
  score: PadeldevMatchScore;
  /**
   * Present but NOT consumed: semantics undecoded, and the vendor's own
   * tournament widget never reads it. See the v1 design spec.
   */
  points?: unknown;
  /** Per-set shot-outcome stats. Deferred to a follow-up — see the design spec. */
  stats?: unknown;
}

/** A match selected from the tournament feed, with its court/day context. */
export interface PadeldevCandidateEntry {
  /** The `id=` value, e.g. "vcfqri.json". */
  matchRef: string;
  court: string;
  day: string;
  entry: PadeldevTournamentMatch;
}
