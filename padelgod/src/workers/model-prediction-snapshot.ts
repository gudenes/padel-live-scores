// model-prediction-snapshot — hourly snapshot worker.
// See docs/superpowers/specs/2026-05-27-odds-admin-visibility-design.md §2.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import {
  trainElo,
  pairWinProbability,
  toDecimal,
  fipPriorElo,
  MODEL_VERSION,
  type TrainingMatch,
  type PlayerSnapshot,
  type TrainResult,
} from '../lib/elo-model.js';
import { paginatedSelect } from '../lib/db-paginate.js';

const IN_SCOPE_LEVELS = new Set(['major', 'p1', 'p2', 'fip_platinum', 'fip_gold']);
const HALFLIFE_DAYS = 180;
const MC_RUNS = 20_000;
const UPCOMING_HORIZON_DAYS = 14;

export function isInScopeTier(level: string | null | undefined): boolean {
  if (!level) return false;
  return IN_SCOPE_LEVELS.has(level.toLowerCase());
}

export function isMainDrawRound(round: string | null | undefined): boolean {
  if (!round) return false;
  const x = round.toLowerCase();
  if (x === 'r32' || x === 'r16' || x === 'qf' || x === 'sf' || x === 'f') return true;
  if (x === 'round of 32' || x === 'round of 16') return true;
  if (x === 'final' || x === 'semifinal' || x === 'quarterfinal') return true;
  return false;
}

export interface InScopeTournament {
  id: string;
  level: string;
  starts_at: string;
}

export interface ModelPredictionSnapshotDeps {
  supabase: SupabaseClient;
  logger?: Logger;
  dryRun?: boolean;
  /** Override "now" for tests. Defaults to new Date(). */
  now?: () => Date;
}

export interface ModelPredictionSnapshotResult {
  processed: number;
  failed: number;
  matchPredictionsWritten: number;
  tournamentPredictionsWritten: number;
  trainingSize: number;
  durationMs: number;
}

interface SurvivingPair {
  pair_id: string;
  player_ids: [string, string];
  seed: number | null;
  team_elo: number;
  team_form: number;
}

function canonicalRound(r: string | null | undefined): string {
  if (!r) return '';
  const x = r.toLowerCase();
  if (x.includes('round of 32') || x === 'r32') return 'R32';
  if (x.includes('round of 16') || x === 'r16') return 'R16';
  if (x === 'qf' || x.includes('quarter')) return 'QF';
  if (x === 'sf' || x.includes('semi')) return 'SF';
  if (x === 'f' || x.includes('final')) return 'F';
  return x.toUpperCase();
}

const ROUND_ORDER = ['R32', 'R16', 'QF', 'SF', 'F'];

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

function pickWinner(a: SurvivingPair, b: SurvivingPair): SurvivingPair {
  const pA = pairWinProbability(a.team_elo, b.team_elo);
  return Math.random() < pA ? a : b;
}

function monteCarlo(
  pairs: SurvivingPair[],
  runs: number,
): Map<string, { champ: number; finalist: number; semi: number }> {
  const tally = new Map<string, { champ: number; finalist: number; semi: number }>();
  for (const p of pairs) tally.set(p.pair_id, { champ: 0, finalist: 0, semi: 0 });
  if (pairs.length < 2) return tally;
  let bracketSize = 1;
  while (bracketSize < pairs.length) bracketSize *= 2;
  for (let run = 0; run < runs; run++) {
    let alive: (SurvivingPair | null)[] = shuffle(pairs);
    while (alive.length < bracketSize) alive.push(null);
    while (alive.length > 1) {
      if (alive.length === 4) for (const p of alive) if (p) tally.get(p.pair_id)!.semi++;
      if (alive.length === 2) for (const p of alive) if (p) tally.get(p.pair_id)!.finalist++;
      const next: (SurvivingPair | null)[] = [];
      for (let i = 0; i < alive.length; i += 2) {
        const a = alive[i] ?? null;
        const b = alive[i + 1] ?? null;
        if (a && !b) next.push(a);
        else if (!a && b) next.push(b);
        else if (!a && !b) next.push(null);
        else next.push(pickWinner(a as SurvivingPair, b as SurvivingPair));
      }
      alive = next;
    }
    const champ = alive[0];
    if (champ) tally.get(champ.pair_id)!.champ++;
  }
  return tally;
}

interface MatchRow {
  id: string;
  round: string | null;
  round_canonical: string | null;
  status: string | null;
  scheduled_at: string | null;
  winner_pair: number | null;
  pair1_player1_id: string | null;
  pair1_player2_id: string | null;
  pair2_player1_id: string | null;
  pair2_player2_id: string | null;
  pair1_seed: number | null;
  pair2_seed: number | null;
}

async function loadSurvivingPairs(
  supabase: SupabaseClient,
  tournamentId: string,
  category: 'men' | 'women',
  players: Map<string, PlayerSnapshot>,
  train: TrainResult,
): Promise<{ pairs: SurvivingPair[]; entryRound: string }> {
  const { data: rows } = await supabase
    .from('matches')
    .select(
      'id, round, round_canonical, status, scheduled_at, winner_pair, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, pair1_seed, pair2_seed',
    )
    .eq('tournament_id', tournamentId)
    .eq('category', category);

  const matchRows = (rows ?? []) as MatchRow[];
  if (matchRows.length === 0) return { pairs: [], entryRound: '' };

  const byRound: Record<string, MatchRow[]> = {};
  for (const m of matchRows) {
    const r = canonicalRound(m.round_canonical ?? m.round);
    if (!ROUND_ORDER.includes(r)) continue;
    (byRound[r] ||= []).push(m);
  }

  let entryRound = '';
  for (const r of ROUND_ORDER) {
    const ms = byRound[r] ?? [];
    if (ms.length === 0) continue;
    let assigned = 0;
    for (const m of ms) {
      if (m.pair1_player1_id && m.pair1_player2_id) assigned++;
      if (m.pair2_player1_id && m.pair2_player2_id) assigned++;
    }
    if (assigned >= 4) entryRound = r;
  }
  if (!entryRound) return { pairs: [], entryRound: '' };

  const startIdx = ROUND_ORDER.indexOf(entryRound);
  const collectRounds = ROUND_ORDER.slice(startIdx);
  const matches = collectRounds.flatMap((r) => byRound[r] ?? []);

  const seen = new Set<string>();
  const pairs: SurvivingPair[] = [];
  const addPair = (ids: [string, string], seed: number | null) => {
    const sorted = [...ids].sort() as [string, string];
    const key = sorted.join('::');
    if (seen.has(key)) return;
    seen.add(key);
    const e1 = train.elo.get(ids[0]) ?? fipPriorElo(players.get(ids[0])?.ranking);
    const e2 = train.elo.get(ids[1]) ?? fipPriorElo(players.get(ids[1])?.ranking);
    const e1Prev = train.eloFormStart.get(ids[0]) ?? e1;
    const e2Prev = train.eloFormStart.get(ids[1]) ?? e2;
    const team_elo = (e1 + e2) / 2;
    const team_elo_prev = (e1Prev + e2Prev) / 2;
    pairs.push({
      pair_id: key,
      player_ids: ids,
      seed,
      team_elo,
      team_form: team_elo - team_elo_prev,
    });
  };
  for (const m of matches) {
    if (m.pair1_player1_id && m.pair1_player2_id) {
      addPair([m.pair1_player1_id, m.pair1_player2_id], m.pair1_seed ?? null);
    }
    if (m.pair2_player1_id && m.pair2_player2_id) {
      addPair([m.pair2_player1_id, m.pair2_player2_id], m.pair2_seed ?? null);
    }
  }
  return { pairs, entryRound };
}

interface UpcomingMatchRow {
  id: string;
  round: string | null;
  round_canonical: string | null;
  scheduled_at: string | null;
  pair1_player1_id: string | null;
  pair1_player2_id: string | null;
  pair2_player1_id: string | null;
  pair2_player2_id: string | null;
}

interface TournamentPredictionRow {
  tournament_id: string;
  category: 'men' | 'women';
  pair_player1_id: string;
  pair_player2_id: string;
  pair_seed: number | null;
  champ_prob: string;
  finalist_prob: string;
  semi_prob: string;
  team_elo: string;
  team_form: string;
  entry_round: string;
  model_version: string;
  mc_runs: number;
  halflife_days: number;
}

interface MatchPredictionRow {
  match_id: string;
  pair1_prob: string;
  pair2_prob: string;
  pair1_decimal_odds: string;
  pair2_decimal_odds: string;
  pair1_team_elo: string;
  pair2_team_elo: string;
  pair1_team_form: string;
  pair2_team_form: string;
  model_version: string;
  training_match_count: number;
  halflife_days: number;
}

export async function runModelPredictionSnapshot(
  deps: ModelPredictionSnapshotDeps,
): Promise<ModelPredictionSnapshotResult> {
  const { supabase, logger, dryRun = false, now = () => new Date() } = deps;
  const startMs = Date.now();
  const nowIso = now().toISOString();
  const horizonIso = new Date(now().getTime() + UPCOMING_HORIZON_DAYS * 86_400_000).toISOString();

  // 1. Load players + tournament levels
  const playerRows = await paginatedSelect<PlayerSnapshot>(
    (s, e) => supabase.from('players').select('id, name, ranking, category').range(s, e),
    { what: 'players (model-prediction-snapshot)' },
  );
  const players = new Map(playerRows.map((p) => [p.id, p]));

  const tournamentRows = await paginatedSelect<{ id: string; level: string | null }>(
    (s, e) => supabase.from('tournaments').select('id, level').range(s, e),
    { what: 'tournaments (model-prediction-snapshot)' },
  );
  const tournamentLevels = new Map(tournamentRows.map((t) => [t.id, t.level ?? '']));

  // 2. In-scope tournaments: tier match + still in window
  const { data: scopeRows } = await supabase
    .from('tournaments')
    .select('id, level, starts_at, status, ends_at')
    .gte('ends_at', nowIso)
    .order('starts_at', { ascending: true });
  const inScope: InScopeTournament[] = ((scopeRows ?? []) as Array<{
    id: string;
    level: string | null;
    starts_at: string | null;
  }>)
    .filter((t) => isInScopeTier(t.level) && t.starts_at)
    .map((t) => ({ id: t.id, level: t.level!, starts_at: t.starts_at! }));

  logger?.info({ count: inScope.length }, 'in-scope tournaments identified');

  if (inScope.length === 0) {
    return {
      processed: 0,
      failed: 0,
      matchPredictionsWritten: 0,
      tournamentPredictionsWritten: 0,
      trainingSize: 0,
      durationMs: Date.now() - startMs,
    };
  }

  // 3. Load training matches once (we anchor per-tournament during training)
  const training = await paginatedSelect<TrainingMatch>(
    (s, e) =>
      supabase
        .from('matches')
        .select(
          'id, tournament_id, finished_at, scheduled_at, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, winner_pair',
        )
        .eq('status', 'finished')
        .not('winner_pair', 'is', null)
        .not('pair1_player1_id', 'is', null)
        .not('pair1_player2_id', 'is', null)
        .not('pair2_player1_id', 'is', null)
        .not('pair2_player2_id', 'is', null)
        .order('scheduled_at', { ascending: true })
        .range(s, e),
    { what: 'training matches (model-prediction-snapshot)' },
  );

  // 4. Process each tournament. Cache trained Elo by starts_at to avoid redundant work.
  const trainCache = new Map<string, TrainResult>();
  let processed = 0;
  let failed = 0;
  let matchWritten = 0;
  let tournWritten = 0;

  for (const t of inScope) {
    try {
      let train = trainCache.get(t.starts_at);
      if (!train) {
        const before = training.filter((m) => (m.scheduled_at ?? '') < t.starts_at);
        train = trainElo(before, players, tournamentLevels, t.starts_at, HALFLIFE_DAYS);
        trainCache.set(t.starts_at, train);
      }

      for (const category of ['men', 'women'] as const) {
        const { pairs, entryRound } = await loadSurvivingPairs(
          supabase,
          t.id,
          category,
          players,
          train,
        );
        if (pairs.length < 2) continue;

        // Tournament-level MC
        const tally = monteCarlo(pairs, MC_RUNS);
        const tournRows: TournamentPredictionRow[] = pairs.map((p) => ({
          tournament_id: t.id,
          category,
          pair_player1_id: p.player_ids[0],
          pair_player2_id: p.player_ids[1],
          pair_seed: p.seed,
          champ_prob: (tally.get(p.pair_id)!.champ / MC_RUNS).toFixed(4),
          finalist_prob: (tally.get(p.pair_id)!.finalist / MC_RUNS).toFixed(4),
          semi_prob: (tally.get(p.pair_id)!.semi / MC_RUNS).toFixed(4),
          team_elo: p.team_elo.toFixed(2),
          team_form: p.team_form.toFixed(2),
          entry_round: entryRound,
          model_version: MODEL_VERSION,
          mc_runs: MC_RUNS,
          halflife_days: HALFLIFE_DAYS,
        }));
        if (!dryRun && tournRows.length > 0) {
          const { error } = await supabase.from('model_tournament_predictions').insert(tournRows);
          if (error) throw error;
        }
        tournWritten += tournRows.length;

        // Per-match snapshots for upcoming main-draw matches
        const { data: upcoming } = await supabase
          .from('matches')
          .select(
            'id, round, round_canonical, scheduled_at, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id',
          )
          .eq('tournament_id', t.id)
          .eq('category', category)
          .in('status', ['scheduled', 'live'])
          .gte('scheduled_at', nowIso)
          .lte('scheduled_at', horizonIso);

        const matchRows: MatchPredictionRow[] = [];
        for (const m of (upcoming ?? []) as UpcomingMatchRow[]) {
          if (!isMainDrawRound(m.round_canonical ?? m.round)) continue;
          if (
            !m.pair1_player1_id ||
            !m.pair1_player2_id ||
            !m.pair2_player1_id ||
            !m.pair2_player2_id
          ) {
            continue;
          }

          const e1a =
            train.elo.get(m.pair1_player1_id) ??
            fipPriorElo(players.get(m.pair1_player1_id)?.ranking);
          const e1b =
            train.elo.get(m.pair1_player2_id) ??
            fipPriorElo(players.get(m.pair1_player2_id)?.ranking);
          const e2a =
            train.elo.get(m.pair2_player1_id) ??
            fipPriorElo(players.get(m.pair2_player1_id)?.ranking);
          const e2b =
            train.elo.get(m.pair2_player2_id) ??
            fipPriorElo(players.get(m.pair2_player2_id)?.ranking);
          const e1aPrev = train.eloFormStart.get(m.pair1_player1_id) ?? e1a;
          const e1bPrev = train.eloFormStart.get(m.pair1_player2_id) ?? e1b;
          const e2aPrev = train.eloFormStart.get(m.pair2_player1_id) ?? e2a;
          const e2bPrev = train.eloFormStart.get(m.pair2_player2_id) ?? e2b;

          const team1 = (e1a + e1b) / 2;
          const team2 = (e2a + e2b) / 2;
          const team1Prev = (e1aPrev + e1bPrev) / 2;
          const team2Prev = (e2aPrev + e2bPrev) / 2;
          const p1 = pairWinProbability(team1, team2);
          const p2 = 1 - p1;

          matchRows.push({
            match_id: m.id,
            pair1_prob: p1.toFixed(4),
            pair2_prob: p2.toFixed(4),
            pair1_decimal_odds: Math.min(999.999, toDecimal(p1)).toFixed(3),
            pair2_decimal_odds: Math.min(999.999, toDecimal(p2)).toFixed(3),
            pair1_team_elo: team1.toFixed(2),
            pair2_team_elo: team2.toFixed(2),
            pair1_team_form: (team1 - team1Prev).toFixed(2),
            pair2_team_form: (team2 - team2Prev).toFixed(2),
            model_version: MODEL_VERSION,
            training_match_count: train.trainedCount,
            halflife_days: HALFLIFE_DAYS,
          });
        }
        if (matchRows.length > 0 && !dryRun) {
          const { error } = await supabase.from('model_predictions').insert(matchRows);
          if (error) throw error;
        }
        matchWritten += matchRows.length;
      }
      processed++;
    } catch (err) {
      failed++;
      logger?.error({ err, tournamentId: t.id }, 'tournament snapshot failed');
    }
  }

  const durationMs = Date.now() - startMs;
  logger?.info(
    {
      processed,
      failed,
      matchPredictionsWritten: matchWritten,
      tournamentPredictionsWritten: tournWritten,
      trainingSize: training.length,
      durationMs,
      dryRun,
    },
    'model-prediction-snapshot complete',
  );

  return {
    processed,
    failed,
    matchPredictionsWritten: matchWritten,
    tournamentPredictionsWritten: tournWritten,
    trainingSize: training.length,
    durationMs,
  };
}
