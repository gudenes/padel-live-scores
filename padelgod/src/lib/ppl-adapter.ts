import { z } from 'zod';
import { normalizeIdentity } from './strict-player-resolver.js';
import type { PplEventPage, PplRosterPlayer } from './ppl-client.js';

const score = z.number().int().min(0).max(200);
const timestamp = z.string().datetime({ offset: true }).nullable().optional();
const competitor = z.object({ player_1_name: z.string(), player_2_name: z.string() });
export const pplMatchSchema = z.object({
  tournamentId: z.string(), leagueId: z.enum(['ppl', 'ppl-ii']), gameType: z.enum(['male', 'female']),
  homeTeamId: z.string().min(1), awayTeamId: z.string().min(1), stage: z.string().min(1),
  sessionNumber: z.number().int().nullable().optional(), date: z.string(),
  lineup: z.object({ homeLeft: z.string().nullable(), homeRight: z.string().nullable(),
    awayLeft: z.string().nullable(), awayRight: z.string().nullable() }),
  state: z.object({
    match_details: z.object({ match_id: z.string(), status: z.string(), actual_start_time: timestamp }),
    competitors: z.object({ team_a: competitor, team_b: competitor }),
    match_state: z.object({ last_updated: timestamp, game_started: z.boolean(), current_set: z.number().int().min(1).max(3),
      serving_team: z.string().nullable().optional() }),
    match_score_summary: z.object({ best_of_sets: z.literal(3), team_a_sets_won: score, team_b_sets_won: score,
      set_scores: z.array(z.object({ set_number: z.number().int().min(1).max(3), status: z.enum(['completed', 'in_progress', 'upcoming']),
        team_a_games: score, team_b_games: score, is_match_tiebreak: z.boolean().optional(),
        match_tiebreak_points: z.object({ a: score, b: score }).optional(),
      })).max(3),
      current_point: z.object({ team_a_display: z.string(), team_b_display: z.string(), in_tiebreak: z.boolean(),
        tiebreak_kind: z.string().optional() }),
    }),
  }),
});
export interface PplSnapshot {
  providerId: string; tournamentSlug: string; league: 'ppl' | 'ppl-ii'; category: 'men' | 'women';
  homeTeam: string; awayTeam: string; stage: string; session: number | null;
  status: 'scheduled' | 'live' | 'finished'; revision: string; startedAt: string | null; finishedAt: string | null;
  players: PplRosterPlayer[]; winner: 1 | 2 | null;
  sets: Array<{ number: number; a: number; b: number; current: boolean; matchTiebreak: boolean }>;
  game: { set: number; number: number; score: string; tiebreak: boolean; servingPair: 1 | 2 | null } | null;
}
function normalSet(a: number, b: number) {
  return (Math.max(a, b) === 6 && Math.min(a, b) <= 4) || (Math.max(a, b) === 7 && [5, 6].includes(Math.min(a, b)));
}

/** Provider A/B must be proven against selected lineups, never scoreboard rank
 * or visual left/right. Unselected franchise rosters are not match participants. */
export function pplToSnapshot(raw: unknown, id: string, revision: string, page: PplEventPage): PplSnapshot {
  // Most future fixtures have no scoring state at all until an umpire opens
  // the match. This is a waiting state, never proof of live play or a 0–0 score.
  if (raw && typeof raw === 'object' && !('state' in raw)) {
    const pending = pplMatchSchema.omit({ state: true }).parse(raw);
    if (pending.tournamentId !== page.event.slug || pending.leagueId !== page.event.league || !page.matchIds.includes(id) || pending.homeTeamId === pending.awayTeamId)
      throw new Error('PPL match/event identity mismatch');
    z.string().datetime({ offset: true }).parse(revision);
    return { providerId: id, tournamentSlug: pending.tournamentId, league: pending.leagueId,
      category: pending.gameType === 'male' ? 'men' : 'women', homeTeam: pending.homeTeamId, awayTeam: pending.awayTeamId,
      stage: pending.stage, session: pending.sessionNumber ?? null, status: 'scheduled', revision,
      startedAt: null, finishedAt: null, players: [], winner: null, sets: [], game: null };
  }
  const r = pplMatchSchema.parse(raw), s = r.state, summary = s.match_score_summary;
  if (r.tournamentId !== page.event.slug || r.leagueId !== page.event.league || s.match_details.match_id !== id || !page.matchIds.includes(id))
    throw new Error('PPL match/event identity mismatch');
  if (r.homeTeamId === r.awayTeamId) throw new Error('PPL duplicate team');
  z.string().datetime({ offset: true }).parse(revision);
  const state = s.match_details.status;
  const status = state === 'completed' ? 'finished' : state === 'scheduled' ? 'scheduled' :
    ['live', 'in_progress', 'in-progress', 'playing'].includes(state) ? 'live' : null;
  if (!status) throw new Error(`Unsupported PPL status: ${state}`);
  if (status === 'live' && (!s.match_state.game_started || !s.match_details.actual_start_time)) throw new Error('PPL not confirmed started');
  const category = r.gameType === 'male' ? 'men' : 'women';
  const slugs = [r.lineup.homeLeft, r.lineup.homeRight, r.lineup.awayLeft, r.lineup.awayRight];
  const players: PplRosterPlayer[] = [];
  if (status !== 'scheduled') {
    if (slugs.some(x => !x) || new Set(slugs).size !== 4) throw new Error('PPL lineup unconfirmed');
    for (const [i, slug] of slugs.entries()) {
      const found = page.players.filter(p => p.slug === slug && p.category === category && p.team === (i < 2 ? r.homeTeamId : r.awayTeamId));
      if (found.length !== 1) throw new Error(`PPL roster identity missing: ${slug}`);
      players.push(found[0]!);
    }
    const names = [s.competitors.team_a.player_1_name, s.competitors.team_a.player_2_name,
      s.competitors.team_b.player_1_name, s.competitors.team_b.player_2_name]
      .map(name => normalizeIdentity(name.replace(/\s*["“][^"”]*["”]\s*/g, ' ').trim()));
    if (players.some((p, i) => normalizeIdentity(p.name) !== names[i])) throw new Error('PPL competitor/lineup orientation mismatch');
  }
  const sets: PplSnapshot['sets'] = [];
  const wins = [0, 0];
  for (const set of summary.set_scores) {
    if (set.status === 'upcoming') continue;
    if (set.set_number !== sets.length + 1 || wins.some(w => w >= 2)) throw new Error('PPL set order invalid');
    const mtb = set.is_match_tiebreak === true;
    if (mtb && (set.set_number !== 3 || wins[0] !== 1 || wins[1] !== 1)) throw new Error('PPL match tiebreak before split sets');
    const a = mtb ? set.match_tiebreak_points?.a : set.team_a_games;
    const b = mtb ? set.match_tiebreak_points?.b : set.team_b_games;
    if (a == null || b == null) throw new Error('PPL match tiebreak points missing');
    const completed = set.status === 'completed';
    if (completed) {
      if (mtb ? !(Math.max(a, b) >= 10 && Math.abs(a - b) === 2 || Math.max(a, b) === 10 && Math.min(a, b) <= 8) : !normalSet(a, b))
        throw new Error('Invalid PPL completed set');
      wins[a > b ? 0 : 1]!++;
    } else if (sets.some(x => x.current) || (!mtb && (a > 6 || b > 6 || normalSet(a, b)))) throw new Error('Invalid PPL current set');
    sets.push({ number: set.set_number, a, b, current: !completed && status === 'live', matchTiebreak: mtb });
  }
  if (summary.team_a_sets_won !== wins[0] || summary.team_b_sets_won !== wins[1]) throw new Error('PPL sets won disagree');
  if (status === 'finished' && (!wins.includes(2) || sets.some(x => x.current) || summary.set_scores.some(x => x.status === 'in_progress')))
    throw new Error('PPL final without complete score');
  if (status === 'finished' && !s.match_state.last_updated) throw new Error('PPL final timestamp missing');
  if (status === 'live' && wins.includes(2)) throw new Error('PPL live with terminal score');
  let game: PplSnapshot['game'] = null;
  if (status === 'live') {
    const current = sets.find(x => x.current);
    if (!current || current.number !== s.match_state.current_set) throw new Error('PPL current set mismatch');
    const p = summary.current_point;
    const tie = p.in_tiebreak || current.matchTiebreak;
    if (![p.team_a_display, p.team_b_display].every(x => tie ? /^\d{1,3}$/.test(x) : /^(0|15|30|40|AD|Ad|A)$/.test(x))) throw new Error('Invalid PPL points');
    const server = s.match_state.serving_team;
    game = { set: current.number, number: current.matchTiebreak ? 1 : current.a + current.b + 1,
      score: `${p.team_a_display}-${p.team_b_display}`, tiebreak: tie, servingPair: server === 'team_a' ? 1 : server === 'team_b' ? 2 : null };
  }
  return { providerId: id, tournamentSlug: r.tournamentId, league: r.leagueId, category, homeTeam: r.homeTeamId, awayTeam: r.awayTeamId,
    stage: r.stage, session: r.sessionNumber ?? null, status, revision, players, sets: status === 'scheduled' ? [] : sets, game,
    startedAt: s.match_details.actual_start_time ?? null,
    // Document updateTime is revision ordering, NOT an observed finish time.
    finishedAt: status === 'finished' ? s.match_state.last_updated ?? null : null,
    winner: status === 'finished' ? wins[0] === 2 ? 1 : 2 : null };
}
