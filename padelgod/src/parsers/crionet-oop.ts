import * as cheerio from 'cheerio';

const COLUMN_SELECTOR = 'div.col-lg-4';
const COURT_HEADER_SELECTOR = '.schedule-header .oop-court';
const TABLE_SELECTOR = 'table.w-100';
const HEADER_SELECTOR =
  'tr.scorebox-header-scheduled, tr.scorebox-header-live, tr.scorebox-header-completed';
const SCHEDULE_LABEL_SELECTOR = '.court-name, .tournament-name';
const ROUND_BLOCK_SELECTOR = '.round-name';
const TEAM_ROW_SELECTOR = 'tr:has(td.team)';
const TEAM_SELECTOR = 'td.team';
const STATS_BUTTON_SELECTOR = 'a.open';

export type Category = 'men' | 'women';
export type OopStatus =
  | 'scheduled'
  | 'live'
  | 'finished'
  | 'walkover'
  | 'retired';

export interface ParsedOopMatch {
  dayNumber: number;
  category: Category;
  roundLabel: string | null;
  /** Real court name from .schedule-header .oop-court (e.g. "COURT CBC"). */
  court: string;
  /**
   * 0-based position of this match within its court's play order, derived
   * from document order of `<table>` siblings inside the column. Required
   * for chaining start-times across a court's timeline.
   */
  courtPosition: number;
  /**
   * Free-form schedule label from the table header — "Starting at 11:00 AM",
   * "Followed by", "Not before 6:00 PM". Null if the header has no label
   * text (e.g. partial/malformed row).
   */
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

function parseCategoryFromRoundBlock(
  $block: cheerio.Cheerio<any>,
): Category | null {
  const text = $block.text().trim().toLowerCase();
  if (text.startsWith('men')) return 'men';
  if (text.startsWith('women')) return 'women';
  return null;
}

function parseRoundLabel($block: cheerio.Cheerio<any>): string | null {
  const inner = $block.find('div').first().text().trim();
  return inner || null;
}

function parsePlayers(
  $: cheerio.CheerioAPI,
  td: cheerio.Cheerio<any>,
): { player1: string | null; player2: string | null } {
  const playerNames: string[] = [];
  td.find('div').each((_, el) => {
    const $el = $(el);
    const cls = $el.attr('class') ?? '';
    if (!/(?:^|\s)(?:ml-2|ms-2)(?:\s|$)/.test(cls)) return;
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

/**
 * Parse a single `<table>` match block once we already know the column's
 * real court name and the match's 0-based position within the column.
 */
function parseMatchTable(
  $: cheerio.CheerioAPI,
  $table: cheerio.Cheerio<any>,
  ctx: { dayNumber: number; court: string; courtPosition: number },
): ParsedOopMatch | null {
  const header = $table.find(HEADER_SELECTOR).first();
  if (header.length === 0) return null;

  const headerClass = header.attr('class') ?? '';
  const status = statusFromHeaderClass(headerClass);

  const scheduledLabel =
    header.find(SCHEDULE_LABEL_SELECTOR).first().text().trim() || null;

  const roundBlock = header.find(ROUND_BLOCK_SELECTOR).first();
  const category = parseCategoryFromRoundBlock(roundBlock);
  if (!category) return null;
  const roundLabel = parseRoundLabel(roundBlock);

  const teamRows = $table.find(TEAM_ROW_SELECTOR);
  if (teamRows.length < 2) return null;
  const team1 = parsePlayers($, teamRows.eq(0).find(TEAM_SELECTOR).first());
  const team2 = parsePlayers($, teamRows.eq(1).find(TEAM_SELECTOR).first());

  const button = $table.find(STATS_BUTTON_SELECTOR).first();
  const matchWidgetId = button.attr('data-id') ?? null;

  return {
    dayNumber: ctx.dayNumber,
    category,
    roundLabel,
    court: ctx.court,
    courtPosition: ctx.courtPosition,
    scheduledLabel,
    team1Player1Name: team1.player1,
    team1Player2Name: team1.player2,
    team2Player1Name: team2.player1,
    team2Player2Name: team2.player2,
    matchWidgetId,
    status,
  };
}

export function parseCrionetOop(
  html: string,
  dayNumber: number,
): ParsedOopMatch[] {
  const $ = cheerio.load(html);
  const out: ParsedOopMatch[] = [];

  const columns = $(COLUMN_SELECTOR);

  if (columns.length === 0) {
    // Legacy / minimal-fixture fallback: no column wrapper, just bare
    // tables. Preserves behaviour for inline test fixtures that don't wrap
    // tables in .col-lg-4. In this mode we can't know the real court or an
    // accurate position, so we use the schedule-label text as the court
    // (old behaviour) and set courtPosition to the table's index in
    // document order.
    $(TABLE_SELECTOR).each((tableIdx, table) => {
      const $t = $(table);
      const label =
        $t
          .find(HEADER_SELECTOR)
          .first()
          .find(SCHEDULE_LABEL_SELECTOR)
          .first()
          .text()
          .trim() || 'Unknown';
      const m = parseMatchTable($, $t, {
        dayNumber,
        court: label,
        courtPosition: tableIdx,
      });
      if (m) {
        // Legacy: preserve old behaviour — scheduledLabel is null for
        // non-scheduled statuses (live, finished).
        if (m.status !== 'scheduled') m.scheduledLabel = null;
        out.push(m);
      }
    });
    return out;
  }

  columns.each((_, col) => {
    const $col = $(col);
    const courtName = $col.find(COURT_HEADER_SELECTOR).first().text().trim();
    if (!courtName) return;
    $col.find(TABLE_SELECTOR).each((tableIdx, table) => {
      const m = parseMatchTable($, $(table), {
        dayNumber,
        court: courtName,
        courtPosition: tableIdx,
      });
      if (m) out.push(m);
    });
  });

  return out;
}
