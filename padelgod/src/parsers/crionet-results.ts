import * as cheerio from 'cheerio';

const TABLE_SELECTOR = 'table.w-100';
const HEADER_SELECTOR = 'tr.scorebox-header-completed';
const COURT_LABEL_SELECTOR = '.court-name, .tournament-name';
const ROUND_BLOCK_SELECTOR = '.round-name';
const TEAM_ROW_SELECTOR = 'tr.draw-item-container';
const TEAM_SELECTOR = 'td.team';
const PLAYER_LINE_SELECTOR = 'div';
const PLAYER_NAME_SELECTOR = 'span';
const SET_SELECTOR = 'td.set';
const STATS_BUTTON_SELECTOR = 'a.open';
const WINNER_CLASS = 'winner';

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

function parseTeam($: cheerio.CheerioAPI, td: cheerio.Cheerio<any>): {
  player1: string | null;
  player2: string | null;
  hasWinner: boolean;
} {
  const lines = td.find(PLAYER_LINE_SELECTOR);
  let p1: string | null = null;
  let p2: string | null = null;
  let hasWinner = false;
  lines.each((idx, line) => {
    const $line = $(line);
    const span = $line.find(PLAYER_NAME_SELECTOR).first();
    const text = span.text().trim();
    if (!text) return;
    if (span.hasClass(WINNER_CLASS)) hasWinner = true;
    if (idx === 0) p1 = text;
    else if (idx === 1) p2 = text;
  });
  return { player1: p1, player2: p2, hasWinner };
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

    const team1Sets = team1Row.find(SET_SELECTOR).map((_, el) => $(el).text().trim()).get();
    const team2Sets = team2Row.find(SET_SELECTOR).map((_, el) => $(el).text().trim()).get();
    const sets: string[] = [];
    for (let i = 0; i < Math.max(team1Sets.length, team2Sets.length); i++) {
      const a = team1Sets[i] ?? '-';
      const b = team2Sets[i] ?? '-';
      if (a === '-' && b === '-') continue;
      sets.push(`${a}-${b}`);
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
