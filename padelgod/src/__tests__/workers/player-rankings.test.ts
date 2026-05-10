import { describe, it, expect, vi } from 'vitest';
import { runPlayerRankings } from '../../workers/player-rankings.js';

const fakeRow = (rank: number) => `
  <tr>
    <td class="rank">${rank}</td>
    <td class="player-country"><img src="/flags/ESP.jpg" alt="ESP" /></td>
    <td class="player-name">Player ${rank}</td>
    <td class="points">${20000 - rank * 100}</td>
  </tr>
`;

const fakeRankingsHtml = (n: number) => `
  <table class="ranking-table"><tbody>
    ${Array.from({ length: n }, (_, i) => fakeRow(i + 1)).join('')}
  </tbody></table>
`;

function fakeSupabase() {
  const playersUpserted: any[] = [];
  const snapshotsUpserted: any[] = [];
  return {
    playersUpserted,
    snapshotsUpserted,
    schema: () => ({
      from: () => ({
        insert: () => ({
          select: () => ({ single: async () => ({ data: { id: 'job-uuid' }, error: null }) }),
        }),
        update: () => ({ eq: () => ({ data: null, error: null }) }),
      }),
    }),
    from: (table: string) => {
      if (table === 'players') {
        return {
          upsert: (rows: any[]) => {
            playersUpserted.push(...rows);
            return {
              select: () => ({
                data: rows.map((r, i) => ({ id: `player-${i}`, name: r.name, category: r.category })),
                error: null,
              }),
            };
          },
        };
      }
      if (table === 'player_ranking_snapshots') {
        return {
          upsert: (rows: any[]) => {
            snapshotsUpserted.push(...rows);
            return { data: rows, error: null };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

describe('runPlayerRankings', () => {
  it('fetches both genders and upserts all rows', async () => {
    const supabase = fakeSupabase();
    const httpClient = {
      get: vi
        .fn()
        .mockResolvedValueOnce({ data: fakeRankingsHtml(3) })  // men
        .mockResolvedValueOnce({ data: fakeRankingsHtml(2) }), // women
    };

    const result = await runPlayerRankings({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    expect(result.menCount).toBe(3);
    expect(result.womenCount).toBe(2);
    expect(supabase.playersUpserted).toHaveLength(5);
  });

  it('writes one snapshot row per upserted player with type=official, source=padelgod-fip', async () => {
    const supabase = fakeSupabase();
    const httpClient = {
      get: vi
        .fn()
        .mockResolvedValueOnce({ data: fakeRankingsHtml(2) })  // men
        .mockResolvedValueOnce({ data: fakeRankingsHtml(1) }), // women
    };

    await runPlayerRankings({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    expect(supabase.snapshotsUpserted).toHaveLength(3);
    for (const snap of supabase.snapshotsUpserted) {
      expect(snap.type).toBe('official');
      expect(snap.source).toBe('padelgod-fip');
      expect(snap.ranking_move).toBeNull();
      expect(typeof snap.player_id).toBe('string');
      expect(typeof snap.year).toBe('number');
      expect(typeof snap.week).toBe('number');
      expect(snap.week).toBeGreaterThanOrEqual(1);
      expect(snap.week).toBeLessThanOrEqual(53);
      expect(snap.ranking_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
