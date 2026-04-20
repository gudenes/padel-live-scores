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
  const upserted: any[] = [];
  return {
    upserted,
    schema: () => ({
      from: () => ({
        insert: () => ({
          select: () => ({ single: async () => ({ data: { id: 'job-uuid' }, error: null }) }),
        }),
        update: () => ({ eq: () => ({ data: null, error: null }) }),
      }),
    }),
    from: () => ({
      upsert: (rows: any[]) => {
        upserted.push(...rows);
        return { data: rows, error: null };
      },
    }),
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
    expect(supabase.upserted).toHaveLength(5);
  });
});
