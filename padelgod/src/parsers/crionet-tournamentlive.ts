import * as cheerio from 'cheerio';
import { normalizeCountry } from '../lib/country.js';

const TABLE_SELECTOR = 'table';
// Accepts both `scorebox-header-live` (live matches) and the bare
// `scorebox-header` (completed matches — Crionet drops the `-live` suffix
// when a match finishes but keeps the row visible in tournamentlive for
// ~2 min). Without matching both, Completed rows get filtered out at the
// selector level and never reach the status-label branch that collapses
// them to `status='finished'`. Observed missing on Brussels P2 QF fixture.
const LIVE_HEADER_SELECTOR = 'tr.scorebox-header-live, tr.scorebox-header';
const COURT_NAME_SELECTOR = '.tournament-name, .court-name';
const ROUND_NAME_SELECTOR = '.round-name';
const SUMMARY_ROW_SELECTOR = 'tr.summary';
const STATS_BUTTON_SELECTOR = 'a.open[data-id]';
// Widget's status label — Bootstrap's ml-4 utility class happens to uniquely
// identify the label span inside the summary row. E.g. <span class="ml-4">On court</span>.
const STATUS_LABEL_SELECTOR = 'span.ml-4';
const TEAM_CELL_SELECTOR = 'td.team';
const POINTS_CELL_SELECTOR = 'td.points';
const SET_CELL_SELECTOR = 'td.set';
const BALL_IMG_SELECTOR = 'img.ballg';

export type Category = 'men' | 'women';
export type LiveStatus = 'on_court' | 'live' | 'finished';

export interface ParsedLiveTeam {
  player1Name: string;
  player2Name: string;
  player1Country: string | null;
  player2Country: string | null;
  player1Seed: number | null;
  player2Seed: number | null;
  currentPoints: string;
  setGames: Array<string | null>;
  setTiebreaks: Array<number | null>;
}

export interface ParsedLiveMatch {
  matchWidgetId: string;
  court: string;
  roundLabel: string;
  category: Category;
  team1: ParsedLiveTeam;
  team2: ParsedLiveTeam;
  servingTeam: 1 | 2 | null;
  durationMinutes: number | null;
  status: LiveStatus;
}

export interface ParsedLiveTournament {
  matches: ParsedLiveMatch[];
}

/**
 * Parse the category from the round-name header block.
 *
 * Structure:
 *   <small><b>Women </b><div>Q1</div></small>
 * The <b> contains the gender label; the <div> contains the round code.
 */
function parseCategoryAndRound(roundNode: cheerio.Cheerio<any>): { category: Category; roundLabel: string } {
  const boldText = roundNode.find('b').first().text().trim().toLowerCase();
  const category: Category = boldText.startsWith('women') ? 'women' : 'men';
  // Round label: prefer the inner <div>; fall back to the trimmed remainder of the header.
  let roundLabel = roundNode.find('div').first().text().trim();
  if (!roundLabel) {
    // Strip the <b> text and use what's left
    const cloned = roundNode.clone();
    cloned.find('b').remove();
    roundLabel = cloned.text().trim();
  }
  return { category, roundLabel: roundLabel || 'Unknown' };
}

/**
 * Extract a country code from a flag image src like "/images/flags/ESP.jpg"
 * and normalize it to our canonical alpha-2 format (ESP → ES). See
 * `lib/country.ts` for the normalization rules + rationale.
 */
function countryFromFlag($: cheerio.CheerioAPI, container: cheerio.Cheerio<any>): string | null {
  const img = container.find('img.flags').first();
  if (img.length === 0) return null;
  const src = img.attr('src') ?? '';
  const m = src.match(/\/([A-Z]{2,3})\.(?:jpg|png|svg)/i);
  return normalizeCountry(m?.[1] ?? null);
}

/**
 * Parse a player row — the flag + name div inside one of the team's two `.d-flex.align-items-center` blocks.
 *
 * Structure:
 *   <div class="d-flex align-items-center">
 *     <div><img class="flags" src="/images/flags/BEL.jpg"/></div>
 *     <div class="ml-2 line-thin"><span>N.</span><span>Sermant</span><small class="separator">(ALT)</small></div>
 *   </div>
 *
 * Seed: only extract numeric seeds (e.g. "(8)" → 8). Non-numeric markers like "(ALT)" → null.
 */
function parsePlayerRow($: cheerio.CheerioAPI, row: cheerio.Cheerio<any>): {
  name: string;
  country: string | null;
  seed: number | null;
} {
  const country = countryFromFlag($, row);
  const nameDiv = row.find('div.ml-2, div.ms-2').first();
  const spans = nameDiv.find('> span');
  const parts: string[] = [];
  spans.each((_, s) => {
    const t = $(s).text().trim();
    if (t) parts.push(t);
  });
  const name = parts.join(' ').trim();

  let seed: number | null = null;
  const seedText = nameDiv.find('small.separator').first().text().trim();
  if (seedText) {
    const m = seedText.match(/\((\d+)\)/);
    if (m?.[1]) seed = parseInt(m[1], 10);
  }
  return { name, country, seed };
}

/**
 * Parse a team row. Returns both players, the team's currentPoints text, and the per-set cells.
 */
function parseTeamRow($: cheerio.CheerioAPI, tr: cheerio.Cheerio<any>): {
  player1: { name: string; country: string | null; seed: number | null };
  player2: { name: string; country: string | null; seed: number | null };
  currentPoints: string;
  setCells: Array<{ games: string; tb: number | null }>;
  isServing: boolean;
} {
  const teamCell = tr.find(TEAM_CELL_SELECTOR).first();
  const playerRows = teamCell.find('.player-names .double > .d-flex');
  const player1 = playerRows.eq(0).length > 0
    ? parsePlayerRow($, playerRows.eq(0))
    : { name: '', country: null, seed: null };
  const player2 = playerRows.eq(1).length > 0
    ? parsePlayerRow($, playerRows.eq(1))
    : { name: '', country: null, seed: null };

  const pointsCell = tr.find(POINTS_CELL_SELECTOR).first();
  const currentPoints = pointsCell.length > 0 ? pointsCell.text().trim() : '';

  const setCells = tr.find(SET_CELL_SELECTOR).map((_, el) => parseSetCell($, $(el))).get();

  // Server indicator: <img class="ballg"> inside the team row (typically in the right-hand mr-2 div).
  const isServing = tr.find(BALL_IMG_SELECTOR).length > 0;

  return { player1, player2, currentPoints, setCells, isServing };
}

/**
 * Parse a set cell. Regular: <td class="set">6</td>. Tiebreak (loser's cell): <td class="set">7<sup>3</sup></td>.
 * Unplayed: <td class="set">-</td>.
 */
function parseSetCell($: cheerio.CheerioAPI, td: cheerio.Cheerio<any>): { games: string; tb: number | null } {
  const sup = td.find('sup').first();
  const tbRaw = sup.length > 0 ? parseInt(sup.text().trim(), 10) : NaN;
  sup.remove();
  const games = td.text().trim();
  return { games, tb: Number.isNaN(tbRaw) ? null : tbRaw };
}

/**
 * Maximum plausible match duration in minutes. Padel matches almost never
 * exceed 3.5 hours; 4 hours is a generous outer bound. Any parsed HH:MM
 * above this is treated as wall-clock-time contamination (see ASUNCION P2
 * 2026-05-08 incident, where '22:09' and '20:05' end-times leaked into
 * the duration column via the summary row).
 */
const MAX_DURATION_MINUTES = 240;

/**
 * Parse duration string like "00:09" → 9 minutes, "01:21" → 81 minutes.
 * Returns null for values above MAX_DURATION_MINUTES so the caller can
 * keep iterating past wall-clock-time spans toward a real elapsed span.
 */
function parseDuration(text: string): number | null {
  const m = text.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hours = parseInt(m[1]!, 10);
  const minutes = parseInt(m[2]!, 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  const total = hours * 60 + minutes;
  if (total > MAX_DURATION_MINUTES) return null;
  return total;
}

export function parseCrionetTournamentLive(html: string): ParsedLiveTournament {
  const $ = cheerio.load(html);
  const matches: ParsedLiveMatch[] = [];

  $(TABLE_SELECTOR).each((_, table) => {
    const $t = $(table);

    // V1: live matches only. Header class must be scorebox-header-live.
    const header = $t.find(LIVE_HEADER_SELECTOR).first();
    if (header.length === 0) return;

    const court = header.find(COURT_NAME_SELECTOR).first().text().trim() || '';
    const { category, roundLabel } = parseCategoryAndRound(header.find(ROUND_NAME_SELECTOR).first());

    // Two team rows: the ones containing td.team. Header + summary are excluded.
    const teamRows = $t.find('tr').filter((_, el) => $(el).find(TEAM_CELL_SELECTOR).length > 0);
    if (teamRows.length < 2) return;

    const t1 = parseTeamRow($, teamRows.eq(0));
    const t2 = parseTeamRow($, teamRows.eq(1));

    const setCount = Math.max(t1.setCells.length, t2.setCells.length);
    const team1SetGames: Array<string | null> = [];
    const team1SetTiebreaks: Array<number | null> = [];
    const team2SetGames: Array<string | null> = [];
    const team2SetTiebreaks: Array<number | null> = [];
    for (let i = 0; i < setCount; i++) {
      const a = t1.setCells[i] ?? { games: '-', tb: null };
      const b = t2.setCells[i] ?? { games: '-', tb: null };
      team1SetGames.push(a.games);
      team1SetTiebreaks.push(a.tb);
      team2SetGames.push(b.games);
      team2SetTiebreaks.push(b.tb);
    }

    const team1: ParsedLiveTeam = {
      player1Name: t1.player1.name,
      player2Name: t1.player2.name,
      player1Country: t1.player1.country,
      player2Country: t1.player2.country,
      player1Seed: t1.player1.seed,
      player2Seed: t1.player2.seed,
      currentPoints: t1.currentPoints,
      setGames: team1SetGames,
      setTiebreaks: team1SetTiebreaks,
    };
    const team2: ParsedLiveTeam = {
      player1Name: t2.player1.name,
      player2Name: t2.player2.name,
      player1Country: t2.player1.country,
      player2Country: t2.player2.country,
      player1Seed: t2.player1.seed,
      player2Seed: t2.player2.seed,
      currentPoints: t2.currentPoints,
      setGames: team2SetGames,
      setTiebreaks: team2SetTiebreaks,
    };

    let servingTeam: 1 | 2 | null = null;
    if (t1.isServing && !t2.isServing) servingTeam = 1;
    else if (t2.isServing && !t1.isServing) servingTeam = 2;

    // Summary row: duration + stats button data-id + status label.
    const summaryRow = $t.find(SUMMARY_ROW_SELECTOR).first();
    let durationMinutes: number | null = null;
    let matchWidgetId = '';
    // Status label (the text inside <span class="ml-4">…</span>) tells us
    // whether the widget considers the match "on court" (players arrived /
    // warming up, but no first point yet) vs "live match" (in progress).
    // Crionet uses at least two pre-match labels — "On court" and
    // "Warming up" (casing may vary) — which we collapse into a single
    // `on_court` status.
    //
    // Terminal labels (2026-04-23): Crionet also keeps matches visible in
    // the tournamentlive widget for ~2 minutes AFTER they finish, rendered
    // with a terminal label ("Completed", "Retired", "Walkover"). Before
    // this branch existed, those rows fell through to `live` — live-poller
    // kept bumping `matches.updated_at`, never called closeMatch, and the
    // row got stuck at `status='live'` until the match eventually
    // disappeared from the widget AND the sweeper decided it was stale.
    // Brussels P2 2026 match 58eabeb6 hit exactly this: the widget said
    // "Completed" with decisive scores (6-3, 6-4) for ~2 min, but we read
    // it as still-live. Emitting `'finished'` here lets
    // live-poller-loop.ts's existing close-on-widget-finish branch fire
    // with the widget-reported sets — closing the match within one poll
    // tick instead of waiting for disappear + sweeper.
    //
    // The three terminal labels all collapse to `'finished'` today. If we
    // need to preserve the retired/walkover distinction downstream (the UI
    // renders RET / W/O badges), that's a follow-up: closeMatch currently
    // hardcodes status='finished', so distinguishing at the parser level
    // alone wouldn't change DB writes. TODO: extend LiveStatus + closeMatch
    // to carry the terminal kind through.
    //
    // Any other label, including an empty one, falls through to `live`.
    let status: LiveStatus = 'live';
    if (summaryRow.length > 0) {
      const spans = summaryRow.find('span');
      spans.each((_, el) => {
        const txt = $(el).text().trim();
        if (durationMinutes === null) {
          const d = parseDuration(txt);
          if (d !== null) durationMinutes = d;
        }
      });
      const statsBtn = summaryRow.find(STATS_BUTTON_SELECTOR).first();
      matchWidgetId = statsBtn.attr('data-id')?.trim() ?? '';

      const label = summaryRow.find(STATUS_LABEL_SELECTOR).first().text().trim().toLowerCase();
      if (label === 'on court' || label.includes('warm')) {
        status = 'on_court';
      } else if (
        label === 'completed' ||
        label === 'finished' ||
        label === 'retired' ||
        label === 'walkover'
      ) {
        status = 'finished';
      }
    }

    matches.push({
      matchWidgetId,
      court,
      roundLabel,
      category,
      team1,
      team2,
      servingTeam,
      durationMinutes,
      status,
    });
  });

  return { matches };
}
