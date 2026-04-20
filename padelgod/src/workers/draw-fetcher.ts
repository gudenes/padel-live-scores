import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseCrionetDraw, type Category, type DrawType } from '../parsers/crionet-draw.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { CRIONET_DRAW_VERSION } from '../lib/parser-versions.js';

export interface DrawFetcherDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
}

export interface DrawFetcherResult {
  tournamentsProcessed: number;
  totalMatchesInserted: number;
}

interface ActiveTournament {
  tournament_id: string;
  widget_id: string;
}

const DRAW_TYPE_CODES: Array<{ category: Category; drawType: DrawType; code: string }> = [
  { category: 'men',   drawType: 'main_draw',  code: 'MD' },
  { category: 'men',   drawType: 'qualifying', code: 'MQ' },
  { category: 'women', drawType: 'main_draw',  code: 'WD' },
  { category: 'women', drawType: 'qualifying', code: 'WQ' },
];

const URL_FOR = (widgetCode: string, drawTypeCode: string, round: number) =>
  `https://widget.matchscorerlive.com/screen/draw/${widgetCode}/${drawTypeCode}/${round}?t=tol`;

const ROUNDS_TO_TRY = [1, 2, 3, 4, 5, 6, 7, 8];

async function getLatestScrapeJobId(
  supabase: SupabaseClient,
  tournamentId: string,
  targetUrl: string
): Promise<string | null> {
  const { data } = await supabase
    .schema('padelgod')
    .from('scrape_jobs')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('target_url', targetUrl)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function fetchOneDrawTypeRound(
  deps: DrawFetcherDeps,
  t: ActiveTournament,
  category: Category,
  drawType: DrawType,
  drawTypeCode: string,
  round: number
): Promise<number> {
  const targetUrl = URL_FOR(t.widget_id, drawTypeCode, round);
  let parsed: ReturnType<typeof parseCrionetDraw> = [];

  await runScrapeJob(
    deps.supabase,
    {
      jobType: 'draw',
      tournamentId: t.tournament_id,
      targetUrl,
      parserVersion: CRIONET_DRAW_VERSION,
      captureBody: true,
    },
    async () => {
      const response = await deps.httpClient.get(targetUrl);
      const body = String(response.data);
      const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
      parsed = parseCrionetDraw(body, category, drawType);
      return { body, contentHash };
    }
  );

  if (parsed.length === 0) return 0;

  const scrapeJobId = await getLatestScrapeJobId(deps.supabase, t.tournament_id, targetUrl);
  if (!scrapeJobId) return 0;

  const rows = parsed.map((m) => ({
    scrape_job_id: scrapeJobId,
    tournament_id: t.tournament_id,
    category: m.category,
    draw_type: m.drawType,
    round_label: m.roundLabel,
    draw_position: m.drawPosition,
    team1_player1_name: m.team1Player1Name,
    team1_player2_name: m.team1Player2Name,
    team2_player1_name: m.team2Player1Name,
    team2_player2_name: m.team2Player2Name,
    team1_seed: null,
    team2_seed: null,
    team1_country: m.team1Country,
    team2_country: m.team2Country,
    set_scores: m.setScores,
    winner_team: m.winnerTeam,
    status: m.status,
  }));

  const { error } = await deps.supabase
    .schema('padelgod')
    .from('draw_snapshots')
    .insert(rows);

  if (error) throw new Error(`draw_snapshots insert failed: ${error.message}`);
  return rows.length;
}

export async function runDrawFetcher(deps: DrawFetcherDeps): Promise<DrawFetcherResult> {
  const { data: tournaments, error } = await deps.supabase.rpc(
    'padelgod_active_tournaments_for_static_workers'
  );
  if (error) throw new Error(`Active tournaments RPC failed: ${error.message}`);
  const list = (tournaments ?? []) as ActiveTournament[];

  let totalMatchesInserted = 0;
  for (const t of list) {
    for (const { category, drawType, code } of DRAW_TYPE_CODES) {
      let consecutiveEmpty = 0;
      for (const round of ROUNDS_TO_TRY) {
        const inserted = await fetchOneDrawTypeRound(deps, t, category, drawType, code, round);
        totalMatchesInserted += inserted;
        if (inserted === 0) {
          consecutiveEmpty++;
          if (consecutiveEmpty >= 2) break;
        } else {
          consecutiveEmpty = 0;
        }
      }
    }
  }

  return {
    tournamentsProcessed: list.length,
    totalMatchesInserted,
  };
}
