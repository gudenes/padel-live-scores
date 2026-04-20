import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseFipRankings, type Gender, type ParsedRanking } from '../parsers/fip-rankings.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { FIP_RANKINGS_VERSION } from '../lib/parser-versions.js';

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

  const { error } = await deps.supabase
    .from('players')
    .upsert(rows, { onConflict: 'normalized_name,category', ignoreDuplicates: false });

  if (error) throw new Error(`Player rankings upsert failed: ${error.message}`);

  return { menCount: men.length, womenCount: women.length };
}
