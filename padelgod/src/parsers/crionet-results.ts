import * as cheerio from 'cheerio';

const TABLE_SELECTOR = 'table.w-100';
const HEADER_SELECTOR = 'tr.scorebox-header-completed';
const COURT_LABEL_SELECTOR = '.court-name, .tournament-name';
const ROUND_BLOCK_SELECTOR = '.round-name';
const TEAM_ROW_SELECTOR = 'tr.draw-item-container';
const TEAM_SELECTOR = 'td.team';
const SET_SELECTOR = 'td.set';
const STATS_BUTTON_SELECTOR = 'a.open';

export type Category = 'men' | 'women';
export type ResultsStatus = 'finished' | 'walkover' | 'retired';

export interface ParsedResultsMatch {
  dayNumber: number;
  category: Category;
  roundLabel: string | null;
  court: string | null;
  matchWidgetId: string | null;
  team1Player1Name: string | null;
  team1Player2Name: string | null;
  team2Player1Name: string | null;
  team2Player2Name: string | null;
  setScores: string;
  winnerTeam: 1 | 2;
  status: ResultsStatus;
}

function parseCategoryFromRoundBlock($block: cheerio.Cheerio<any>): Category | null {
  const text = $block.text().trim().toLowerCase();
  if (text.startsWith('men')) return 'men';
  if (text.startsWith('women')) return 'women';
  return null;
}

function parseRoundLabel($block: cheerio.Cheerio<any>): string | null {
  const inner = $block.find('div').first().text().trim();
  return inner || null;
}

/**
 * Extract player names and winner status from a team <td>.
 *
 * Real HTML structure (from Crionet/matchscorerlive.com):
 *   Each player line is a div.d-flex.align-items-center containing:
 *     - a flag <img class="flags">
 *     - a name div with class "ml-2" (optionally + "winner", "line-thin")
 *       containing TWO spans: initial (e.g. "F.") + surname (e.g. "Chingotto")
 *
 * Winner indicated by "winner" class on the name div OR fa-check icon in the td.
 */
function parseTeam($: cheerio.CheerioAPI, td: cheerio.Cheerio<any>): {
  player1: string | null;
  player2: string | null;
  hasWinner: boolean;
} {
  // Winner check: fa-check icon or "winner" class anywhere in the td
  const hasWinner = td.html()?.includes('fa-check') === true ||
    td.find('[class*="winner"]').length > 0;

  const playerNames: string[] = [];

  td.find('div').each((_, el) => {
    const $el = $(el);
    const cls = $el.attr('class') ?? '';
    // Match the name container: must have ml-2 or ms-2
    if (!/(?:^|\s)(?:ml-2|ms-2)(?:\s|$)/.test(cls)) return;

    // Must contain at least one span (not just small/separator)
    const spans = $el.find('> span');
    if (spans.length === 0) return;

    const parts: string[] = [];
    spans.each((_, span) => {
      const text = $(span).text().trim();
      if (text) parts.push(text);
    });
    if (parts.length === 0) return;

    playerNames.push(parts.join(' ').trim());
  });

  return {
    player1: playerNames[0] ?? null,
    player2: playerNames[1] ?? null,
    hasWinner,
  };
}

/**
 * Parse a single set <td> cell.
 *
 * Normal set: <td class="set ...">6</td>          → { games: '6', tb: null }
 * Tiebreak:   <td class="set ...">6<sup>3</sup></td> → { games: '6', tb: 3 }
 *
 * The <sup> is always in the LOSER's cell and holds the loser's tiebreak points.
 */
function parseSetCell($: cheerio.CheerioAPI, td: cheerio.Cheerio<any>): { games: string; tb: number | null } {
  const sup = td.find('sup').first();
  const tb = sup.length > 0 ? parseInt(sup.text().trim(), 10) : null;
  sup.remove();
  const games = td.text().trim();
  return { games, tb: isNaN(tb as number) ? null : tb };
}

export function parseCrionetResults(html: string, dayNumber: number): ParsedResultsMatch[] {
  const $ = cheerio.load(html);
  const out: ParsedResultsMatch[] = [];

  $(TABLE_SELECTOR).each((_, table) => {
    const $t = $(table);
    const header = $t.find(HEADER_SELECTOR).first();
    if (header.length === 0) return;

    const court = header.find(COURT_LABEL_SELECTOR).first().text().trim() || null;
    const roundBlock = header.find(ROUND_BLOCK_SELECTOR).first();
    const category = parseCategoryFromRoundBlock(roundBlock);
    if (!category) return;
    const roundLabel = parseRoundLabel(roundBlock);

    const teamRows = $t.find(TEAM_ROW_SELECTOR);
    if (teamRows.length < 2) return;
    const team1Row = teamRows.eq(0);
    const team2Row = teamRows.eq(1);

    const team1 = parseTeam($, team1Row.find(TEAM_SELECTOR).first());
    const team2 = parseTeam($, team2Row.find(TEAM_SELECTOR).first());

    // Parse set cells: extract game count text + optional tiebreak from <sup>
    const team1SetCells = team1Row.find(SET_SELECTOR).map((_, el) => parseSetCell($, $(el))).get();
    const team2SetCells = team2Row.find(SET_SELECTOR).map((_, el) => parseSetCell($, $(el))).get();
    const sets: string[] = [];
    for (let i = 0; i < Math.max(team1SetCells.length, team2SetCells.length); i++) {
      const a = team1SetCells[i] ?? { games: '-', tb: null };
      const b = team2SetCells[i] ?? { games: '-', tb: null };
      if (a.games === '-' && b.games === '-') continue;
      // Tiebreak: <sup>N</sup> appears in the LOSER's cell; append (N) to the set string
      const tbSuffix = a.tb !== null ? `(${a.tb})` : b.tb !== null ? `(${b.tb})` : '';
      sets.push(`${a.games}-${b.games}${tbSuffix}`);
    }
    if (sets.length === 0) return;
    const setScores = sets.join(' ');

    const winnerTeam: 1 | 2 = team1.hasWinner ? 1 : 2;
    const button = $t.find(STATS_BUTTON_SELECTOR).first();
    const matchWidgetId = button.attr('data-id') ?? null;

    out.push({
      dayNumber,
      category,
      roundLabel,
      court,
      matchWidgetId,
      team1Player1Name: team1.player1,
      team1Player2Name: team1.player2,
      team2Player1Name: team2.player1,
      team2Player2Name: team2.player2,
      setScores,
      winnerTeam,
      status: 'finished',
    });
  });

  return out;
}
