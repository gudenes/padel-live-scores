import * as cheerio from 'cheerio';

/**
 * Parser for the FIP event-page draw AJAX response.
 *
 * Context
 * -------
 * The padelfip.com event page (e.g. /es/events/brussels-p2-2026/?tab=Cuadros)
 * loads draw data asynchronously via `POST /wp-admin/admin-ajax.php` with
 * `action=handle_ajax_request`. The response is a JSON blob:
 *
 *   { error: 200, html: '…rendered bracket HTML…', pdf: '<download url>', drawType: 'MD' }
 *
 * The `html` field is the entire bracket for ONE draw type (MD/WD/MQ/WQ).
 * Compared to the Crionet draw widget (widget.matchscorerlive.com/screen/draw/…),
 * this payload has three critical advantages for the linker use case:
 *
 *   1. EVERY bracket slot present — including future rounds (QF/SF/F) whose
 *      teams are still TBD. Crionet only shows matches once they're
 *      scheduled/live/finished, so QFs are invisible until ~3 days in.
 *   2. `data-match-id="MD004"` on every singleMatch div. This is the SAME
 *      widget ID Crionet exposes via `data-id` on the stats button in the
 *      tournamentlive/results widgets. It's the deterministic join key we
 *      were missing.
 *   3. `data-single-team="P000456"` — FIP's stable pair/team identifier.
 *      Useful for cross-tournament player-pair recognition.
 *
 * HTML structure (per match)
 * --------------------------
 * <div class="colDraw {sedicesimidifinale|ottavidifinale|quartidifinale|semifinale|finale}"
 *      data-round="{16|8|4|2|1}" data-index-round="0">
 *   <div class="singleMatch--box">
 *     <div class="singleMatch" data-match-id="MD004">
 *       <div class="singleMatch__team" data-single-team="P000123">
 *         <div class="singleMatch__team--wrap">
 *           <div class="singleMatch__team--item">
 *             <img src=".../Spain_Fip.jpg" class="singleMatch__team--itemFlag"/>
 *             <p class="singleMatch__team--itemName">Player Name</p>
 *           </div>
 *           <div class="singleMatch__team--item">…second player…</div>
 *         </div>
 *         <div class="additionalInfo">
 *           <small>(1)&nbsp;</small>      ← seed (optional; numeric or Q/WC)
 *           <span>&#10003;</span>         ← check-mark → winner
 *         </div>
 *         <div class="singleMatch__tableSets">
 *           <div class="singleMatch__tableSet tableItem--first {lostSet?}">6</div>
 *           <div class="singleMatch__tableSet tableItem--last {lostSet?}">4</div>
 *         </div>
 *       </div>
 *       <div class="singleMatch__team" data-single-team="P000456">…team 2…</div>
 *     </div>
 *   </div>
 * </div>
 *
 * Byes: a team slot with a numeric data-single-team (not starting with P) and
 * both names = "Bye". Surfaced with `isBye` flags so the caller can skip
 * writing them into tournament_draws if it wants.
 *
 * Round mapping
 * -------------
 *   data-round="16" → R32 (sedicesimi, 16 matches → round of 32 teams)
 *   data-round="8"  → R16 (ottavi)
 *   data-round="4"  → QF
 *   data-round="2"  → SF
 *   data-round="1"  → F
 */

export type Category = 'men' | 'women';
export type DrawType = 'main_draw' | 'qualifying';
export type DrawStatus = 'scheduled' | 'live' | 'finished' | 'walkover' | 'retired';

export type DrawCode = 'MD' | 'WD' | 'MQ' | 'WQ';

/**
 * Map draw code from the AJAX response → (category, drawType).
 */
export function categoryAndTypeFromDrawCode(code: DrawCode): {
  category: Category;
  drawType: DrawType;
} {
  const category: Category = code.startsWith('M') ? 'men' : 'women';
  const drawType: DrawType = code.endsWith('D') ? 'main_draw' : 'qualifying';
  return { category, drawType };
}

/**
 * Round label derived from `data-round` (= match count in that round).
 * FIP's Italian class names (sedicesimidifinale / ottavidifinale / …) are
 * normalized to our canonical English labels.
 */
export function roundLabelFromMatchCount(matchCount: number): string {
  switch (matchCount) {
    case 16:
      return 'R32';
    case 8:
      return 'R16';
    case 4:
      return 'QF';
    case 2:
      return 'SF';
    case 1:
      return 'F';
    default:
      // Qualifiers can have arbitrary round sizes (e.g. Q1, Q2, Q3).
      // Fall back to a 1-indexed Rxx label built from the team count.
      return `R${matchCount * 2}`;
  }
}

export interface ParsedFipDrawTeam {
  /** FIP `data-single-team` value. Starts with "P" for real teams, numeric for Byes. */
  fipTeamId: string | null;
  player1Name: string | null;
  player2Name: string | null;
  country: string | null; // raw FIP country (e.g. 'Spain'); parser doesn't normalize
  seed: number | null;
  marker: 'Q' | 'WC' | 'LL' | null;
  hasWinnerMark: boolean;
  /** Array of game counts per set (loser's cell flagged by lostSet). Length = sets played. */
  setGames: number[];
  isBye: boolean;
}

export interface ParsedFipDrawMatch {
  matchWidgetId: string;
  roundLabel: string;
  drawPosition: number;
  team1: ParsedFipDrawTeam;
  team2: ParsedFipDrawTeam;
  setScores: string | null;
  winnerTeam: 1 | 2 | null;
  status: DrawStatus;
}

/**
 * Parse the `html` field from a `/wp-admin/admin-ajax.php?action=handle_ajax_request`
 * response, plus the drawType code (from the same response), into structured match rows.
 */
export function parseFipEventDraw(
  html: string,
  drawType?: 'main_draw' | 'qualifying'
): ParsedFipDrawMatch[] {
  const $ = cheerio.load(html);
  const out: ParsedFipDrawMatch[] = [];

  // Qualifying draws don't have main-draw round semantics — an 8-match round
  // in the women's qualifier is "Q1" (first qualifying round in a 2-round
  // draw), not "R16". Number of qualifying rounds varies by tournament:
  // women's at Asuncion has 2 rounds (8→4), men's has 3 (16→8→4). So we
  // can't statically map matchCount → Q-label; we have to look at all the
  // round columns present and assign Q1 to the largest, Q2 to the next, etc.
  // Without this, the populator writes main-draw labels (R16/R32/QF) onto
  // qualifying matches and the UI shows confusing round names.
  let qLabelByCount: Map<number, string> | null = null;
  if (drawType === 'qualifying') {
    const counts = new Set<number>();
    $('.colDraw').each((_, col) => {
      const mc = parseInt($(col).attr('data-round') ?? '', 10);
      if (Number.isFinite(mc) && mc > 0) counts.add(mc);
    });
    const sortedDesc = [...counts].sort((a, b) => b - a);
    qLabelByCount = new Map(sortedDesc.map((c, i) => [c, `Q${i + 1}`]));
  }

  // Iterate each round column. `data-round` gives us the round size; we track
  // a draw_position counter per round so the output is self-consistent even
  // when rounds appear out of DOM order (they shouldn't, but belt + braces).
  let globalPosition = 0;

  $('.colDraw').each((_, col) => {
    const $col = $(col);
    const matchCount = parseInt($col.attr('data-round') ?? '', 10);
    if (!Number.isFinite(matchCount) || matchCount <= 0) return;
    const roundLabel =
      qLabelByCount?.get(matchCount) ?? roundLabelFromMatchCount(matchCount);

    $col.find('.singleMatch').each((_idx, m) => {
      const $m = $(m);
      const matchWidgetId = ($m.attr('data-match-id') ?? '').trim();
      if (!matchWidgetId) return;

      const teams = $m.find('.singleMatch__team');
      if (teams.length < 2) return;
      const team1 = parseTeam($, teams.eq(0));
      const team2 = parseTeam($, teams.eq(1));

      const { setScores, winnerTeam, status } = resolveMatchState(team1, team2);

      globalPosition += 1;
      out.push({
        matchWidgetId,
        roundLabel,
        drawPosition: globalPosition,
        team1,
        team2,
        setScores,
        winnerTeam,
        status,
      });
    });
  });

  return out;
}

// ─── team parsing ───────────────────────────────────────────────────────────

function parseTeam($: cheerio.CheerioAPI, $team: cheerio.Cheerio<any>): ParsedFipDrawTeam {
  const fipTeamId = ($team.attr('data-single-team') ?? '').trim() || null;

  const nameEls = $team.find('.singleMatch__team--itemName');
  const player1Raw = nameEls.eq(0).text().trim() || null;
  const player2Raw = nameEls.eq(1).text().trim() || null;

  // Byes: both names = "Bye". data-single-team is also non-"P" numeric for byes.
  const isBye =
    (player1Raw?.toLowerCase() === 'bye' && player2Raw?.toLowerCase() === 'bye') ||
    player1Raw === null;

  // Country: extract from the first flag's src (".../Spain_Fip.jpg"). FIP
  // uses English country names with occasional concatenation ("TheNetherlands").
  // We return the raw name — normalization to alpha-2 happens at the write
  // boundary in the worker (same pattern as the Crionet parser).
  const flagSrc = $team.find('.singleMatch__team--itemFlag').first().attr('src') ?? '';
  const flagMatch = flagSrc.match(/\/([A-Za-z]+)_Fip\.(?:jpg|png|svg)/i);
  const country = flagMatch?.[1] ?? null;

  // additionalInfo: seed (numeric like "(3)") + markers ("(Q)", "(WC)", "(LL)")
  // + winner mark (HTML entity &#10003; = ✓).
  const $info = $team.find('.additionalInfo').first();
  const infoHtml = $info.html() ?? '';
  const infoText = $info.text();

  let seed: number | null = null;
  let marker: 'Q' | 'WC' | 'LL' | null = null;
  const seedMatch = infoText.match(/\((\d+)\)/);
  if (seedMatch?.[1]) seed = parseInt(seedMatch[1], 10);
  const markerMatch = infoText.match(/\((Q|WC|LL)\)/);
  if (markerMatch?.[1]) marker = markerMatch[1] as 'Q' | 'WC' | 'LL';

  const hasWinnerMark =
    infoHtml.includes('&#10003;') ||
    infoHtml.includes('&#x2713;') ||
    infoHtml.includes('\u2713') ||
    $info.find('span').toArray().some((s) => $(s).text().includes('\u2713'));

  // Set scores: per-set <div class="singleMatch__tableSet"> with numeric text.
  // Empty = no set played. lostSet marks the loser's cell (informational; we
  // infer winner from additionalInfo ✓, not from the set cell alone).
  const setGames: number[] = [];
  $team.find('.singleMatch__tableSet').each((_, el) => {
    const raw = $(el).text().trim();
    // Strip any nested <sup>N</sup> tiebreak count before parseInt — it'd
    // otherwise make "7[3]" parse as 73.
    const cleaned = raw.replace(/\s+/g, '');
    const n = parseInt(cleaned, 10);
    if (Number.isFinite(n)) setGames.push(n);
  });

  return {
    fipTeamId,
    player1Name: isBye ? null : player1Raw,
    player2Name: isBye ? null : player2Raw,
    country: isBye ? null : country,
    seed,
    marker,
    hasWinnerMark,
    setGames,
    isBye,
  };
}

// ─── match-level aggregation ────────────────────────────────────────────────

function resolveMatchState(
  team1: ParsedFipDrawTeam,
  team2: ParsedFipDrawTeam
): {
  setScores: string | null;
  winnerTeam: 1 | 2 | null;
  status: DrawStatus;
} {
  // If either team is a Bye, the real team "wins" by walkover — surface that.
  if (team1.isBye && !team2.isBye) {
    return { setScores: null, winnerTeam: 2, status: 'walkover' };
  }
  if (team2.isBye && !team1.isBye) {
    return { setScores: null, winnerTeam: 1, status: 'walkover' };
  }
  if (team1.isBye && team2.isBye) {
    // Both Byes — a placeholder slot for future rounds. Not actionable.
    return { setScores: null, winnerTeam: null, status: 'scheduled' };
  }

  // Build set scores by pairing cells in order. If both sides have 0 set
  // cells the match is scheduled; if only one side has scores the data is
  // malformed — treat as scheduled.
  const pairCount = Math.min(team1.setGames.length, team2.setGames.length);
  const setScoreParts: string[] = [];
  for (let i = 0; i < pairCount; i++) {
    const a = team1.setGames[i]!;
    const b = team2.setGames[i]!;
    setScoreParts.push(`${a}-${b}`);
  }
  const setScores = setScoreParts.length > 0 ? setScoreParts.join(' ') : null;

  let winnerTeam: 1 | 2 | null = null;
  if (team1.hasWinnerMark && !team2.hasWinnerMark) winnerTeam = 1;
  else if (team2.hasWinnerMark && !team1.hasWinnerMark) winnerTeam = 2;

  const status: DrawStatus = winnerTeam !== null ? 'finished' : 'scheduled';

  return { setScores, winnerTeam, status };
}
