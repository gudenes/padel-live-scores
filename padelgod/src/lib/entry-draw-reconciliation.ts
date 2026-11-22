import { strictPlayerLookup, type IdentityPlayer } from './strict-player-resolver.js';

export interface EntryForDraw {
  category: string;
  draw_type: string;
  seed: number | null;
  marker: string | null;
  player1_id: string | null;
  player2_id: string | null;
  player1_name: string | null;
  player2_name: string | null;
}

export interface EntryDrawSnapshot {
  scrape_job_id: string;
  captured_at: string;
  match_widget_id: string | null;
  round_label: string | null;
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
  team1_seed: number | null;
  team2_seed: number | null;
}

/** The published main draw owns participation and competitive seeds. Keep the
 * entry PDF as the pre-draw fallback, and retain it unchanged on incomplete or
 * ambiguous evidence. Never infer withdrawals from qualifying/later rounds.
 * Callers must scope snapshots to one category, main_draw, fip_event_page.
 */
export function reconcileMainDrawEntries<T extends EntryForDraw>(
  entries: T[], snapshots: EntryDrawSnapshot[],
): { entries: T[]; applied: boolean; reason: string } {
  const fallback = (reason: string) => ({ entries, applied: false, reason });
  if (!snapshots.length) return fallback('no_main_draw');
  // Use one complete capture, never a union of old and new bracket versions.
  const newest = snapshots.reduce((a, b) => a.captured_at > b.captured_at ? a : b);
  const batch = snapshots.filter(r => r.scrape_job_id === newest.scrape_job_id);
  const sizeOf = (round: string | null) => {
    const match = /^(?:R|Round (?:of )?)(128|64|32|16)$/i.exec(round ?? '');
    return match ? Number(match[1]) : ({ QF: 8, SF: 4, F: 2 }[round ?? ''] ?? 0);
  };
  const size = Math.max(...batch.map(r => sizeOf(r.round_label)));
  // A later-round-only capture cannot prove who originally participated.
  if (size < 16 || size < entries.filter(e => e.draw_type === 'main_draw').length) {
    return fallback('no_opening_round');
  }
  const first = batch.filter(r => sizeOf(r.round_label) === size);
  if (first.length !== size / 2 || first.some(r => !r.match_widget_id) ||
      new Set(first.map(r => r.match_widget_id)).size !== first.length) {
    return fallback('incomplete_opening_round');
  }
  const identities: IdentityPlayer[] = entries.flatMap(e => [1, 2].flatMap(slot => {
    const id = slot === 1 ? e.player1_id : e.player2_id;
    const name = slot === 1 ? e.player1_name : e.player2_name;
    return id && name ? [{ id, name, category: e.category, country: null }] : [];
  }));
  const pairKey = (a: string, b: string) => [a, b].sort().join(':');
  const main: T[] = [];
  const seen = new Set<string>();
  for (const row of first) {
    for (const side of [1, 2] as const) {
      const n1 = side === 1 ? row.team1_player1_name : row.team2_player1_name;
      const n2 = side === 1 ? row.team1_player2_name : row.team2_player2_name;
      if (!n1 && !n2) continue; // BYE or an unnamed qualifier slot
      if (!n1 || !n2) return fallback('partial_team');
      const p1 = strictPlayerLookup({ name: n1 }, identities);
      const p2 = strictPlayerLookup({ name: n2 }, identities);
      if (!p1.found || !p2.found || p1.playerId === p2.playerId) return fallback('unresolved_team');
      const key = pairKey(p1.playerId, p2.playerId);
      const candidates = entries.filter(e => e.player1_id && e.player2_id &&
        pairKey(e.player1_id, e.player2_id) === key);
      if (candidates.length !== 1 || seen.has(key)) return fallback('ambiguous_team');
      seen.add(key);
      const entry = candidates[0]!;
      main.push({ ...entry, draw_type: 'main_draw',
        seed: side === 1 ? row.team1_seed : row.team2_seed,
        marker: entry.draw_type === 'qualifying' ? 'Q' : entry.marker });
    }
  }
  if (main.length < size / 2) return fallback('incomplete_field');
  // A promoted qualifier is represented once in the current field.
  const qualifying = entries.filter(e => e.draw_type !== 'main_draw' &&
    !(e.player1_id && e.player2_id && seen.has(pairKey(e.player1_id, e.player2_id))));
  return { entries: [...main, ...qualifying], applied: true, reason: 'published_main_draw' };
}
