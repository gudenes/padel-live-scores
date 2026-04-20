import * as cheerio from 'cheerio';

const TABLE_SELECTOR = 'table.w-100';
const HEADER_SELECTOR = 'tr.scorebox-header-scheduled, tr.scorebox-header-live, tr.scorebox-header-completed';
const COURT_LABEL_SELECTOR = '.court-name, .tournament-name';
const ROUND_BLOCK_SELECTOR = '.round-name';
const TEAM_ROW_SELECTOR = 'tr.draw-item-container';
const TEAM_SELECTOR = 'td.team';
const PLAYER_LINE_SELECTOR = 'div';
const PLAYER_NAME_SELECTOR = 'span';
const STATS_BUTTON_SELECTOR = 'a.open';

export type Category = 'men' | 'women';
export type OopStatus = 'scheduled' | 'live' | 'finished' | 'walkover' | 'retired';

export interface ParsedOopMatch {
  dayNumber: number;
  category: Category;
  roundLabel: string | null;
  court: string;
  scheduledLabel: string | null;
  team1Player1Name: string | null;
  team1Player2Name: string | null;
  team2Player1Name: string | null;
  team2Player2Name: string | null;
  matchWidgetId: string | null;
  status: OopStatus;
}

function statusFromHeaderClass(cls: string): OopStatus {
  if (cls.includes('completed')) return 'finished';
  if (cls.includes('live')) return 'live';
  return 'scheduled';
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

function parsePlayers($: cheerio.CheerioAPI, td: cheerio.Cheerio<any>): {
  player1: string | null;
  player2: string | null;
} {
  const lines = td.find(PLAYER_LINE_SELECTOR);
  let p1: string | null = null;
  let p2: string | null = null;
  lines.each((idx, line) => {
    const text = $(line).find(PLAYER_NAME_SELECTOR).first().text().trim();
    if (!text) return;
    if (idx === 0) p1 = text;
    else if (idx === 1) p2 = text;
  });
  return { player1: p1, player2: p2 };
}

export function parseCrionetOop(html: string, dayNumber: number): ParsedOopMatch[] {
  const $ = cheerio.load(html);
  const out: ParsedOopMatch[] = [];

  $(TABLE_SELECTOR).each((_, table) => {
    const $t = $(table);
    const header = $t.find(HEADER_SELECTOR).first();
    if (header.length === 0) return;

    const headerClass = header.attr('class') ?? '';
    const status = statusFromHeaderClass(headerClass);
    const courtLabel = header.find(COURT_LABEL_SELECTOR).first().text().trim();
    const roundBlock = header.find(ROUND_BLOCK_SELECTOR).first();
    const category = parseCategoryFromRoundBlock(roundBlock);
    if (!category) return;
    const roundLabel = parseRoundLabel(roundBlock);

    const teamRows = $t.find(TEAM_ROW_SELECTOR);
    if (teamRows.length < 2) return;
    const team1Row = teamRows.eq(0);
    const team2Row = teamRows.eq(1);
    const team1 = parsePlayers($, team1Row.find(TEAM_SELECTOR).first());
    const team2 = parsePlayers($, team2Row.find(TEAM_SELECTOR).first());

    const button = $t.find(STATS_BUTTON_SELECTOR).first();
    const matchWidgetId = button.attr('data-id') ?? null;

    out.push({
      dayNumber,
      category,
      roundLabel,
      court: courtLabel || 'Unknown',
      scheduledLabel: status === 'scheduled' ? courtLabel || null : null,
      team1Player1Name: team1.player1,
      team1Player2Name: team1.player2,
      team2Player1Name: team2.player1,
      team2Player2Name: team2.player2,
      matchWidgetId,
      status,
    });
  });

  return out;
}
