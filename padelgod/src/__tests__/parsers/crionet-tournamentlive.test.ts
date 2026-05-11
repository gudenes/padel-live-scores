import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseCrionetTournamentLive } from '../../parsers/crionet-tournamentlive.js';

// Minimal single-match live block. Mirrors real widget.matchscorerlive.com HTML.
const SINGLE_LIVE_MATCH_HTML = `
<html><body>
<table class="w-100 mb-3">
  <tr class="scorebox-header-live">
    <th class="text-left">
      <span class="tournament-name"><span>COURT CBC</span></span>
    </th>
    <th colspan="4" class="round-name text-right">
      <small><b>Men </b><div>R32</div></small>
    </th>
  </tr>
  <tr class="scorebox-sep-bottom">
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg"/></div>
              <div class="ml-2 line-thin"><span>M.</span><span>Sintes Villalonga</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ARG.jpg"/></div>
              <div class="ml-2 line-thin"><span>F.</span><span>Gonzalez</span><small class="separator">(3)</small></div>
            </div>
          </div></div>
        </div>
        <div>
          <img src='/images/ballg.png' class='ballg'/>
        </div>
      </div>
    </td>
    <td class="points"><div>30</div></td>
    <td class="set">1</td>
    <td class="set set-lost">-</td>
    <td class="set set-lost">-</td>
  </tr>
  <tr>
    <td class="team" style="width:50%">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ITA.jpg"/></div>
              <div class="ml-2 line-thin"><span>A.</span><span>Rossi</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/FRA.jpg"/></div>
              <div class="ml-2 line-thin"><span>L.</span><span>Dupont</span></div>
            </div>
          </div></div>
        </div>
        <div></div>
      </div>
    </td>
    <td class="points"><div>15</div></td>
    <td class="set">0</td>
    <td class="set set-lost">-</td>
    <td class="set set-lost">-</td>
  </tr>
  <tr class="summary">
    <td colspan="8">
      <div class="live-status-summary d-flex justify-content-between align-items-center">
        <div>
          <span>&#128337;</span>
          <span>00:03</span>
          <span class="ml-4">Live match</span>
        </div>
        <a class="open" data-toggle="modal" data-target="#modalStats" data-id="MQ012" data-year="2026" data-tid="1701" data-org="FIP">MATCH STATS</a>
      </div>
    </td>
  </tr>
</table>
</body></html>
`;

describe('parseCrionetTournamentLive', () => {
  it('parses one live match block with players, points, set games, server indicator', () => {
    const result = parseCrionetTournamentLive(SINGLE_LIVE_MATCH_HTML);
    expect(result.matches).toHaveLength(1);
    const m = result.matches[0];

    expect(m.matchWidgetId).toBe('MQ012');
    expect(m.court).toBe('COURT CBC');
    expect(m.roundLabel).toBe('R32');
    expect(m.category).toBe('men');
    expect(m.status).toBe('live');
    expect(m.durationMinutes).toBe(3);

    // Team 1
    expect(m.team1.player1Name).toBe('M. Sintes Villalonga');
    expect(m.team1.player2Name).toBe('F. Gonzalez');
    // Parser normalizes Crionet's alpha-3 to our canonical alpha-2.
    expect(m.team1.player1Country).toBe('ES');
    expect(m.team1.player2Country).toBe('AR');
    expect(m.team1.player2Seed).toBe(3);
    expect(m.team1.player1Seed).toBeNull();
    expect(m.team1.currentPoints).toBe('30');
    expect(m.team1.setGames).toEqual(['1', '-', '-']);
    expect(m.team1.setTiebreaks).toEqual([null, null, null]);

    // Team 2
    expect(m.team2.player1Name).toBe('A. Rossi');
    expect(m.team2.player2Name).toBe('L. Dupont');
    expect(m.team2.player1Country).toBe('IT');
    expect(m.team2.player2Country).toBe('FR');
    expect(m.team2.currentPoints).toBe('15');
    expect(m.team2.setGames).toEqual(['0', '-', '-']);

    // Server indicator in team1's row only
    expect(m.servingTeam).toBe(1);
  });

  it('parses set with tiebreak (7<sup>3</sup> → tiebreak=3)', () => {
    const html = `
<table class="w-100">
  <tr class="scorebox-header-live">
    <th><span class="tournament-name"><span>COURT A</span></span></th>
    <th class="round-name"><small><b>Women </b><div>SF</div></small></th>
  </tr>
  <tr>
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg"/></div>
              <div class="ml-2"><span>A.</span><span>Lopez</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/ESP.jpg"/></div>
              <div class="ml-2"><span>B.</span><span>Torres</span></div>
            </div>
          </div></div>
        </div>
        <div></div>
      </div>
    </td>
    <td class="points"><div>0</div></td>
    <td class="set">6</td>
    <td class="set set-completed set-lost">7<sup>5</sup></td>
    <td class="set">0</td>
  </tr>
  <tr>
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/BEL.jpg"/></div>
              <div class="ml-2"><span>C.</span><span>Martin</span></div>
            </div>
            <div class="d-flex align-items-center">
              <div><img class="flags" src="/images/flags/BEL.jpg"/></div>
              <div class="ml-2"><span>D.</span><span>Smith</span></div>
            </div>
          </div></div>
        </div>
        <div></div>
      </div>
    </td>
    <td class="points"><div>0</div></td>
    <td class="set set-completed set-lost">7<sup>3</sup></td>
    <td class="set">6</td>
    <td class="set">0</td>
  </tr>
  <tr class="summary">
    <td colspan="8">
      <span>&#128337;</span>
      <span>01:30</span>
      <a class="open" data-id="WS001" data-year="2026" data-tid="1">STATS</a>
    </td>
  </tr>
</table>
`;
    const result = parseCrionetTournamentLive(html);
    expect(result.matches).toHaveLength(1);
    const m = result.matches[0];
    // Set 1: team1=6, team2=7(tb3) — team2 won TB with team1 scoring 3
    expect(m.team1.setGames).toEqual(['6', '7', '0']);
    expect(m.team1.setTiebreaks).toEqual([null, 5, null]);
    expect(m.team2.setGames).toEqual(['7', '6', '0']);
    expect(m.team2.setTiebreaks).toEqual([3, null, null]);
  });

  it('returns empty array for a tournamentlive page with no live matches', () => {
    const htmlEmpty = '<html><body><div>No live matches right now.</div></body></html>';
    expect(parseCrionetTournamentLive(htmlEmpty).matches).toEqual([]);

    // Also: a completed match (no scorebox-header-live) should not appear.
    const htmlCompleted = `
<table class="w-100">
  <tr class="scorebox-header">
    <th><span class="tournament-name"><span>COURT X</span></span></th>
    <th class="round-name"><small><b>Men </b><div>F</div></small></th>
  </tr>
  <tr>
    <td class="team"><div class="player-names"><div class="double">
      <div class="d-flex align-items-center">
        <div><img class="flags" src="/images/flags/ESP.jpg"/></div>
        <div class="ml-2"><span>X.</span><span>Y</span></div>
      </div>
      <div class="d-flex align-items-center">
        <div><img class="flags" src="/images/flags/ESP.jpg"/></div>
        <div class="ml-2"><span>Z.</span><span>W</span></div>
      </div>
    </div></div></td>
    <td></td>
    <td class="set">6</td><td class="set">6</td><td class="set">-</td>
  </tr>
</table>
`;
    expect(parseCrionetTournamentLive(htmlCompleted).matches).toEqual([]);
  });

  it('detects servingTeam=2 when ballg.png is in team 2 row only', () => {
    // Same base structure as the single-live fixture, but ballg moved to team 2.
    const html = SINGLE_LIVE_MATCH_HTML
      // Remove ballg from team 1
      .replace("<img src='/images/ballg.png' class='ballg'/>", '')
      // Add it to team 2's right-hand div
      .replace(
        '<td class="team" style="width:50%">',
        '<td class="team" style="width:50%">'
      )
      // Inject ballg into team 2's mr-2 div (the second empty <div></div>)
      .replace(
        /<td class="points"><div>15<\/div><\/td>\s*<td class="set">0<\/td>/,
        (_match) => _match
      );
    // Simpler: just build a dedicated small HTML for team 2 serving
    const html2 = `
<table class="w-100">
  <tr class="scorebox-header-live">
    <th><span class="tournament-name"><span>COURT B</span></span></th>
    <th class="round-name"><small><b>Men </b><div>QF</div></small></th>
  </tr>
  <tr>
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center"><div><img class="flags" src="/images/flags/ESP.jpg"/></div><div class="ml-2"><span>A.</span><span>One</span></div></div>
            <div class="d-flex align-items-center"><div><img class="flags" src="/images/flags/ESP.jpg"/></div><div class="ml-2"><span>B.</span><span>Two</span></div></div>
          </div></div>
        </div>
        <div></div>
      </div>
    </td>
    <td class="points"><div>15</div></td>
    <td class="set">3</td>
  </tr>
  <tr>
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div>
          <div class="player-names"><div class="double">
            <div class="d-flex align-items-center"><div><img class="flags" src="/images/flags/ARG.jpg"/></div><div class="ml-2"><span>C.</span><span>Three</span></div></div>
            <div class="d-flex align-items-center"><div><img class="flags" src="/images/flags/ARG.jpg"/></div><div class="ml-2"><span>D.</span><span>Four</span></div></div>
          </div></div>
        </div>
        <div><img src='/images/ballg.png' class='ballg'/></div>
      </div>
    </td>
    <td class="points"><div>AD</div></td>
    <td class="set">4</td>
  </tr>
  <tr class="summary">
    <td colspan="8">
      <span>&#128337;</span><span>00:42</span>
      <a class="open" data-id="MS007" data-year="2026" data-tid="1">STATS</a>
    </td>
  </tr>
</table>
`;
    const result = parseCrionetTournamentLive(html2);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].servingTeam).toBe(2);
    expect(result.matches[0].team2.currentPoints).toBe('AD');
    // Use html to avoid unused-variable warning (it's a stepping-stone, the real assertion uses html2).
    expect(typeof html).toBe('string');
  });

  it('parses the real Brussels P2 production fixture — 2 live + 1 completed', () => {
    const fixturePath = join(__dirname, '../fixtures/crionet-tournamentlive-brussels.html');
    const html = readFileSync(fixturePath, 'utf-8');
    const result = parseCrionetTournamentLive(html);

    // Fixture has 3 match blocks: 2 live (WQ008, WQ009) + 1 completed (WQ014).
    // Prior to 2026-04-23 the parser's header selector was `scorebox-header-live`
    // only, which filtered out the completed row. Widened to also accept the
    // bare `scorebox-header` so completed matches surface with status='finished',
    // letting live-poller's close-on-finish branch fire within one poll tick
    // instead of waiting for the match to disappear from the widget.
    expect(result.matches).toHaveLength(3);
    const ids = result.matches.map((m) => m.matchWidgetId).sort();
    expect(ids).toEqual(['WQ008', 'WQ009', 'WQ014']);

    // The completed match (WQ014) must carry status='finished' AND its
    // observed set scores — closeMatch needs both to infer the winner.
    const wq014 = result.matches.find((m) => m.matchWidgetId === 'WQ014')!;
    expect(wq014.status).toBe('finished');
    expect(wq014.category).toBe('women');
    // 3-6 / 4-6 — team 2 won 6-3, 6-4
    expect(wq014.team1.setGames).toEqual(['3', '4', '-']);
    expect(wq014.team2.setGames).toEqual(['6', '6', '-']);

    // The live matches (WQ008, WQ009) are unchanged — still women Q1.
    for (const m of result.matches.filter((m) => m.status === 'live')) {
      expect(m.category).toBe('women');
      expect(m.roundLabel).toBe('Q1');
    }

    // Match 1: WQ008 — COURT CBC, Sermant/Vierendeels vs Parmigiani/Touly, team 2 serving, 00:09
    const wq008 = result.matches.find((m) => m.matchWidgetId === 'WQ008')!;
    expect(wq008.court).toBe('COURT CBC');
    expect(wq008.durationMinutes).toBe(9);
    expect(wq008.servingTeam).toBe(2);
    expect(wq008.team1.player1Name).toBe('N. Sermant');
    expect(wq008.team1.player2Name).toBe('R. Vierendeels');
    expect(wq008.team1.player1Country).toBe('BE');
    expect(wq008.team1.player2Country).toBe('BE');
    // "(ALT)" is non-numeric — seed should be null
    expect(wq008.team1.player2Seed).toBeNull();
    expect(wq008.team2.player1Name).toBe('M. Parmigiani');
    expect(wq008.team2.player2Name).toBe('C. Touly');
    expect(wq008.team2.player1Country).toBe('IT');
    expect(wq008.team2.player2Country).toBe('FR');
    expect(wq008.team1.currentPoints).toBe('15');
    expect(wq008.team2.currentPoints).toBe('15');
    expect(wq008.team1.setGames).toEqual(['0', '-', '-']);
    expect(wq008.team2.setGames).toEqual(['3', '-', '-']);

    // Match 2: WQ009 — COURT LOTTO, Ad point, 01:07, team 2 serving with seed (7)
    const wq009 = result.matches.find((m) => m.matchWidgetId === 'WQ009')!;
    expect(wq009.court).toBe('COURT LOTTO');
    expect(wq009.durationMinutes).toBe(67);
    expect(wq009.servingTeam).toBe(2);
    expect(wq009.team1.player1Name).toBe('A. Gallardo Salvado');
    expect(wq009.team2.player2Name).toBe('M. Lobo');
    expect(wq009.team2.player2Seed).toBe(7);
    expect(wq009.team1.currentPoints).toBe('40');
    expect(wq009.team2.currentPoints).toBe('Ad');
    // Two-set state: set 1 completed (2-6), set 2 in progress (3-3)
    expect(wq009.team1.setGames).toEqual(['2', '3', '-']);
    expect(wq009.team2.setGames).toEqual(['6', '3', '-']);
  });

  // ─── Status label parsing (PR #12) ──────────────────────────────────────
  //
  // Crionet's tournamentlive widget puts a status label inside
  // `tr.summary span.ml-4`. Observed values in the wild:
  //   - "Live match"     → match in progress, emit `status: 'live'`
  //   - "On court"       → players arrived, no first point yet, emit 'on_court'
  //   - "Warming up"     → actively warming up, also emit 'on_court'
  // Matches BOTH pre-match phases into 'on_court' since fans don't care about
  // the distinction — both signal "about to start".

  function htmlWithStatusLabel(label: string): string {
    return SINGLE_LIVE_MATCH_HTML.replace(
      '<span class="ml-4">Live match</span>',
      `<span class="ml-4">${label}</span>`,
    );
  }

  it('emits status="live" when label is "Live match"', () => {
    const result = parseCrionetTournamentLive(htmlWithStatusLabel('Live match'));
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.status).toBe('live');
  });

  it('emits status="on_court" when label is "On court"', () => {
    const result = parseCrionetTournamentLive(htmlWithStatusLabel('On court'));
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.status).toBe('on_court');
  });

  it('emits status="on_court" when label is "Warming up"', () => {
    const result = parseCrionetTournamentLive(htmlWithStatusLabel('Warming up'));
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.status).toBe('on_court');
  });

  it('emits status="on_court" for any "warm*" variant (case-insensitive)', () => {
    for (const label of ['Warm up', 'WARMUP', 'warming-up', 'Warm-up']) {
      const result = parseCrionetTournamentLive(htmlWithStatusLabel(label));
      expect(result.matches[0]!.status, `label="${label}"`).toBe('on_court');
    }
  });

  it('emits status="on_court" for "on court" case-insensitively', () => {
    for (const label of ['on court', 'ON COURT', 'On Court']) {
      const result = parseCrionetTournamentLive(htmlWithStatusLabel(label));
      expect(result.matches[0]!.status, `label="${label}"`).toBe('on_court');
    }
  });

  // 2026-04-23: Crionet leaves matches visible in tournamentlive with a
  // terminal label for ~2 min after they finish. Without detecting these,
  // the live-poller keeps heartbeating and the match stays stuck at
  // status='live' in the DB until the sweeper gives up. Brussels P2
  // match 58eabeb6 hit this exact gap. Regression tests so that
  // "Completed" / "Retired" / "Walkover" + case variants always collapse
  // to the `'finished'` status that live-poller-loop's close-on-finish
  // branch looks for.
  it('emits status="finished" when label is "Completed"', () => {
    const result = parseCrionetTournamentLive(htmlWithStatusLabel('Completed'));
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.status).toBe('finished');
  });

  it('emits status="finished" for all terminal labels (case-insensitive)', () => {
    const labels = [
      'Completed',
      'COMPLETED',
      'completed',
      'Finished',
      'Retired',
      'RETIRED',
      'Walkover',
    ];
    for (const label of labels) {
      const result = parseCrionetTournamentLive(htmlWithStatusLabel(label));
      expect(result.matches[0]!.status, `label="${label}"`).toBe('finished');
    }
  });

  it('falls back to status="live" for unknown or empty labels', () => {
    for (const label of ['', 'In progress', 'Playing']) {
      const result = parseCrionetTournamentLive(htmlWithStatusLabel(label));
      expect(result.matches[0]!.status, `label="${label}"`).toBe('live');
    }
  });

  // ─── Duration sanity guard (2026-05-11) ─────────────────────────────────
  //
  // Bug observed at ASUNCION P2 2026-05-08: matches QF 6ed05aa2 (real wall-
  // clock duration 105 min) and acd38412 (210 min) were persisted with
  // duration='22:09' and '20:05' respectively — parsing to 1329 / 1205
  // minutes. Both values look like late-evening wall-clock end-times for
  // the local tournament timezone.
  //
  // Root cause: when the widget renders a finished match's summary row,
  // it can surface a wall-clock end-time in one of the summary spans. The
  // parser greedily picks the first `(\d{1,2}):(\d{2})` span. A padel
  // match never approaches 4 hours, so any parsed value > 240 min is
  // upstream contamination. Treat it as if no duration were emitted —
  // return null so live-poller skips the duration write rather than
  // persisting garbage that overwrites earlier-correct ticks.
  //
  // The guard also handles the "wall-clock first, real duration second"
  // ordering: rejecting the wall-clock span lets the iteration continue
  // and pick up the real elapsed-time span if present.

  function summaryHtml(spans: string): string {
    return `
<table class="w-100">
  <tr class="scorebox-header">
    <th><span class="tournament-name"><span>COURT C</span></span></th>
    <th class="round-name"><small><b>Men </b><div>QF</div></small></th>
  </tr>
  <tr>
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div><div class="player-names"><div class="double">
          <div class="d-flex align-items-center"><div><img class="flags" src="/images/flags/ESP.jpg"/></div><div class="ml-2"><span>A.</span><span>One</span></div></div>
          <div class="d-flex align-items-center"><div><img class="flags" src="/images/flags/ESP.jpg"/></div><div class="ml-2"><span>B.</span><span>Two</span></div></div>
        </div></div></div>
        <div></div>
      </div>
    </td>
    <td class="points"><div>0</div></td>
    <td class="set">6</td>
    <td class="set">6</td>
  </tr>
  <tr>
    <td class="team">
      <div class="d-flex justify-content-between align-items-center ml-2">
        <div><div class="player-names"><div class="double">
          <div class="d-flex align-items-center"><div><img class="flags" src="/images/flags/ARG.jpg"/></div><div class="ml-2"><span>C.</span><span>Three</span></div></div>
          <div class="d-flex align-items-center"><div><img class="flags" src="/images/flags/ARG.jpg"/></div><div class="ml-2"><span>D.</span><span>Four</span></div></div>
        </div></div></div>
        <div></div>
      </div>
    </td>
    <td class="points"><div>0</div></td>
    <td class="set">3</td>
    <td class="set">4</td>
  </tr>
  <tr class="summary">
    <td colspan="8">${spans}</td>
  </tr>
</table>
`;
  }

  it('rejects a wall-clock end-time HH:MM in the summary row (>4h)', () => {
    // Real reproducer of the ASUNCION P2 QF bug: the only HH:MM span in
    // the summary row is the wall-clock end time "22:09".
    const html = summaryHtml(
      '<span>&#128337;</span><span>22:09</span><span class="ml-4">Completed</span>',
    );
    const result = parseCrionetTournamentLive(html);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.durationMinutes).toBeNull();
  });

  it('rejects another wall-clock end-time HH:MM in the summary row (>4h)', () => {
    // Same shape as ASUNCION QF acd38412 → duration='20:05'.
    const html = summaryHtml(
      '<span>&#128337;</span><span>20:05</span><span class="ml-4">Completed</span>',
    );
    expect(parseCrionetTournamentLive(html).matches[0]!.durationMinutes).toBeNull();
  });

  it('still picks up a real elapsed duration when a wall-clock span precedes it', () => {
    // Defensive: if the widget surfaces both the wall-clock end time AND
    // the elapsed duration, the parser must skip the wall-clock and pick
    // the elapsed value.
    const html = summaryHtml(
      '<span>22:09</span><span>&#128337;</span><span>01:45</span><span class="ml-4">Completed</span>',
    );
    expect(parseCrionetTournamentLive(html).matches[0]!.durationMinutes).toBe(105);
  });

  it('accepts a legitimately long match just under the cap (3h59m)', () => {
    // Defensive: do NOT reject realistic long matches. The cap is 240 min.
    const html = summaryHtml(
      '<span>&#128337;</span><span>03:59</span><span class="ml-4">Live match</span>',
    );
    expect(parseCrionetTournamentLive(html).matches[0]!.durationMinutes).toBe(239);
  });

  it('rejects a value exactly at 4h01m (just over the cap)', () => {
    const html = summaryHtml(
      '<span>&#128337;</span><span>04:01</span><span class="ml-4">Live match</span>',
    );
    expect(parseCrionetTournamentLive(html).matches[0]!.durationMinutes).toBeNull();
  });
});
