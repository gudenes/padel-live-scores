import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseFipRankings, type Gender, type ParsedRanking } from '../parsers/fip-rankings.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { FIP_RANKINGS_VERSION } from '../lib/parser-versions.js';

// ISO 8601 week numbering: Thursday's year decides the week's year; week 1 contains Jan 4.
function isoYearWeek(d: Date): { year: number; week: number; mondayIso: string } {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const diff = (date.getTime() - firstThursday.getTime()) / 86400000;
  const week = 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - 3);
  return { year: date.getUTCFullYear(), week, mondayIso: monday.toISOString().slice(0, 10) };
}

export interface PlayerRankingsDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
}

export interface PlayerRankingsResult {
  menCount: number;
  womenCount: number;
}

const URL_FOR = (gender: Gender) =>
  `https://www.padelfip.com/ranking/?gender=${gender === 'men' ? 'male' : 'female'}`;

async function fetchAndParse(
  deps: PlayerRankingsDeps,
  gender: Gender
): Promise<ParsedRanking[]> {
  const targetUrl = URL_FOR(gender);
  let parsed: ParsedRanking[] = [];
  await runScrapeJob(
    deps.supabase,
    {
      jobType: 'rankings',
      tournamentId: null,
      targetUrl,
      parserVersion: FIP_RANKINGS_VERSION,
      captureBody: false,
    },
    async () => {
      const response = await deps.httpClient.get(targetUrl);
      const body = String(response.data);
      const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
      parsed = parseFipRankings(body, gender);
      return { body, contentHash };
    }
  );
  return parsed;
}

export async function runPlayerRankings(
  deps: PlayerRankingsDeps
): Promise<PlayerRankingsResult> {
  const [men, women] = await Promise.all([
    fetchAndParse(deps, 'men'),
    fetchAndParse(deps, 'women'),
  ]);

  const all = [...men, ...women];
  if (all.length === 0) return { menCount: 0, womenCount: 0 };

  // Upsert by name + country + gender (no FIP id available from rankings page alone).
  // Player profile worker will enrich fip_id later.
  const rows = all.map((r) => ({
    name: r.name,
    country: r.country,
    category: r.gender,
    ranking: r.rank,
    points: r.points,
    last_updated_by: 'padelgod',
  }));

  const { data: upserted, error } = await deps.supabase
    .from('players')
    .upsert(rows, { onConflict: 'normalized_name,category', ignoreDuplicates: false })
    .select('id, name, category');

  if (error) throw new Error(`Player rankings upsert failed: ${error.message}`);

  // Build a name+category → id map. Supabase doesn't guarantee output order
  // matches input, so don't rely on array indices.
  const idByKey = new Map<string, string>();
  for (const u of upserted ?? []) {
    idByKey.set(`${u.name}::${u.category}`, u.id);
  }

  const { year, week, mondayIso } = isoYearWeek(new Date());

  const snapshotRows = all
    .map((r) => {
      const playerId = idByKey.get(`${r.name}::${r.gender}`);
      if (!playerId) return null;
      return {
        player_id: playerId,
        type: 'official' as const,
        gender: r.gender,
        year,
        week,
        ranking_date: mondayIso,
        ranking: r.rank,
        points: r.points,
        ranking_move: null,
        source: 'padelgod-fip' as const,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (snapshotRows.length > 0) {
    const { error: snapErr } = await deps.supabase
      .from('player_ranking_snapshots')
      .upsert(snapshotRows, {
        onConflict: 'player_id,type,year,week',
        ignoreDuplicates: false,
      });
    if (snapErr) console.error('[player-rankings] snapshot upsert failed:', snapErr.message);
  }

  return { menCount: men.length, womenCount: women.length };
}
