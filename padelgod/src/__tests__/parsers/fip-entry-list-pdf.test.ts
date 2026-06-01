import { describe, it, expect } from 'vitest';
import { parseEntryListText } from '../../parsers/fip-entry-list-pdf.js';

// Real lines copied from Entry-List-Italy-Major-M-v9.pdf (pdf-parse output).
// Tabs are literal \t, exactly as the PDF text extraction produces them.
const QUALIFYING_HEADER = 'Pos Ranking \tPlayer \tRanking \tPlayer \tTeam Points';

// The team that exposed the bug: player1 line + a points line carrying the
// "PR" (protected ranking) marker before player2's ranking.
const PR_TEAM = [
  '2 \t98 Thomas Leygue FRA',
  '687 points PR \t75 Aris Patiniotis ITA',
  '939 points \t1626',
].join('\n');

// A normal team immediately after the PR team — used to prove no desync.
const NORMAL_TEAM_AFTER = [
  '3 \t89 Salva Oria ESP',
  '795 points \t85 Agustin Gutierrez ARG',
  '818 points \t1613',
].join('\n');

// A normal main-draw team (no marker) — happy path must keep working.
const MAIN_TEAM = [
  '1 \t1 Agustin Tapia ARG',
  '21109 points \t1 Arturo Coello ESP',
  '21109 points \t42218',
].join('\n');

// A deliberately malformed block: the "position" line's remainder has no
// ranking digit, so player1 parses as the contaminated string "points XYZ".
// This survives to teams.push and must be caught by the isContaminatedName
// guard (the marker-strip can't clean it), then skipped without desyncing.
const CONTAMINATED_BLOCK = [
  '500 points XYZ ABC',
  '300 points \t99 Filler Name ESP',
  '400 points \t799',
].join('\n');

describe('parseEntryListText — PR marker handling', () => {
  it('parses both players when the points line carries a PR marker', () => {
    const text = [QUALIFYING_HEADER, QUALIFYING_HEADER, PR_TEAM].join('\n');
    const { teams } = parseEntryListText(text);

    const team = teams.find(
      (t) => t.player1.name === 'Thomas Leygue' || t.player2.name === 'Thomas Leygue',
    );
    expect(team, 'a team containing Thomas Leygue should exist').toBeDefined();

    const names = [team!.player1.name, team!.player2.name];
    expect(names).toContain('Thomas Leygue');
    expect(names).toContain('Aris Patiniotis');

    const patiniotis =
      team!.player1.name === 'Aris Patiniotis' ? team!.player1 : team!.player2;
    expect(patiniotis.name).toBe('Aris Patiniotis'); // not "points PR \t75 Aris Patiniotis"
    expect(patiniotis.ranking).toBe(75);
    expect(patiniotis.country).toBe('ITA');

    const leygue =
      team!.player1.name === 'Thomas Leygue' ? team!.player1 : team!.player2;
    expect(leygue.ranking).toBe(98);
    expect(leygue.country).toBe('FRA');
  });

  it('does not desync the team that follows a PR team', () => {
    const text = [QUALIFYING_HEADER, QUALIFYING_HEADER, PR_TEAM, NORMAL_TEAM_AFTER].join('\n');
    const { teams } = parseEntryListText(text);

    const next = teams.find(
      (t) => t.player1.name === 'Salva Oria' || t.player2.name === 'Salva Oria',
    );
    expect(next, 'the team after the PR team should parse cleanly').toBeDefined();
    const nextNames = [next!.player1.name, next!.player2.name];
    expect(nextNames).toContain('Salva Oria');
    expect(nextNames).toContain('Agustin Gutierrez');
  });

  it('never emits a player name containing "points" or a tab', () => {
    const text = [QUALIFYING_HEADER, QUALIFYING_HEADER, PR_TEAM, NORMAL_TEAM_AFTER].join('\n');
    const { teams } = parseEntryListText(text);
    for (const t of teams) {
      for (const p of [t.player1, t.player2]) {
        expect(p.name).not.toMatch(/points/i);
        expect(p.name).not.toMatch(/\t/);
      }
    }
  });

  it('still parses a normal team with no marker (happy path)', () => {
    const text = [QUALIFYING_HEADER, MAIN_TEAM].join('\n');
    const { teams } = parseEntryListText(text);
    const team = teams.find(
      (t) => t.player1.name === 'Agustin Tapia' || t.player2.name === 'Agustin Tapia',
    );
    expect(team).toBeDefined();
    const names = [team!.player1.name, team!.player2.name];
    expect(names).toContain('Agustin Tapia');
    expect(names).toContain('Arturo Coello');
  });

  it('skips a contaminated block (guard branch) without emitting garbage or desyncing', () => {
    const text = [QUALIFYING_HEADER, QUALIFYING_HEADER, CONTAMINATED_BLOCK, NORMAL_TEAM_AFTER].join('\n');
    const { teams } = parseEntryListText(text);

    // No emitted team carries the leaked column data.
    for (const t of teams) {
      for (const p of [t.player1, t.player2]) {
        expect(p.name).not.toMatch(/points/i);
        expect(p.name).not.toMatch(/XYZ/);
      }
    }
    // The good team after the contaminated block still parses (no desync).
    const next = teams.find(
      (t) => t.player1.name === 'Salva Oria' || t.player2.name === 'Salva Oria',
    );
    expect(next, 'the team after a contaminated block should still parse').toBeDefined();
  });
});
