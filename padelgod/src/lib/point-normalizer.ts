// Canonical point shape for comparing padelapi-sourced and padelgod-sourced points.
// Aligned with Task 11's PointState in live-state.ts, but includes parsers for both
// input formats.

export type CanonicalPoint =
  | { kind: 'regular'; team1: 0 | 15 | 30 | 40; team2: 0 | 15 | 30 | 40 }
  | { kind: 'deuce' }
  | { kind: 'advantage'; side: 1 | 2 }
  | { kind: 'golden_point' }
  | { kind: 'tiebreak'; team1: number; team2: number };

export interface NormalizeOptions {
  insideTiebreak?: boolean;
}

// Padelapi relay writes game points as strings like "15:0", "AD:40", "40:AD", "40:40"
// (deuce), tiebreak as "7:5". Case-insensitive. Normalize to the shared shape.
export function normalizePadelapiPoint(
  raw: string,
  opts: NormalizeOptions = {}
): CanonicalPoint {
  const parts = raw.split(':');
  if (parts.length !== 2) throw new Error(`unparseable padelapi point: ${raw}`);
  const left = parts[0]!.trim().toUpperCase();
  const right = parts[1]!.trim().toUpperCase();

  if (opts.insideTiebreak) {
    const t1 = Number(left);
    const t2 = Number(right);
    if (!Number.isFinite(t1) || !Number.isFinite(t2)) {
      throw new Error(`unparseable tiebreak: ${raw}`);
    }
    return { kind: 'tiebreak', team1: t1, team2: t2 };
  }

  if (left === 'AD' && right === '40') return { kind: 'advantage', side: 1 };
  if (left === '40' && right === 'AD') return { kind: 'advantage', side: 2 };
  if (left === '40' && right === '40') return { kind: 'deuce' };
  if (left === 'GP' || right === 'GP') return { kind: 'golden_point' };

  const valid = [0, 15, 30, 40] as const;
  const t1 = Number(left);
  const t2 = Number(right);
  if (!(valid as readonly number[]).includes(t1) || !(valid as readonly number[]).includes(t2)) {
    throw new Error(`unparseable regular point: ${raw}`);
  }
  return {
    kind: 'regular',
    team1: t1 as 0 | 15 | 30 | 40,
    team2: t2 as 0 | 15 | 30 | 40,
  };
}

// Padelgod writes match_points.score_after in formats produced by live-state.ts'
// formatPointScore helper: "15-0", "Deuce", "AD-40", "40-AD", "GP", tiebreak "5-3".
export function normalizePadelgodPoint(
  raw: string,
  opts: NormalizeOptions = {}
): CanonicalPoint {
  const s = raw.trim();

  // Fixed-label states first
  if (s.toLowerCase() === 'deuce') return { kind: 'deuce' };
  if (s === 'GP') return { kind: 'golden_point' };
  if (s === 'AD-40') return { kind: 'advantage', side: 1 };
  if (s === '40-AD') return { kind: 'advantage', side: 2 };

  // Tiebreak: either explicitly requested, or the format looks like a tiebreak
  // score (at least one side > 40, or `insideTiebreak` hint).
  const m = s.match(/^(\d+)-(\d+)$/);
  if (m) {
    const t1 = Number(m[1]);
    const t2 = Number(m[2]);
    if (opts.insideTiebreak || t1 > 40 || t2 > 40) {
      return { kind: 'tiebreak', team1: t1, team2: t2 };
    }
    const valid = [0, 15, 30, 40] as const;
    if ((valid as readonly number[]).includes(t1) && (valid as readonly number[]).includes(t2)) {
      return {
        kind: 'regular',
        team1: t1 as 0 | 15 | 30 | 40,
        team2: t2 as 0 | 15 | 30 | 40,
      };
    }
  }

  throw new Error(`unparseable padelgod point: ${raw}`);
}

// Equality for canonical points. `deuce` and `golden_point` are equivalent — both
// represent the same in-game state (40-40, not yet resolved by an AD) under
// different tournament rules. Everything else is strict equality.
export function pointEq(a: CanonicalPoint, b: CanonicalPoint): boolean {
  const aDeuceLike = a.kind === 'deuce' || a.kind === 'golden_point';
  const bDeuceLike = b.kind === 'deuce' || b.kind === 'golden_point';
  if (aDeuceLike && bDeuceLike) return true;

  if (a.kind !== b.kind) return false;
  if (a.kind === 'advantage' && b.kind === 'advantage') return a.side === b.side;
  if (a.kind === 'regular' && b.kind === 'regular') {
    return a.team1 === b.team1 && a.team2 === b.team2;
  }
  if (a.kind === 'tiebreak' && b.kind === 'tiebreak') {
    return a.team1 === b.team1 && a.team2 === b.team2;
  }
  return false;
}
