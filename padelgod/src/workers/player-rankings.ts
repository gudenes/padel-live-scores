import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import type { Logger } from 'pino';
import * as Sentry from '@sentry/node';
import { runScrapeJob } from '../lib/scrape-job.js';
import { FIP_RANKINGS_VERSION } from '../lib/parser-versions.js';
import { rehostAvatarToSupabase, ensureAvatarsBucket } from '../lib/avatar-rehost.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface PlayerRankingsDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
  logger?: Logger;
}

interface PhaseResult {
  fetched: number;
  updated: number;
  created: number;
}

export interface PlayerRankingsResult {
  official: {
    men: PhaseResult & { rankingDate: string | null };
    women: PhaseResult & { rankingDate: string | null };
  };
  race: {
    men: PhaseResult & { dropoutsCleared: number };
    women: PhaseResult & { dropoutsCleared: number };
  };
  avatars: { rehosted: number; skipped: number; failed: number };
  snapshotsWritten: number;
}

interface FipOfficialPlayer {
  player_id: string;
  name: string;
  surname: string;
  rank: number;
  points: number;
  move: number;
  url: string;
  thumbnail: string;
  country_name: string;
  country_flag: string;
}

interface FipRacePlayer {
  player_id: string;
  name: string;
  surname: string;
  race_rank: number;
  race_points: number;
  race_move: number;
  url: string;
  thumbnail: string;
  country_name: string;
  country_flag: string;
}

// ── Constants ────────────────────────────────────────────────────────────

const FIP_BASE = 'https://www.padelfip.com/es/wp-json/fip/v1';
const TOP_DEFAULT = 1000;
const PAGE_SIZE = 500;
const OFFICIAL_WEEK_FALLBACK = 3;
const AVATAR_BATCH = 20;
const RACE_CLEAR_CHUNK = 200;
const PROFILE_ATTEMPT_SENTINEL = '1970-01-01T00:00:00Z';

const COUNTRY_3_TO_2: Record<string, string> = {
  ESP: 'ES', ARG: 'AR', BRA: 'BR', POR: 'PT', FRA: 'FR', ITA: 'IT',
  BEL: 'BE', NLD: 'NL', GER: 'DE', GBR: 'GB', DEN: 'DK', SWE: 'SE',
  URU: 'UY', PAR: 'PY', CHI: 'CL', MEX: 'MX', USA: 'US', AUS: 'AU',
  QAT: 'QA', CRC: 'CR', COL: 'CO', PER: 'PE', ECU: 'EC', BOL: 'BO',
  VEN: 'VE', DOM: 'DO', PAN: 'PA', CUB: 'CU', GTM: 'GT', HON: 'HN',
  NIC: 'NI', SLV: 'SV', JAM: 'JM', TTO: 'TT', NZL: 'NZ', JPN: 'JP',
  KOR: 'KR', CHN: 'CN', IND: 'IN', EGY: 'EG', MAR: 'MA', RSA: 'ZA',
  KEN: 'KE', NGR: 'NG', TUN: 'TN', ISR: 'IL', LBN: 'LB', KUW: 'KW',
  BHR: 'BH', UAE: 'AE', KSA: 'SA', FIN: 'FI', NOR: 'NO', POL: 'PL',
  CZE: 'CZ', AUT: 'AT', SUI: 'CH', GRE: 'GR', ROU: 'RO', HUN: 'HU',
  BUL: 'BG', CRO: 'HR', SRB: 'RS', SVK: 'SK', SLO: 'SI', EST: 'EE',
  LAT: 'LV', LTU: 'LT', IRL: 'IE', LUX: 'LU', MON: 'MC', AND: 'AD',
  CYP: 'CY', MLT: 'MT', ISL: 'IS', ALB: 'AL', MKD: 'MK', BIH: 'BA',
  MNE: 'ME',
};

function fipCountryToIso2(code3: string | null | undefined): string | null {
  if (!code3) return null;
  return COUNTRY_3_TO_2[code3.toUpperCase()] ?? code3.slice(0, 2).toUpperCase();
}

// ── Date helpers ─────────────────────────────────────────────────────────

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

function currentYearWeek(): { year: number; week: number } {
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const diff = now.getTime() - start.getTime();
  const week = Math.ceil((diff / 86400000 + start.getDay() + 1) / 7);
  return { year, week };
}

function weekToDate(year: number, week: number): string {
  // UTC throughout — avoids local-tz drift on non-UTC dev machines.
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const jan1Day = jan1.getUTCDay();
  const dayOffset = (week - 1) * 7 - jan1Day + 1;
  const monday = new Date(Date.UTC(year, 0, 1 + dayOffset));
  return monday.toISOString().slice(0, 10) + 'T00:00:00Z';
}

// ── Fetch helpers ────────────────────────────────────────────────────────

async function fetchOfficial(
  httpClient: AxiosInstance,
  gender: 'male' | 'female',
  top: number,
): Promise<{ players: FipOfficialPlayer[]; rankingDate: string | null }> {
  const { year, week } = currentYearWeek();
  for (let w = week; w >= week - OFFICIAL_WEEK_FALLBACK && w >= 1; w--) {
    const all: FipOfficialPlayer[] = [];
    let offset = 0;
    while (all.length < top) {
      const remaining = top - all.length;
      const fetchLimit = Math.min(PAGE_SIZE, remaining);
      const url = `${FIP_BASE}/ranking/load-more/?gender=${gender}&limit=${fetchLimit}&offset=${offset}&category=master&circuit=premierpadel&year=${year}&week=${w}&lang=es`;
      const res = await httpClient.get(url);
      const data: FipOfficialPlayer[] = res.data ?? [];
      if (data.length === 0) break;
      all.push(...data);
      if (data.length < fetchLimit) break;
      offset += data.length;
    }
    if (all.length > 0) {
      return { players: all, rankingDate: weekToDate(year, w) };
    }
  }
  return { players: [], rankingDate: null };
}

/**
 * Trim FIP race response at the first series boundary. FIP concatenates
 * multiple race series; the boundary is where race_rank halves vs. the
 * running max (guarded by maxSoFar >= 30 to avoid early false positives).
 * See spec section "Race series-trim heuristic" for justification.
 */
function trimRaceAtSeriesBoundary(rows: FipRacePlayer[]): FipRacePlayer[] {
  let maxRank = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (maxRank >= 30 && row.race_rank * 2 < maxRank) {
      return rows.slice(0, i);
    }
    if (row.race_rank > maxRank) maxRank = row.race_rank;
  }
  return rows;
}

async function fetchRace(
  httpClient: AxiosInstance,
  gender: 'male' | 'female',
  top: number,
): Promise<FipRacePlayer[]> {
  const all: FipRacePlayer[] = [];
  let offset = 0;
  while (all.length < top) {
    const remaining = top - all.length;
    const fetchLimit = Math.min(PAGE_SIZE, remaining);
    const url = `${FIP_BASE}/player/search?search_type=race&gender=${gender}&limit=${fetchLimit}&offset=${offset}&category=master&circuit=premierpadel&lang=es`;
    const res = await httpClient.get(url);
    const data: FipRacePlayer[] = res.data ?? [];
    if (data.length === 0) break;
    all.push(...data);
    if (data.length < fetchLimit) break;
    offset += data.length;
  }
  return trimRaceAtSeriesBoundary(all);
}

// ── DB helpers ───────────────────────────────────────────────────────────

interface ResolvedPlayer {
  fipId: string;
  playerId: string;
  thumbnail: string;
  outcome: 'updated' | 'created';
}

async function upsertOfficialPlayers(
  supabase: SupabaseClient,
  rows: FipOfficialPlayer[],
  category: 'men' | 'women',
): Promise<ResolvedPlayer[]> {
  const byFipId = new Map<string, FipOfficialPlayer>();
  for (const r of rows) byFipId.set(r.player_id.replace(/^fip-/, ''), r);

  const { data: existing } = await supabase
    .from('players')
    .select('id, fip_id, name, country, category, ranking, points, ranking_move, profile_url')
    .in('fip_id', Array.from(byFipId.keys()));

  const existingByFipId = new Map<string, any>();
  for (const row of existing ?? []) existingByFipId.set(row.fip_id, row);

  const now = new Date().toISOString();
  const resolved: ResolvedPlayer[] = [];

  for (const [fipId, fipRow] of byFipId.entries()) {
    const fullName = `${fipRow.name} ${fipRow.surname}`.trim();
    const country = fipCountryToIso2(fipRow.country_name);
    const match = existingByFipId.get(fipId);

    if (match) {
      const patch: Record<string, unknown> = {
        ranking: fipRow.rank,
        points: fipRow.points,
        ranking_move: fipRow.move,
        last_updated_by: 'padelgod',
        updated_at: now,
      };
      if (fullName && fullName !== match.name) patch.name = fullName;
      if (country && country !== match.country) patch.country = country;
      if (fipRow.url && fipRow.url !== match.profile_url) patch.profile_url = fipRow.url;

      await supabase.from('players').update(patch).eq('id', match.id);
      resolved.push({ fipId, playerId: match.id, thumbnail: fipRow.thumbnail, outcome: 'updated' });
    } else {
      const insert = {
        fip_id: fipId,
        external_id: fipId,
        name: fullName,
        category,
        country,
        ranking: fipRow.rank,
        points: fipRow.points,
        ranking_move: fipRow.move,
        profile_url: fipRow.url || null,
        last_updated_by: 'padelgod',
        updated_at: now,
        profile_attempt_at: PROFILE_ATTEMPT_SENTINEL,
      };
      const { data: inserted } = await supabase.from('players').insert(insert).select().single();
      resolved.push({ fipId, playerId: inserted.id, thumbnail: fipRow.thumbnail, outcome: 'created' });
    }
  }

  return resolved;
}

async function upsertRacePlayers(
  supabase: SupabaseClient,
  rows: FipRacePlayer[],
  category: 'men' | 'women',
): Promise<ResolvedPlayer[]> {
  const byFipId = new Map<string, FipRacePlayer>();
  for (const r of rows) byFipId.set(r.player_id.replace(/^fip-/, ''), r);

  const { data: existing } = await supabase
    .from('players')
    .select('id, fip_id, name, country, category, race_ranking, race_points, race_move')
    .in('fip_id', Array.from(byFipId.keys()));

  const existingByFipId = new Map<string, any>();
  for (const row of existing ?? []) existingByFipId.set(row.fip_id, row);

  const now = new Date().toISOString();
  const resolved: ResolvedPlayer[] = [];

  for (const [fipId, fipRow] of byFipId.entries()) {
    const fullName = `${fipRow.name} ${fipRow.surname}`.trim();
    const country = fipCountryToIso2(fipRow.country_name);
    const match = existingByFipId.get(fipId);

    if (match) {
      const patch: Record<string, unknown> = {
        race_ranking: fipRow.race_rank,
        race_points: fipRow.race_points,
        race_move: fipRow.race_move,
        last_updated_by: 'padelgod',
        updated_at: now,
      };
      if (fullName && fullName !== match.name) patch.name = fullName;
      if (country && country !== match.country) patch.country = country;

      await supabase.from('players').update(patch).eq('id', match.id);
      resolved.push({ fipId, playerId: match.id, thumbnail: fipRow.thumbnail, outcome: 'updated' });
    } else {
      const insert = {
        fip_id: fipId,
        external_id: fipId,
        name: fullName,
        category,
        country,
        race_ranking: fipRow.race_rank,
        race_points: fipRow.race_points,
        race_move: fipRow.race_move,
        last_updated_by: 'padelgod',
        updated_at: now,
        profile_attempt_at: PROFILE_ATTEMPT_SENTINEL,
      };
      const { data: inserted } = await supabase.from('players').insert(insert).select().single();
      resolved.push({ fipId, playerId: inserted.id, thumbnail: fipRow.thumbnail, outcome: 'created' });
    }
  }

  return resolved;
}

async function writeOfficialSnapshots(
  supabase: SupabaseClient,
  resolved: ResolvedPlayer[],
  rowsByFipId: Map<string, FipOfficialPlayer>,
  category: 'men' | 'women',
  rankingDate: string,
): Promise<number> {
  const yw = isoYearWeek(new Date(rankingDate));
  const snapshotRows = resolved.map(r => {
    const row = rowsByFipId.get(r.fipId)!;
    return {
      player_id: r.playerId,
      type: 'official' as const,
      gender: category,
      year: yw.year,
      week: yw.week,
      ranking_date: yw.mondayIso,
      ranking: row.rank,
      points: row.points,
      ranking_move: row.move,
      source: 'padelgod-fip' as const,
    };
  });

  if (snapshotRows.length === 0) return 0;
  const { error: upsertErr } = await supabase.from('player_ranking_snapshots').upsert(snapshotRows, {
    onConflict: 'player_id,type,year,week',
    ignoreDuplicates: false,
  });
  if (upsertErr) {
    return 0;
  }
  return snapshotRows.length;
}

async function writeRaceSnapshots(
  supabase: SupabaseClient,
  resolved: ResolvedPlayer[],
  rowsByFipId: Map<string, FipRacePlayer>,
  category: 'men' | 'women',
): Promise<number> {
  const yw = isoYearWeek(new Date());
  const snapshotRows = resolved.map(r => {
    const row = rowsByFipId.get(r.fipId)!;
    return {
      player_id: r.playerId,
      type: 'race' as const,
      gender: category,
      year: yw.year,
      week: yw.week,
      ranking_date: yw.mondayIso,
      ranking: row.race_rank,
      points: row.race_points,
      ranking_move: row.race_move,
      source: 'padelgod-fip' as const,
    };
  });

  if (snapshotRows.length === 0) return 0;
  const { error: upsertErr } = await supabase.from('player_ranking_snapshots').upsert(snapshotRows, {
    onConflict: 'player_id,type,year,week',
    ignoreDuplicates: false,
  });
  if (upsertErr) {
    return 0;
  }
  return snapshotRows.length;
}

async function clearRaceDropouts(
  supabase: SupabaseClient,
  category: 'men' | 'women',
  writtenPlayerIds: Set<string>,
): Promise<number> {
  const { data: previouslyRanked } = await supabase
    .from('players')
    .select('id')
    .eq('category', category)
    .not('race_ranking', 'is', null);

  const dropouts = (previouslyRanked ?? [])
    .map((r: any) => r.id as string)
    .filter(id => !writtenPlayerIds.has(id));

  for (let i = 0; i < dropouts.length; i += RACE_CLEAR_CHUNK) {
    const chunk = dropouts.slice(i, i + RACE_CLEAR_CHUNK);
    await supabase
      .from('players')
      .update({ race_ranking: null, race_points: null, race_move: null })
      .in('id', chunk);
  }

  return dropouts.length;
}

// ── Phase runners ────────────────────────────────────────────────────────

async function runOfficialPhase(
  deps: PlayerRankingsDeps,
  gender: 'male' | 'female',
  category: 'men' | 'women',
  avatarMap: Map<string, string>,
): Promise<PhaseResult & { rankingDate: string | null; snapshotsWritten: number }> {
  let fetched = 0;
  let updated = 0;
  let created = 0;
  let rankingDate: string | null = null;
  let snapshotsWritten = 0;
  const phaseName = `official-${gender}`;

  try {
    await runScrapeJob(
      deps.supabase,
      {
        jobType: 'rankings',
        tournamentId: null,
        targetUrl: `${FIP_BASE}/ranking/load-more/?gender=${gender}`,
        parserVersion: FIP_RANKINGS_VERSION,
        captureBody: false,
      },
      async () => {
        const { players, rankingDate: rd } = await fetchOfficial(deps.httpClient, gender, TOP_DEFAULT);
        fetched = players.length;
        rankingDate = rd;

        if (players.length === 0) {
          throw new Error(
            `PARSED_ZERO_ROWS: ${phaseName} returned 0 rows across current week + ${OFFICIAL_WEEK_FALLBACK} fallback weeks`,
          );
        }

        const rowsByFipId = new Map<string, FipOfficialPlayer>();
        for (const r of players) rowsByFipId.set(r.player_id.replace(/^fip-/, ''), r);

        const resolved = await upsertOfficialPlayers(deps.supabase, players, category);
        updated = resolved.filter(r => r.outcome === 'updated').length;
        created = resolved.filter(r => r.outcome === 'created').length;

        for (const r of resolved) {
          if (r.thumbnail) avatarMap.set(r.playerId, r.thumbnail);
        }

        snapshotsWritten = await writeOfficialSnapshots(
          deps.supabase, resolved, rowsByFipId, category, rd!,
        );

        const yw = isoYearWeek(new Date(rd!));
        deps.logger?.info(
          { phase: phaseName, fetched, rankingDate: rd, year: yw.year, week: yw.week },
          `${phaseName} fetched ${fetched} rows`,
        );

        return { body: '', contentHash: 'sha256:rankings' };
      },
    );
  } catch (err) {
    Sentry.captureException(err, { tags: { worker: 'player-rankings', phase: phaseName } });
    throw err;
  }

  return { fetched, updated, created, rankingDate, snapshotsWritten };
}

async function runRacePhase(
  deps: PlayerRankingsDeps,
  gender: 'male' | 'female',
  category: 'men' | 'women',
  avatarMap: Map<string, string>,
): Promise<PhaseResult & { dropoutsCleared: number; snapshotsWritten: number }> {
  let fetched = 0;
  let updated = 0;
  let created = 0;
  let dropoutsCleared = 0;
  let snapshotsWritten = 0;
  const phaseName = `race-${gender}`;

  try {
    await runScrapeJob(
      deps.supabase,
      {
        jobType: 'rankings',
        tournamentId: null,
        targetUrl: `${FIP_BASE}/player/search?search_type=race&gender=${gender}`,
        parserVersion: FIP_RANKINGS_VERSION,
        captureBody: false,
      },
      async () => {
        const players = await fetchRace(deps.httpClient, gender, TOP_DEFAULT);
        fetched = players.length;

        if (players.length === 0) {
          throw new Error(`PARSED_ZERO_ROWS: ${phaseName} returned 0 rows`);
        }

        const rowsByFipId = new Map<string, FipRacePlayer>();
        for (const r of players) rowsByFipId.set(r.player_id.replace(/^fip-/, ''), r);

        const resolved = await upsertRacePlayers(deps.supabase, players, category);
        updated = resolved.filter(r => r.outcome === 'updated').length;
        created = resolved.filter(r => r.outcome === 'created').length;

        for (const r of resolved) {
          if (r.thumbnail) avatarMap.set(r.playerId, r.thumbnail);
        }

        snapshotsWritten = await writeRaceSnapshots(
          deps.supabase, resolved, rowsByFipId, category,
        );

        const writtenIds = new Set(resolved.map(r => r.playerId));
        dropoutsCleared = await clearRaceDropouts(deps.supabase, category, writtenIds);

        deps.logger?.info(
          { phase: phaseName, fetched },
          `${phaseName} fetched ${fetched} rows`,
        );

        return { body: '', contentHash: 'sha256:rankings' };
      },
    );
  } catch (err) {
    Sentry.captureException(err, { tags: { worker: 'player-rankings', phase: phaseName } });
    throw err;
  }

  return { fetched, updated, created, dropoutsCleared, snapshotsWritten };
}

// ── Main orchestrator ────────────────────────────────────────────────────

export async function runPlayerRankings(
  deps: PlayerRankingsDeps,
): Promise<PlayerRankingsResult> {
  await ensureAvatarsBucket(deps.supabase);

  const avatarMap = new Map<string, string>();

  const officialMen = await runOfficialPhase(deps, 'male', 'men', avatarMap);
  const officialWomen = await runOfficialPhase(deps, 'female', 'women', avatarMap);
  const raceMen = await runRacePhase(deps, 'male', 'men', avatarMap);
  const raceWomen = await runRacePhase(deps, 'female', 'women', avatarMap);

  const snapshotsWritten =
    officialMen.snapshotsWritten +
    officialWomen.snapshotsWritten +
    raceMen.snapshotsWritten +
    raceWomen.snapshotsWritten;

  if (snapshotsWritten === 0) {
    const err = new Error('NO_SNAPSHOTS_WRITTEN: all phases parsed rows but zero snapshots landed');
    Sentry.captureException(err, { tags: { worker: 'player-rankings', phase: 'orchestrator' } });
    throw err;
  }

  // Avatar rehost — post-loop, deduped Map, 20-wide batches
  const avatarEntries = Array.from(avatarMap.entries());
  let rehosted = 0;
  let skipped = 0;
  let failed = 0;
  for (let i = 0; i < avatarEntries.length; i += AVATAR_BATCH) {
    const chunk = avatarEntries.slice(i, i + AVATAR_BATCH);
    const outcomes = await Promise.all(
      chunk.map(([pid, thumb]) => rehostAvatarToSupabase(deps.supabase, pid, thumb)),
    );
    for (const o of outcomes) {
      if (o.status === 'ok') rehosted++;
      else if (o.status.startsWith('skipped')) skipped++;
      else failed++;
    }
  }

  return {
    official: {
      men: { fetched: officialMen.fetched, updated: officialMen.updated, created: officialMen.created, rankingDate: officialMen.rankingDate },
      women: { fetched: officialWomen.fetched, updated: officialWomen.updated, created: officialWomen.created, rankingDate: officialWomen.rankingDate },
    },
    race: {
      men: { fetched: raceMen.fetched, updated: raceMen.updated, created: raceMen.created, dropoutsCleared: raceMen.dropoutsCleared },
      women: { fetched: raceWomen.fetched, updated: raceWomen.updated, created: raceWomen.created, dropoutsCleared: raceWomen.dropoutsCleared },
    },
    avatars: { rehosted, skipped, failed },
    snapshotsWritten,
  };
}
