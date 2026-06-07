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
import { projectPairs, matchupKey, PROJ_ROUND_ORDER, type PairProjection, type PairRound } from '../lib/bracket-projection.js';
import { buildFirstRoundLeaves } from '../lib/bracket-builder.js';
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

function teamElo(
  a: string, b: string,
  elo: Map<string, number>,
  players: Map<string, PlayerLite>,
): number {
  const ea = elo.get(a) ?? fipPriorElo(players.get(a)?.ranking ?? null);
  const eb = elo.get(b) ?? fipPriorElo(players.get(b)?.ranking ?? null);
  return (ea + eb) / 2;
}

const HALFLIFE_DAYS = 180;
const MC_RUNS = 20_000;

/** matchupKey(pairKeyA, pairKeyB) → winner pairKey, from decided matches.
 *  Lets the bracket leaves collapse played matchups deterministically. */
export function buildResultByMatchup(rows: FrontierMatchRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of rows) {
    if (!(m.winner_pair === 1 || m.winner_pair === 2)) continue;
    const { pair1_player1_id: a1, pair1_player2_id: a2, pair2_player1_id: b1, pair2_player2_id: b2 } = m;
    if (!(a1 && a2 && b1 && b2)) continue;
    const pkA = pairKeyFor(a1, a2), pkB = pairKeyFor(b1, b2);
    out.set(matchupKey(pkA, pkB), m.winner_pair === 1 ? pkA : pkB);
  }
  return out;
}

/** Collapse the full first-round leaves forward through every already-decided
 *  round (winner advances, byes carry through) until the shallowest round with
 *  an undecided real match — the frontier. Decided matches in the frontier
 *  round collapse to [winner, null]. The returned entrants feed projectPairs,
 *  which then simulates only what hasn't happened yet (results respected). */
export function collapseToFrontier(
  leaves: (FrontierEntrant | null)[],
  resultByMatchup: Map<string, string>,
): (FrontierEntrant | null)[] {
  const decided = (a: FrontierEntrant | null, b: FrontierEntrant | null) =>
    Boolean(a && b && resultByMatchup.has(matchupKey(a.pairKey, b.pairKey)));
  const winnerOf = (a: FrontierEntrant, b: FrontierEntrant): FrontierEntrant =>
    resultByMatchup.get(matchupKey(a.pairKey, b.pairKey)) === a.pairKey ? a : b;

  let level = leaves;
  while (level.length > 1) {
    let hasUndecided = false;
    for (let i = 0; i < level.length; i += 2) {
      if (level[i] && level[i + 1] && !decided(level[i]!, level[i + 1]!)) { hasUndecided = true; break; }
    }
    if (hasUndecided) break;
    const next: (FrontierEntrant | null)[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i] ?? null, b = level[i + 1] ?? null;
      next.push(a && b ? winnerOf(a, b) : (a ?? b));
    }
    level = next;
  }
  const out: (FrontierEntrant | null)[] = [];
  for (let i = 0; i < level.length; i += 2) {
    const a = level[i] ?? null, b = level[i + 1] ?? null;
    if (a && b && decided(a, b)) out.push(winnerOf(a, b), null);
    else out.push(a, b);
  }
  return out;
}

/** Deepest round the pair is more likely than not to reach (reach_prob ≥ 0.5),
 *  falling back to the shallowest round present. Mirrors the Next app's
 *  projectedFinishRound — this is the value we FREEZE pre-tournament so the UI
 *  can later grade the call. */
export function computeProjectedFinish(
  rounds: { round: ProjRound; reachProb: number }[],
): ProjRound | null {
  if (rounds.length === 0) return null;
  let deepest = rounds[0]!.round;
  for (const r of rounds) if (r.reachProb >= 0.5) deepest = r.round;
  return deepest;
}

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

export interface DoneProjection extends PairProjection {
  status: 'eliminated' | 'champion'
  eliminatedRound: string | null
}

type DrawMatchRow = FrontierMatchRow & { round: string | null; round_canonical: string | null }

export interface PlayedInfo {
  ids: [string, string]
  rounds: PairRound[]        // factual played rounds; each opponent carries `result`
  lostRound: string | null
  wonFinal: boolean
  lastPlayedIdx: number      // PROJ_ROUND_ORDER index of the deepest played round (-1 if none)
}

/** Per-pair factual played main-draw rounds, reconstructed from decided
 *  matches. Each round's single opponent carries the actual result
 *  ('won'|'lost'). Shared by done-pair reconstruction and the active-pair
 *  full-road merge (so alive pairs show the rounds they've already won). */
export function buildPlayedRounds(rows: DrawMatchRow[]): Map<string, PlayedInfo> {
  type Played = { round: ProjRound; oppKey: string; oppIds: [string, string]; won: boolean }
  type Rec = { ids: [string, string]; played: Played[]; lostRound: string | null; wonFinal: boolean }
  const byPair = new Map<string, Rec>()
  const sortIds = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a])

  for (const m of rows) {
    if (!(m.winner_pair === 1 || m.winner_pair === 2)) continue
    const round = canonRound(m.round_canonical ?? m.round)
    if (!round) continue
    if (!(m.pair1_player1_id && m.pair1_player2_id && m.pair2_player1_id && m.pair2_player2_id)) continue
    const ids1 = sortIds(m.pair1_player1_id, m.pair1_player2_id)
    const ids2 = sortIds(m.pair2_player1_id, m.pair2_player2_id)
    const k1 = `${ids1[0]}::${ids1[1]}`
    const k2 = `${ids2[0]}::${ids2[1]}`
    const p1Won = m.winner_pair === 1
    const rec1 = byPair.get(k1) ?? { ids: ids1, played: [], lostRound: null, wonFinal: false }
    const rec2 = byPair.get(k2) ?? { ids: ids2, played: [], lostRound: null, wonFinal: false }
    rec1.played.push({ round, oppKey: k2, oppIds: ids2, won: p1Won })
    rec2.played.push({ round, oppKey: k1, oppIds: ids1, won: !p1Won })
    if (!p1Won) rec1.lostRound = round
    else if (round === 'F') rec1.wonFinal = true
    if (p1Won) rec2.lostRound = round
    else if (round === 'F') rec2.wonFinal = true
    byPair.set(k1, rec1)
    byPair.set(k2, rec2)
  }

  const out = new Map<string, PlayedInfo>()
  for (const [key, rec] of byPair) {
    const played = [...rec.played].sort(
      (a, b) => PROJ_ROUND_ORDER.indexOf(a.round) - PROJ_ROUND_ORDER.indexOf(b.round),
    )
    const rounds: PairRound[] = played.map((p) => ({
      round: p.round,
      reachProb: 1,
      opponents: [{
        pairKey: p.oppKey,
        playerIds: p.oppIds,
        reachProb: 1,
        winProb: p.won ? 1 : 0,
        result: p.won ? 'won' : 'lost',
      }],
    }))
    const lastPlayedIdx = played.length
      ? PROJ_ROUND_ORDER.indexOf(played[played.length - 1]!.round)
      : -1
    out.set(key, { ids: rec.ids, rounds, lostRound: rec.lostRound, wonFinal: rec.wonFinal, lastPlayedIdx })
  }
  return out
}

/** Reconstruct factual journeys for pairs whose tournament is over — lost a
 *  decided main-draw match (eliminated) or won the final (champion). */
export function buildDoneProjections(rows: DrawMatchRow[]): DoneProjection[] {
  const out: DoneProjection[] = []
  for (const [key, pl] of buildPlayedRounds(rows)) {
    const isChampion = pl.wonFinal
    const isEliminated = pl.lostRound != null
    if (!isChampion && !isEliminated) continue
    const reached = new Set(pl.rounds.map((r) => r.round))
    out.push({
      pairKey: key,
      playerIds: pl.ids,
      championProb: isChampion ? 1 : 0,
      finalistProb: reached.has('F') ? 1 : 0,
      semifinalProb: reached.has('SF') ? 1 : 0,
      rounds: pl.rounds,
      status: isChampion ? 'champion' : 'eliminated',
      eliminatedRound: isChampion ? null : pl.lostRound,
    })
  }
  return out
}

export function buildSnapshotRows(
  projections: Map<string, PairProjection>,
  tournamentId: string,
  category: 'men' | 'women',
  computedAtIso: string,
) {
  return [...projections.values()].map((p) => ({
    tournament_id: tournamentId,
    category,
    pair_key: p.pairKey,
    champion_prob: p.championProb.toFixed(4),
    finalist_prob: p.finalistProb.toFixed(4),
    semifinal_prob: p.semifinalProb.toFixed(4),
    computed_at: computedAtIso,
  }))
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

        // Path 1 — active pairs. Reconstruct the full bracket from `matches`
        // via the mirrored bracket-builder (same source as the Draw tab),
        // INCLUDING seeds that bye the first round, then collapse already-
        // decided rounds to the frontier and forward-sim the rest. Only project
        // once the draw is substantially loaded (≥ half the leaf slots filled),
        // so a half-published draw doesn't inflate the loaded pairs' odds.
        const mkEntrant = (a: string, b: string): FrontierEntrant => ({
          pairKey: pairKeyFor(a, b),
          playerIds: (a < b ? [a, b] : [b, a]) as [string, string],
          teamElo: teamElo(a, b, train.elo, players),
        })
        const leaves = buildFirstRoundLeaves(rows, (a, b) => mkEntrant(a, b))
        let activeProjections = new Map<string, PairProjection>()
        if (leaves.filter(Boolean).length >= leaves.length / 2) {
          const entrants = collapseToFrontier(leaves, buildResultByMatchup(rows))
          if (entrants.filter(Boolean).length >= 2) {
            activeProjections = projectPairs({ entrants, runs: MC_RUNS })
          }
        }

        // Path 2 — done pairs (eliminated + champion) reconstructed from results.
        const doneProjections = buildDoneProjections(rows)
        const doneKeys = new Set(doneProjections.map((d) => d.pairKey))

        // For active pairs, prepend the rounds they've already WON (factual)
        // to the projected future rounds, so an alive pair shows its full road.
        const played = buildPlayedRounds(rows)

        // Combine: done pairs + active pairs not already done (disjoint sets).
        const combined: Array<{ proj: PairProjection; status: 'active' | 'eliminated' | 'champion'; eliminatedRound: string | null }> = [
          ...doneProjections.map((d) => ({ proj: d as PairProjection, status: d.status, eliminatedRound: d.eliminatedRound })),
          ...[...activeProjections.values()]
            .filter((p) => !doneKeys.has(p.pairKey))
            .map((p) => {
              const pl = played.get(p.pairKey)
              // Keep only projected rounds deeper than the last played round
              // (drops the frontier-round bye for a pair that won the frontier).
              const future = pl
                ? p.rounds.filter((r) => PROJ_ROUND_ORDER.indexOf(r.round) > pl.lastPlayedIdx)
                : p.rounds
              const rounds = pl ? [...pl.rounds, ...future] : p.rounds
              return { proj: { ...p, rounds }, status: 'active' as const, eliminatedRound: null }
            }),
        ]
        if (combined.length === 0) continue

        // Freeze-once: read the predicted-finish round already stored (the
        // model's first/pre-tournament call) BEFORE the delete+insert refresh
        // below wipes it, so we can carry it forward unchanged. A pair seen
        // here for the first time while active gets its prediction computed now.
        const frozenFinish = new Map<string, ProjRound>()
        {
          const { data: frozenData } = await supabase
            .from('tournament_projections')
            .select('pair_key, predicted_finish_round')
            .eq('tournament_id', t.id).eq('category', category)
          for (const r of (frozenData ?? []) as { pair_key: string; predicted_finish_round: ProjRound | null }[]) {
            if (r.predicted_finish_round) frozenFinish.set(r.pair_key, r.predicted_finish_round)
          }
        }

        const nameOf = (id: string) => players.get(id)?.name ?? ''
        const upsertRows = combined.map(({ proj: p, status, eliminatedRound }) => ({
          tournament_id: t.id,
          category,
          pair_key: p.pairKey,
          pair_player_ids: p.playerIds,
          tournament_level: t.level,
          status,
          eliminated_round: eliminatedRound,
          // Frozen-once: keep the existing call, else capture the current one
          // for a still-active pair (a done pair never seen before gets none).
          predicted_finish_round:
            frozenFinish.get(p.pairKey)
            ?? (status === 'active' ? computeProjectedFinish(p.rounds) : null),
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
              result: o.result ?? null,
            })),
          })),
          model_version: MODEL_VERSION,
          mc_runs: MC_RUNS,
          computed_at: nowIso,
        }))

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
          const snapMap = new Map(combined.map((cb) => [cb.proj.pairKey, cb.proj]))
          const snapRows = buildSnapshotRows(snapMap, t.id, category, nowIso)
          if (snapRows.length > 0) {
            const { error: snapErr } = await supabase.from('tournament_projection_snapshots').insert(snapRows)
            if (snapErr) throw snapErr
          }
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
