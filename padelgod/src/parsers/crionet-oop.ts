import * as cheerio from 'cheerio';

const TABLE_SELECTOR = 'table.w-100';
const HEADER_SELECTOR = 'tr.scorebox-header-scheduled, tr.scorebox-header-live, tr.scorebox-header-completed';
const COURT_LABEL_SELECTOR = '.court-name, .tournament-name';
const ROUND_BLOCK_SELECTOR = '.round-name';
// Match any tr containing a td.team. Production markup uses
// `tr.scorebox-sep-bottom` for team 1 and a bare `<tr>` for team 2
// (no .draw-item-container class). Both still carry td.team.
const TEAM_ROW_SELECTOR = 'tr:has(td.team)';
const TEAM_SELECTOR = 'td.team';
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

/**
 * Extract player names from a team <td>.
 *
 * Real HTML structure (from Crionet/matchscorerlive.com):
 *   Each player line is a div.d-flex.align-items-center containing:
 *     - a flag <img class="flags">
 *     - a name div with class "ml-2" (optionally + "line-thin")
 *       containing TWO spans: initial (e.g. "M.") + surname (e.g. "Sintes")
 *
 * OOP rows don't have winner markers — they're scheduled/live matches.
 */
function parsePlayers($: cheerio.CheerioAPI, td: cheerio.Cheerio<any>): {
  player1: string | null;
  player2: string | null;
} {
  const playerNames: string[] = [];

  td.find('div').each((_, el) => {
    const $el = $(el);
    const cls = $el.attr('class') ?? '';
    // Match the name container: must have ml-2 or ms-2
    if (!/(?:^|\s)(?:ml-2|ms-2)(?:\s|$)/.test(cls)) return;

    // Must contain at least one direct span
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
  };
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
