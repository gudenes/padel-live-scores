// tournament-projection-snapshot — hourly worker computing per-pair tournament
// projections for the Road to Trophy / Projection feature.
// See docs/superpowers/specs/2026-06-06-road-to-trophy-projection-design.md.

import { fipPriorElo } from '../lib/elo-model.js';
import {
  type FrontierEntrant,
  type ProjRound,
} from '../lib/bracket-projection.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import {
  trainElo, MODEL_VERSION,
  type TrainingMatch, type PlayerSnapshot,
} from '../lib/elo-model.js';
import { projectPairs, PROJ_ROUND_ORDER, matchupKey } from '../lib/bracket-projection.js';
import { paginatedSelect } from '../lib/db-paginate.js';

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

/** Order-independent pair key ("smallerId::largerId"). Same convention the
 *  Next app's bracket-builder uses, kept local so this worker has no app dep. */
export function pairKeyFor(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function widgetHeapNumber(w: string | null): number | null {
  if (!w) return null;
  const hit = /[MW]D(\d+)$/.exec(w);
  if (!hit?.[1]) return null;
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

/** Like buildFrontierEntrants but keeps BOTH competitors of every match (the
 *  losers stay in the field) so projectPairs can report every pair, including
 *  eliminated ones. Used with a `decided` map that forces played results. */
export function buildFullFieldEntrants(
  rows: FrontierMatchRow[],
  elo: Map<string, number>,
  players: Map<string, PlayerLite>,
): (FrontierEntrant | null)[] {
  const ordered = [...rows].sort((a, b) => {
    const ha = widgetHeapNumber(a.widget_id_composite)
    const hb = widgetHeapNumber(b.widget_id_composite)
    if (ha != null && hb != null && ha !== hb) return ha - hb
    if (ha != null && hb == null) return -1
    if (ha == null && hb != null) return 1
    const da = a.draw_position, db = b.draw_position
    if (typeof da === 'number' && typeof db === 'number' && da !== db) return da - db
    if (typeof da === 'number') return -1
    if (typeof db === 'number') return 1
    return a.id.localeCompare(b.id)
  })
  const slots: (FrontierEntrant | null)[] = []
  const mk = (p1: string, p2: string): FrontierEntrant => ({
    pairKey: pairKeyFor(p1, p2),
    playerIds: (p1 < p2 ? [p1, p2] : [p2, p1]) as [string, string],
    teamElo: teamElo(p1, p2, elo, players),
  })
  for (const m of ordered) {
    const hasP1 = m.pair1_player1_id && m.pair1_player2_id
    const hasP2 = m.pair2_player1_id && m.pair2_player2_id
    slots.push(
      hasP1 ? mk(m.pair1_player1_id!, m.pair1_player2_id!) : null,
      hasP2 ? mk(m.pair2_player1_id!, m.pair2_player2_id!) : null,
    )
  }
  let size = 1
  while (size < slots.length) size *= 2
  while (slots.length < size) slots.push(null)
  return slots
}

const HALFLIFE_DAYS = 180;
const MC_RUNS = 20_000;

function canonRound(r: string | null | undefined): ProjRound | null {
  if (!r) return null;
  const x = r.toLowerCase();
  if (x.includes('round of 64') || x === 'r64') return 'R64';
  if (x.includes('round of 32') || x === 'r32') return 'R32';
  if (x.includes('round of 16') || x === 'r16') return 'R16';
  if (x === 'qf' || x.includes('quarter')) return 'QF';
  if (x === 'sf' || x.includes('semi')) return 'SF';
  if (x === 'f' || x.includes('final')) return 'F';
  return null;
}

function roundHasAssigned(m: FrontierMatchRow): boolean {
  return Boolean(
    (m.pair1_player1_id && m.pair1_player2_id) ||
    (m.pair2_player1_id && m.pair2_player2_id),
  );
}

/** Shallowest (first) main-draw round present with an assigned match. */
export function pickEntryRound(byRound: Map<ProjRound, FrontierMatchRow[]>): ProjRound | null {
  for (const r of PROJ_ROUND_ORDER) {
    if ((byRound.get(r) ?? []).some(roundHasAssigned)) return r
  }
  return null
}

export interface PairStatus { status: 'active' | 'eliminated' | 'champion'; eliminatedRound: string | null }

/** From all decided matches: each loser → eliminated@round; final winner → champion. */
export function deriveStatuses(
  rows: Array<FrontierMatchRow & { round: string | null; round_canonical: string | null }>,
): Map<string, PairStatus> {
  const out = new Map<string, PairStatus>()
  for (const m of rows) {
    const decided = m.winner_pair === 1 || m.winner_pair === 2
    if (!decided) continue
    const round = canonRound(m.round_canonical ?? m.round)
    if (!round) continue
    const p1 = m.pair1_player1_id && m.pair1_player2_id ? pairKeyFor(m.pair1_player1_id, m.pair1_player2_id) : null
    const p2 = m.pair2_player1_id && m.pair2_player2_id ? pairKeyFor(m.pair2_player1_id, m.pair2_player2_id) : null
    const winner = m.winner_pair === 1 ? p1 : p2
    const loser = m.winner_pair === 1 ? p2 : p1
    if (loser) out.set(loser, { status: 'eliminated', eliminatedRound: round })
    if (round === 'F' && winner) out.set(winner, { status: 'champion', eliminatedRound: null })
  }
  return out
}

/** Decided-matchups map for the engine: matchupKey(a,b) → winner pairKey. */
export function buildDecidedMap(
  rows: Array<FrontierMatchRow & { round: string | null; round_canonical: string | null }>,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of rows) {
    if (!(m.winner_pair === 1 || m.winner_pair === 2)) continue
    const p1 = m.pair1_player1_id && m.pair1_player2_id ? pairKeyFor(m.pair1_player1_id, m.pair1_player2_id) : null
    const p2 = m.pair2_player1_id && m.pair2_player2_id ? pairKeyFor(m.pair2_player1_id, m.pair2_player2_id) : null
    if (!p1 || !p2) continue
    out.set(matchupKey(p1, p2), m.winner_pair === 1 ? p1 : p2)
  }
  return out
}

export interface TournamentProjectionDeps {
  supabase: SupabaseClient;
  logger?: Logger;
  dryRun?: boolean;
  now?: () => Date;
}

export interface TournamentProjectionResult {
  processed: number;
  failed: number;
  rowsWritten: number;
  trainingSize: number;
  durationMs: number;
}

interface ScopeRow { id: string; level: string | null; starts_at: string | null }

export async function runTournamentProjectionSnapshot(
  deps: TournamentProjectionDeps,
): Promise<TournamentProjectionResult> {
  const { supabase, logger, dryRun = false, now = () => new Date() } = deps;
  const startMs = Date.now();
  const nowIso = now().toISOString();

  const playerRows = await paginatedSelect<PlayerSnapshot>(
    (s, e) => supabase.from('players').select('id, name, ranking, category').range(s, e),
    { what: 'players (tournament-projection-snapshot)' },
  );
  const players = new Map(playerRows.map((p) => [p.id, p]));

  const tournamentRows = await paginatedSelect<{ id: string; level: string | null }>(
    (s, e) => supabase.from('tournaments').select('id, level').range(s, e),
    { what: 'tournaments levels (tournament-projection-snapshot)' },
  );
  const tournamentLevels = new Map(tournamentRows.map((t) => [t.id, t.level ?? '']));

  // In-window tournaments, ALL tiers (admin QA needs lower tiers; the public
  // app filters to Premier via tournament_level at read time).
  const { data: scopeData } = await supabase
    .from('tournaments')
    .select('id, level, starts_at, ends_at')
    .gte('ends_at', nowIso)
    .order('starts_at', { ascending: true });
  const inScope = ((scopeData ?? []) as ScopeRow[]).filter((t) => t.starts_at);

  const training = await paginatedSelect<TrainingMatch>(
    (s, e) => supabase.from('matches').select(
      'id, tournament_id, finished_at, scheduled_at, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, winner_pair',
    ).eq('status', 'finished').not('winner_pair', 'is', null)
      .order('scheduled_at', { ascending: true }).range(s, e),
    { what: 'training matches (tournament-projection-snapshot)' },
  );

  const trainCache = new Map<string, ReturnType<typeof trainElo>>();
  let processed = 0, failed = 0, rowsWritten = 0;

  for (const t of inScope) {
    try {
      let train = trainCache.get(t.starts_at!);
      if (!train) {
        const before = training.filter((m) => (m.scheduled_at ?? '') < t.starts_at!);
        train = trainElo(before, players, tournamentLevels, t.starts_at!, HALFLIFE_DAYS);
        trainCache.set(t.starts_at!, train);
      }

      for (const category of ['men', 'women'] as const) {
        const { data: matchData } = await supabase
          .from('matches')
          // NB: matches has no `draw_position` column (only widget_id_composite);
          // selecting it would 400 the request. Frontier ordering uses the
          // widget heap number; draw_position stays undefined and is tolerated.
          .select('id, round, round_canonical, widget_id_composite, status, winner_pair, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, pair1_seed, pair2_seed')
          .eq('tournament_id', t.id).eq('category', category);
        const rows = (matchData ?? []) as Array<FrontierMatchRow & { round: string | null; round_canonical: string | null }>;
        if (rows.length === 0) continue;

        const byRound = new Map<ProjRound, FrontierMatchRow[]>();
        for (const m of rows) {
          const r = canonRound(m.round_canonical ?? m.round);
          if (!r) continue;
          (byRound.get(r) ?? byRound.set(r, []).get(r)!).push(m);
        }
        const entryRound = pickEntryRound(byRound)
        if (!entryRound) continue
        const entrants = buildFullFieldEntrants(byRound.get(entryRound)!, train.elo, players)
        if (entrants.filter(Boolean).length < 2) continue

        const decided = buildDecidedMap(rows)
        const statuses = deriveStatuses(rows)
        const projections = projectPairs({ entrants, runs: MC_RUNS, decided })

        const nameOf = (id: string) => players.get(id)?.name ?? ''
        const upsertRows = [...projections.values()].map((p) => {
          const st = statuses.get(p.pairKey) ?? { status: 'active' as const, eliminatedRound: null }
          return {
            tournament_id: t.id,
            category,
            pair_key: p.pairKey,
            pair_player_ids: p.playerIds,
            tournament_level: t.level,
            status: st.status,
            eliminated_round: st.eliminatedRound,
            champion_prob: p.championProb.toFixed(4),
            finalist_prob: p.finalistProb.toFixed(4),
            semifinal_prob: p.semifinalProb.toFixed(4),
            rounds: p.rounds.map((r) => ({
              round: r.round,
              reach_prob: Number(r.reachProb.toFixed(4)),
              expected_opponent_pair_key: r.opponents[0]?.pairKey ?? null,
              opponents: r.opponents.map((o) => ({
                pair_key: o.pairKey,
                player_ids: o.playerIds,
                names: o.playerIds.map(nameOf),
                reach_prob: Number(o.reachProb.toFixed(4)),
                win_prob: Number(o.winProb.toFixed(4)),
              })),
            })),
            model_version: MODEL_VERSION,
            mc_runs: MC_RUNS,
            computed_at: nowIso,
          }
        })

        if (!dryRun && upsertRows.length > 0) {
          // Replace this tournament+category's rows (prunes pairs no longer in
          // the draw). Two awaits, not a transaction: if the insert fails after
          // the delete, the next hourly run heals it. The delete error must be
          // checked, else a failed delete would let the insert produce dupes.
          const { error: delErr } = await supabase.from('tournament_projections')
            .delete().eq('tournament_id', t.id).eq('category', category);
          if (delErr) throw delErr;
          const { error } = await supabase.from('tournament_projections').insert(upsertRows);
          if (error) throw error;
        }
        rowsWritten += upsertRows.length;
      }
      processed++;
    } catch (err) {
      failed++;
      logger?.error({ err, tournamentId: t.id }, 'tournament projection failed');
    }
  }

  const durationMs = Date.now() - startMs;
  logger?.info({ processed, failed, rowsWritten, trainingSize: training.length, durationMs, dryRun },
    'tournament-projection-snapshot complete');
  return { processed, failed, rowsWritten, trainingSize: training.length, durationMs };
}
