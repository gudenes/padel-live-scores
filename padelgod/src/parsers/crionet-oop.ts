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
   * 0-based position of the COURT ITSELF among all courts on this page,
   * derived from the left-to-right DOM order of `.col-lg-4` columns.
   * This is the order the tournament organizer wants the courts displayed
   * in (e.g. CBC=0, Nextensa=1, Lotto=2 at Brussels). Fan-visible UIs use
   * this to sort matches consistently: group by tournament, then by this
   * field, then by courtPosition inside the court.
   *
   * The "legacy fallback" path (no `.col-lg-4` wrapper, used only by a few
   * inline test fixtures) can't know the column order, so it emits -1.
   * Consumers treat -1 as "unknown" and fall back to alphabetical court
   * name or match-level court_order.
   */
  courtDisplayOrder: number;
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
  /**
   * Player country code as it appears in the widget's flag image
   * filename — typically a 3-letter IOC/FIP code (`INA` Indonesia,
   * `HKG` Hong Kong, `ESP` Spain, …). Stored verbatim; the public app
   * normalises to alpha-2 / emoji at render time via the existing
   * `countryFlag()` helper, which handles both alpha-3 and alpha-2.
   *
   * Null when the row's flag image has no resolvable src — happens on
   * trimmed test fixtures and on the very first widget render before
   * the static HTML has loaded. Production widgets carry the src.
   */
  team1Player1Country: string | null;
  team1Player2Country: string | null;
  team2Player1Country: string | null;
  team2Player2Country: string | null;
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

interface ParsedPlayer {
  name: string;
  /** 3-letter IOC code as captured from the flag image filename
   *  (`INA`, `HKG`, `ESP`, …). Null if the row's `<img class="flags">`
   *  has no `src` — e.g. trimmed test fixtures or pre-hydration HTML. */
  country: string | null;
}

/**
 * Match a country code out of `/images/flags/<CODE>.<ext>`. The widget
 * always uses this path layout; the only thing that varies is the
 * 2- to 4-letter IOC/FIP code and the file extension (.jpg / .png).
 *
 * Anchored at the `flags/` segment so unrelated `<img>` srcs (logos,
 * tournament banners) can't leak through.
 */
const FLAG_SRC_RE = /\/images\/flags\/([A-Za-z]{2,4})\.[A-Za-z]+/;

function countryFromFlagSrc(src: string | null | undefined): string | null {
  if (!src) return null;
  const m = src.match(FLAG_SRC_RE);
  // m[1] is non-null when m is not null (regex has a capturing group).
  return m && m[1] ? m[1].toUpperCase() : null;
}

/**
 * Pulls each player's name + country code out of one team's `<td>`.
 * Each player block looks like:
 *
 *   <div class="d-flex">
 *     <img class="flags" src="/images/flags/INA.jpg"/>
 *     <div class="ml-2">
 *       <span>A.</span><span>Hendrawan</span>
 *     </div>
 *   </div>
 *
 * We anchor on the `.ml-2` / `.ms-2` block to find names (matches the
 * pre-existing logic), then walk back to the wrapping flex row to
 * find the sibling `img.flags` for the same player. Walking from the
 * name out (rather than scanning all flag imgs in the td) keeps name
 * → country alignment intact even when the markup changes whitespace
 * or wraps the row in extra divs.
 */
function parsePlayers(
  $: cheerio.CheerioAPI,
  td: cheerio.Cheerio<any>,
): { player1: ParsedPlayer | null; player2: ParsedPlayer | null } {
  const players: ParsedPlayer[] = [];
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
    const name = parts.join(' ').trim();
    // Find the closest flex row wrapping this name block, then take
    // its `img.flags` sibling. Returns null if either the wrapper or
    // the img is absent — that's fine, country just stays null.
    const flexRow = $el.closest('.d-flex');
    const flagSrc = flexRow.find('img.flags').first().attr('src') ?? null;
    players.push({ name, country: countryFromFlagSrc(flagSrc) });
  });
  return {
    player1: players[0] ?? null,
    player2: players[1] ?? null,
  };
}

/**
 * Parse a single `<table>` match block once we already know the column's
 * real court name and the match's 0-based position within the column.
 */
function parseMatchTable(
  $: cheerio.CheerioAPI,
  $table: cheerio.Cheerio<any>,
  ctx: {
    dayNumber: number;
    court: string;
    courtPosition: number;
    courtDisplayOrder: number;
  },
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
    courtDisplayOrder: ctx.courtDisplayOrder,
    scheduledLabel,
    team1Player1Name: team1.player1?.name ?? null,
    team1Player2Name: team1.player2?.name ?? null,
    team2Player1Name: team2.player1?.name ?? null,
    team2Player2Name: team2.player2?.name ?? null,
    team1Player1Country: team1.player1?.country ?? null,
    team1Player2Country: team1.player2?.country ?? null,
    team2Player1Country: team2.player1?.country ?? null,
    team2Player2Country: team2.player2?.country ?? null,
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
        // Legacy fallback path has no column wrapper → can't know display
        // order. -1 signals "unknown" to consumers.
        courtDisplayOrder: -1,
      });
      if (m) {
        // Asymmetry from the main column-based path: when the HTML lacks
        // the `.col-lg-4` wrapper (only seen in legacy inline test fixtures
        // today), the schedule label and court name are both inside the
        // table header's `.court-name` with no way to tell them apart. The
        // old parser worked around this by nulling `scheduledLabel` for
        // non-scheduled statuses — a pre-existing test relies on that null.
        // Keep the same null here so the legacy path stays green. Remove
        // this block (and the test that needs it) once no caller exercises
        // the fallback.
        if (m.status !== 'scheduled') m.scheduledLabel = null;
        out.push(m);
      }
    });
    return out;
  }

  // Track the display index of each distinct court — columns without a
  // courtName are skipped, so we can't use the raw columns.each index
  // (would count skipped columns). Increment only when we accept a court.
  let nextCourtDisplayOrder = 0;
  columns.each((_, col) => {
    const $col = $(col);
    const courtName = $col.find(COURT_HEADER_SELECTOR).first().text().trim();
    if (!courtName) return;
    const courtDisplayOrder = nextCourtDisplayOrder++;
    $col.find(TABLE_SELECTOR).each((tableIdx, table) => {
      const m = parseMatchTable($, $(table), {
        dayNumber,
        court: courtName,
        courtPosition: tableIdx,
        courtDisplayOrder,
      });
      if (m) out.push(m);
    });
  });

  return out;
}

// ── Day-pill date extraction ───────────────────────────────────────────
//
// Crionet's OOP widget HTML starts with a sticky day-selector strip:
//
//   <div class="day-selector">
//     <a href="/screen/oopbyday/FIP-2026-1812/1?t=tol">
//       <div class="play-day-button mb-3">
//         <span class="play-day-date">APR 29</span>
//         <div class="play-day-week">WED</div>
//       </div>
//     </a>
//     <a href="/screen/oopbyday/FIP-2026-1812/2?t=tol">
//       <div class="play-day-button active mb-3">     ← active = the day we fetched
//         <span class="play-day-date">APR 30</span>
//         ...
//
// This is the authoritative source for "Day N → calendar date" — it's
// what the widget itself renders to fans and operators. Independent of
// `tournaments.starts_at`, which we've seen drift.
//
// The pills carry month + day, never year. For year inference we accept
// a "now" timestamp from the caller (typically the scrape time) and
// snap to the closest year — handles year-boundary scrapes (e.g.
// fetching a December tournament on Jan 2nd) without special-casing.

const MONTH_BY_ABBR: Readonly<Record<string, number>> = Object.freeze({
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
});

/**
 * Pull the active day-pill's calendar date from the OOP HTML.
 *
 * Returns `YYYY-MM-DD` or null when:
 * - the day selector isn't in the HTML (legacy / stripped fixtures)
 * - no pill is marked `active` (HTML mid-update — degrade gracefully)
 * - the pill text doesn't parse as `MMM D` / `MMM DD`
 *
 * `now` is used purely for year inference. Caller passes a Date —
 * typically the scrape's captured-at — and we snap the parsed (month,
 * day) onto whichever year (now-1, now, now+1) is closest. This
 * handles the rare year-boundary case (December tournament fetched in
 * early January) without forcing the caller to know.
 */
export function parseOopDayDate(
  html: string,
  now: Date,
): string | null {
  const $ = cheerio.load(html);
  const $active = $('.play-day-button.active').first();
  if ($active.length === 0) return null;
  const text = $active.find('.play-day-date').first().text().trim();
  if (!text) return null;

  const match = /^([A-Z]{3})\s+(\d{1,2})$/i.exec(text);
  if (!match) return null;
  const [, monthAbbr, dayStr] = match;
  const month = MONTH_BY_ABBR[monthAbbr!.toUpperCase()];
  if (!month) return null;
  const day = Number(dayStr);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;

  // Year snap: pick whichever of {now-1, now, now+1} produces the
  // smallest absolute distance from `now`. Ties prefer the current
  // year. Cheap; only 3 candidates to compare.
  const nowMs = now.getTime();
  let bestYear = now.getUTCFullYear();
  let bestDist = Number.POSITIVE_INFINITY;
  for (const candYear of [bestYear - 1, bestYear, bestYear + 1]) {
    const candMs = Date.UTC(candYear, month - 1, day);
    const dist = Math.abs(candMs - nowMs);
    if (dist < bestDist) {
      bestDist = dist;
      bestYear = candYear;
    }
  }

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${bestYear}-${mm}-${dd}`;
}
