import type { CourtbitMatch } from '../../lib/courtbit-client.js';
import type { CourtbitContext } from '../../lib/courtbit-resolve.js';

export const row: CourtbitMatch = {
  id: 'oj_one', category: 'Femenino', phase: 'Dieciseisavos de final',
  a: { players: [{ name: 'Ana One', slug: 'ana-one', country: 'ESP' }, { name: 'Bea Two', slug: 'bea-two', country: 'ESP' }] },
  b: { players: [{ name: 'Carla Three', slug: 'carla-three', country: 'ARG' }, { name: 'Diana Four', slug: 'diana-four', country: 'ARG' }] },
  status: 'live', sets: [[4, 6]], tb: [null], games: [1, 5], points: ['15', '40'],
  server: 'A', winner: null, reason: null, startedAt: 1794931387790, finishedAt: null,
  courtName: 'Pista central', playedOn: null, day: '2026-11-17',
};
export function context(): CourtbitContext {
  return { players: [...row.a.players, ...row.b.players].map((p, i) => ({ ...p, id: String(i + 1), category: 'women' })),
    aliases: new Map(), mappings: new Map(), cache: new Map(), matches: [{
      id: 'match', category: 'women', round: 'Round of 32', status: 'scheduled',
      pair1_player1_id: '2', pair1_player2_id: '1', pair2_player1_id: '4', pair2_player2_id: '3',
      pair1_player1_name: null, pair1_player2_name: null, pair2_player1_name: null, pair2_player2_name: null,
    }] };
}

