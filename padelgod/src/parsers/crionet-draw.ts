import * as cheerio from 'cheerio';

const TABLE_SELECTOR = 'table.w-100';
const HEADER_SELECTOR = 'tr.scorebox-header-completed, tr.scorebox-header-live, tr.scorebox-header-scheduled';
const COURT_NAME_SELECTOR = '.court-name';
const ROUND_NAME_SELECTOR = '.round-name';
const TEAM_ROW_SELECTOR = 'tr.draw-item-container';
const TEAM_SELECTOR = 'td.team';
const PLAYER_LINE_SELECTOR = 'div';
const PLAYER_NAME_SELECTOR = 'span';
const SET_SELECTOR = 'td.set';
const WINNER_CLASS = 'winner';

export type Category = 'men' | 'women';
export type DrawType = 'main_draw' | 'qualifying';
export type DrawStatus = 'scheduled' | 'live' | 'finished' | 'walkover' | 'retired';

export interface ParsedDrawMatch {
  category: Category;
  drawType: DrawType;
  roundLabel: string;
  drawPosition: number | null;
  court: string | null;
  team1Player1Name: string | null;
  team1Player2Name: string | null;
  team2Player1Name: string | null;
  team2Player2Name: string | null;
  team1Country: string | null;
  team2Country: string | null;
  setScores: string | null;
  winnerTeam: 1 | 2 | null;
  status: DrawStatus;
}

function statusFromHeaderClass(cls: string): DrawStatus {
  if (cls.includes('completed')) return 'finished';
  if (cls.includes('live')) return 'live';
  return 'scheduled';
}

function parseTeam($: cheerio.CheerioAPI, td: cheerio.Cheerio<any>): {
  player1Name: string | null;
  player2Name: string | null;
  country: string | null;
  hasWinner: boolean;
} {
  const lines = td.find(PLAYER_LINE_SELECTOR);
  let player1Name: string | null = null;
  let player2Name: string | null = null;
  let country: string | null = null;
  let hasWinner = false;
  lines.each((idx, line) => {
    const $line = $(line);
    const nameSpan = $line.find(PLAYER_NAME_SELECTOR).first();
    const text = nameSpan.text().trim();
    if (!text) return;
    if (nameSpan.hasClass(WINNER_CLASS)) hasWinner = true;
    if (idx === 0) player1Name = text;
    else if (idx === 1) player2Name = text;
    if (!country) {
      const flag = $line.find('img.flags').first().attr('src');
      const m = flag?.match(/([A-Z]{3})\.jpg/);
      if (m) country = m[1] ?? null;
    }
  });
  return { player1Name, player2Name, country, hasWinner };
}

export function parseCrionetDraw(
  html: string,
  category: Category,
  drawType: DrawType
): ParsedDrawMatch[] {
  const $ = cheerio.load(html);
  const out: ParsedDrawMatch[] = [];

  $(TABLE_SELECTOR).each((_, table) => {
    const $t = $(table);
    const header = $t.find(HEADER_SELECTOR).first();
    if (header.length === 0) return;
    const headerClass = header.attr('class') ?? '';
    const status = statusFromHeaderClass(headerClass);
    const court = header.find(COURT_NAME_SELECTOR).first().text().trim() || null;
    const round = header.find(ROUND_NAME_SELECTOR).first().text().trim() || 'Unknown';

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
    const setScores = sets.length > 0 ? sets.join(' ') : null;

    const winnerTeam: 1 | 2 | null = team1.hasWinner ? 1 : team2.hasWinner ? 2 : null;

    out.push({
      category,
      drawType,
      roundLabel: round,
      drawPosition: null,
      court,
      team1Player1Name: team1.player1Name,
      team1Player2Name: team1.player2Name,
      team2Player1Name: team2.player1Name,
      team2Player2Name: team2.player2Name,
      team1Country: team1.country,
      team2Country: team2.country,
      setScores,
      winnerTeam,
      status,
    });
  });

  return out;
}
