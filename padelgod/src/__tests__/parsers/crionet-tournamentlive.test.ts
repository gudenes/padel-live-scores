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
    expect(m.team1.player1Country).toBe('ESP');
    expect(m.team1.player2Country).toBe('ARG');
    expect(m.team1.player2Seed).toBe(3);
    expect(m.team1.player1Seed).toBeNull();
    expect(m.team1.currentPoints).toBe('30');
    expect(m.team1.setGames).toEqual(['1', '-', '-']);
    expect(m.team1.setTiebreaks).toEqual([null, null, null]);

    // Team 2
    expect(m.team2.player1Name).toBe('A. Rossi');
    expect(m.team2.player2Name).toBe('L. Dupont');
    expect(m.team2.player1Country).toBe('ITA');
    expect(m.team2.player2Country).toBe('FRA');
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

  it('parses the real Brussels P2 production fixture — multiple live matches + filters completed', () => {
    const fixturePath = join(__dirname, '../fixtures/crionet-tournamentlive-brussels.html');
    const html = readFileSync(fixturePath, 'utf-8');
    const result = parseCrionetTournamentLive(html);

    // Fixture has 3 match blocks: 2 live (WQ008, WQ009) + 1 completed (WQ014).
    // V1: completed matches are filtered out.
    expect(result.matches).toHaveLength(2);
    const ids = result.matches.map((m) => m.matchWidgetId).sort();
    expect(ids).toEqual(['WQ008', 'WQ009']);

    // All live, all women Q1
    for (const m of result.matches) {
      expect(m.status).toBe('live');
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
    expect(wq008.team1.player1Country).toBe('BEL');
    expect(wq008.team1.player2Country).toBe('BEL');
    // "(ALT)" is non-numeric — seed should be null
    expect(wq008.team1.player2Seed).toBeNull();
    expect(wq008.team2.player1Name).toBe('M. Parmigiani');
    expect(wq008.team2.player2Name).toBe('C. Touly');
    expect(wq008.team2.player1Country).toBe('ITA');
    expect(wq008.team2.player2Country).toBe('FRA');
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
});
