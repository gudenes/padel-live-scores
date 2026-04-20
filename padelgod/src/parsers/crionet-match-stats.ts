// Pure parser for POST /screen/getmatchstats responses from widget.matchscorerlive.com.
// The response is HTML with one `<div class="tab-pane" id="period-N">` per dimension:
//   period-0 = match aggregate
//   period-1 = set 1
//   period-2 = set 2
//   ... etc.
//
// Inside each tab-pane, stat rows follow a 3-column flex pattern:
//   <div class="stats-l1-values">       ← team1 value (e.g. "29%" or "3")
//     <span class="bold">29%</span>
//   </div>
//   <div class="stats-data-points">Total points won</div>  ← label
//   <div class="stats-l1-values text-right">                ← team2 value
//     <span class="bold">71%</span>
//   </div>
//
// Section headers use `<div class="stats-data-points-section">` — we ignore these.
//
// The 14 stat dimensions map to label text 1:1. See LABEL_TO_FIELD below.

import * as cheerio from 'cheerio';

export interface ParsedMatchStats {
  perSet: Array<{
    setNumber: number; // 0 = match aggregate, 1..N = per-set tabs
    team1: MatchStatsRow;
    team2: MatchStatsRow;
  }>;
}

export interface MatchStatsRow {
  totalPointsWonPct: number | null;
  breakPointsConvertedPct: number | null;
  longestStreak: number | null;
  aces: number | null;
  doubleFaults: number | null;
  wonOn1stServePct: number | null;
  wonOn2ndServePct: number | null;
  serviceGames: number | null;
  wonOn1stReturnPct: number | null;
  wonOn2ndReturnPct: number | null;
  returnGames: number | null;
  totalPoints: number | null;
  totalWonOnServe: number | null;
  totalWonOnReturn: number | null;
}

// Case-insensitive label mapping. Keys are lowercased trim() of the label text
// in the `.stats-data-points` div.
const LABEL_TO_FIELD: Record<string, keyof MatchStatsRow> = {
  'total points won': 'totalPointsWonPct',
  'break points converted': 'breakPointsConvertedPct',
  'longest streak': 'longestStreak',
  aces: 'aces',
  'double faults': 'doubleFaults',
  'won on 1st serve': 'wonOn1stServePct',
  'won on 2nd serve': 'wonOn2ndServePct',
  'service games': 'serviceGames',
  'won on 1st return': 'wonOn1stReturnPct',
  'won on 2nd return': 'wonOn2ndReturnPct',
  'return games': 'returnGames',
  'total points': 'totalPoints',
  'total won on serve': 'totalWonOnServe',
  'total won on return': 'totalWonOnReturn',
};

function emptyRow(): MatchStatsRow {
  return {
    totalPointsWonPct: null,
    breakPointsConvertedPct: null,
    longestStreak: null,
    aces: null,
    doubleFaults: null,
    wonOn1stServePct: null,
    wonOn2ndServePct: null,
    serviceGames: null,
    wonOn1stReturnPct: null,
    wonOn2ndReturnPct: null,
    returnGames: null,
    totalPoints: null,
    totalWonOnServe: null,
    totalWonOnReturn: null,
  };
}

// Extract a numeric value from a cell's text. "29%" → 29; "3" → 3; "" → null.
// Returns null for empty / non-numeric content so downstream logic can distinguish
// "field not reported" from "field was zero" (which would be "0").
function parseValue(raw: string): number | null {
  const trimmed = raw.replace(/[^\d.-]/g, '').trim();
  if (trimmed === '' || trimmed === '-') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return n;
}

function parseTabPane($: cheerio.CheerioAPI, tabEl: cheerio.Cheerio<any>): { team1: MatchStatsRow; team2: MatchStatsRow } {
  const team1 = emptyRow();
  const team2 = emptyRow();

  tabEl.find('.stats-data-points').each((_, labelDiv) => {
    const label = $(labelDiv).text().trim().toLowerCase();
    const field = LABEL_TO_FIELD[label];
    if (!field) return; // section header or unknown label

    // Walk to the containing row (parent flex) and grab siblings.
    const row = $(labelDiv).parent();
    const leftVal = row.find('.stats-l1-values').not('.text-right').first().text().trim();
    const rightVal = row.find('.stats-l1-values.text-right').first().text().trim();

    team1[field] = parseValue(leftVal);
    team2[field] = parseValue(rightVal);
  });

  return { team1, team2 };
}

export function parseCrionetMatchStats(html: string): ParsedMatchStats {
  const $ = cheerio.load(html);
  const perSet: ParsedMatchStats['perSet'] = [];

  $('.tab-pane[id^="period-"]').each((_, el) => {
    const id = $(el).attr('id') ?? '';
    const m = id.match(/^period-(\d+)$/);
    if (!m) return;
    const setNumber = Number(m[1]);
    const { team1, team2 } = parseTabPane($, $(el));
    perSet.push({ setNumber, team1, team2 });
  });

  // Sort by setNumber so callers get a deterministic order (0, 1, 2, ...).
  perSet.sort((a, b) => a.setNumber - b.setNumber);

  return { perSet };
}
