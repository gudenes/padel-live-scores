import * as cheerio from 'cheerio';
import { normalizeCountry } from '../lib/country.js';

const TABLE_SELECTOR = 'table.w-100';
const HEADER_SELECTOR = 'tr.scorebox-header-completed, tr.scorebox-header-live, tr.scorebox-header-scheduled';
const COURT_NAME_SELECTOR = '.court-name';
const ROUND_NAME_SELECTOR = '.round-name';
const TEAM_ROW_SELECTOR = 'tr.draw-item-container';
const TEAM_SELECTOR = 'td.team';
const SET_SELECTOR = 'td.set';

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

/**
 * Extract player names and winner status from a team <td>.
 *
 * Real HTML structure (from Crionet/matchscorerlive.com):
 *   <td class="team">
 *     <div class="d-flex justify-content-between align-items-center ml-2">
 *       <div>
 *         <div class="player-names"><div class="double">
 *           <div class="d-flex align-items-center">
 *             <div><img class="flags" src="/images/flags/ESP.jpg"/></div>
 *             <div class="ml-2  line-thin"><span>I.</span><span>Sager</span></div>
 *           </div>
 *           <div class="d-flex align-items-center">
 *             <div><img class="flags" src="/images/flags/ESP.jpg"/></div>
 *             <div class="ml-2 winner line-thin"><span>M.</span><span>Ortega</span><small>(1)</small></div>
 *           </div>
 *         </div></div>
 *       </div>
 *       <div class="mr-2"><i class='fa-solid fa-check check-primary'></i></div>
 *     </div>
 *   </td>
 *
 * Key observations:
 *   1. Each player has a name div with class "ml-2" (and optionally "winner", "line-thin").
 *   2. Inside that div: two spans — initial (e.g. "I.") + surname (e.g. "Sager").
 *   3. Winner indicated by "winner" class on that name div OR fa-check anywhere in the td.
 *   4. Country from the flag <img> immediately before the name div.
 */
function parseTeam($: cheerio.CheerioAPI, td: cheerio.Cheerio<any>): {
  player1Name: string | null;
  player2Name: string | null;
  country: string | null;
  hasWinner: boolean;
} {
  // Winner check: fa-check icon or "winner" class anywhere in the td
  const hasWinner = td.html()?.includes('fa-check') === true ||
    td.find('[class*="winner"]').length > 0;

  // Find all name divs: divs that contain class "ml-2" or "ms-2"
  // These are the per-player name containers
  const playerNames: string[] = [];
  let country: string | null = null;

  td.find('div').each((_, el) => {
    const $el = $(el);
    const cls = $el.attr('class') ?? '';
    // Match the name container: must have ml-2 or ms-2 in class
    if (!/(?:^|\s)(?:ml-2|ms-2)(?:\s|$)/.test(cls)) return;

    // Must contain at least one span to be a player name div
    const spans = $el.find('> span');
    if (spans.length === 0) return;

    // Build name from spans: "I." + "Sager" → "I. Sager"
    const parts: string[] = [];
    spans.each((_, span) => {
      const text = $(span).text().trim();
      if (text) parts.push(text);
    });
    if (parts.length === 0) return;

    // Format: "I." + " " + "Sager" but avoid double spaces
    const name = parts.join(' ').trim();
    playerNames.push(name);

    // Country from preceding flag image (sibling div contains the flag img)
    if (country === null) {
      const parentRow = $el.parent(); // d-flex align-items-center row
      const flagImg = parentRow.find('img.flags').first();
      if (flagImg.length > 0) {
        const src = flagImg.attr('src') ?? '';
        const m = src.match(/\/([A-Z]{2,3})\.(?:jpg|png|svg)/i);
        // Normalize Crionet's alpha-3 (ESP) to our canonical alpha-2 (ES).
        // See `lib/country.ts` for the mapping + rationale.
        country = normalizeCountry(m?.[1] ?? null);
      }
    }
  });

  return {
    player1Name: playerNames[0] ?? null,
    player2Name: playerNames[1] ?? null,
    country,
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
  // Remove <sup> before reading game count so it doesn't pollute the text
  sup.remove();
  const games = td.text().trim();
  return { games, tb: isNaN(tb as number) ? null : tb };
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
    const setScores = sets.length > 0 ? sets.join(' ') : null;

    let winnerTeam: 1 | 2 | null = null;
    if (status === 'finished') {
      if (team1.hasWinner && !team2.hasWinner) winnerTeam = 1;
      else if (team2.hasWinner && !team1.hasWinner) winnerTeam = 2;
    }

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
