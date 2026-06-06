// tournament-projection-snapshot — hourly worker computing per-pair tournament
// projections for the Road to Trophy / Projection feature.
// See docs/superpowers/specs/2026-06-06-road-to-trophy-projection-design.md.

import { fipPriorElo } from '../lib/elo-model.js';
import {
  type FrontierEntrant,
  type ProjRound,
} from '../lib/bracket-projection.js';

export interface FrontierMatchRow {
  id: string;
  widget_id_composite: string | null;
  draw_position: number | null;
  status: string | null;
  winner_pair: number | null;
  pair1_player1_id: string | null;
  pair1_player2_id: string | null;
  pair2_player1_id: string | null;
  pair2_player2_id: string | null;
  pair1_seed: number | null;
  pair2_seed: number | null;
}

export interface PlayerLite { id: string; name: string | null; ranking: number | null }

/** Order-independent pair key, mirrors bracket-builder.pairKeyFor. */
export function pairKeyFor(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function widgetHeapNumber(w: string | null): number | null {
  if (!w) return null;
  const hit = /[MW]D(\d+)$/.exec(w);
  if (!hit) return null;
  const n = parseInt(hit[1], 10);
  return Number.isFinite(n) ? n : null;
}

function teamElo(
  a: string, b: string,
  elo: Map<string, number>,
  players: Map<string, PlayerLite>,
): number {
  const ea = elo.get(a) ?? fipPriorElo(players.get(a)?.ranking ?? null);
  const eb = elo.get(b) ?? fipPriorElo(players.get(b)?.ranking ?? null);
  return (ea + eb) / 2;
}

/**
 * Build the bracket-ordered frontier entrant array for one round.
 * - Orders matches by widget heap number (Premier/Crionet draws), then
 *   draw_position, then id — same stable signal as bracket-builder.
 * - Each unfinished match expands to its two competitor pairs [pair1, pair2].
 * - Each FINISHED match expands to [winnerPair, null] so the engine advances
 *   the winner unopposed (bye), respecting results without re-simulating them.
 * - Pads to the next power of two with nulls.
 */
export function buildFrontierEntrants(
  rows: FrontierMatchRow[],
  _frontierRound: ProjRound,
  elo: Map<string, number>,
  players: Map<string, PlayerLite>,
): (FrontierEntrant | null)[] {
  const ordered = [...rows].sort((a, b) => {
    const ha = widgetHeapNumber(a.widget_id_composite);
    const hb = widgetHeapNumber(b.widget_id_composite);
    if (ha != null && hb != null && ha !== hb) return ha - hb;
    if (ha != null && hb == null) return -1;
    if (ha == null && hb != null) return 1;
    const da = a.draw_position, db = b.draw_position;
    if (typeof da === 'number' && typeof db === 'number' && da !== db) return da - db;
    if (typeof da === 'number') return -1;
    if (typeof db === 'number') return 1;
    return a.id.localeCompare(b.id);
  });

  const slots: (FrontierEntrant | null)[] = [];
  const mkEntrant = (p1: string, p2: string): FrontierEntrant => ({
    pairKey: pairKeyFor(p1, p2),
    playerIds: (p1 < p2 ? [p1, p2] : [p2, p1]) as [string, string],
    teamElo: teamElo(p1, p2, elo, players),
  });

  for (const m of ordered) {
    const hasP1 = m.pair1_player1_id && m.pair1_player2_id;
    const hasP2 = m.pair2_player1_id && m.pair2_player2_id;
    const finished = m.status === 'finished' && (m.winner_pair === 1 || m.winner_pair === 2);
    if (finished) {
      const win = m.winner_pair === 1
        ? (hasP1 ? mkEntrant(m.pair1_player1_id!, m.pair1_player2_id!) : null)
        : (hasP2 ? mkEntrant(m.pair2_player1_id!, m.pair2_player2_id!) : null);
      slots.push(win, null);
    } else {
      slots.push(
        hasP1 ? mkEntrant(m.pair1_player1_id!, m.pair1_player2_id!) : null,
        hasP2 ? mkEntrant(m.pair2_player1_id!, m.pair2_player2_id!) : null,
      );
    }
  }

  let size = 1;
  while (size < slots.length) size *= 2;
  while (slots.length < size) slots.push(null);
  return slots;
}
