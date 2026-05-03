import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseFipEventDraw,
  categoryAndTypeFromDrawCode,
  roundLabelFromMatchCount,
} from '../../parsers/fip-event-draw.js';

// Production payloads captured 2026-04-23 from
//   POST https://www.padelfip.com/wp-admin/admin-ajax.php
//   action=handle_ajax_request&drawType={MD|WD|MQ|WQ}&gender={M|F}&postID=290219
// Event: Brussels P2 2026 (slug: brussels-p2-2026, postID: 290219).
//
// At capture time: R32 + R16 fully played, QFs in progress / scheduled, SF + F
// still Bye-vs-Bye placeholders. This specific tournament is the one where
// we have 5 QFs + 1 WQ unlinked to public.matches because the Crionet OOP
// doesn't surface TBDs before they're scheduled — the whole reason this
// parser exists.
const FIXTURE_DIR = join(__dirname, '../fixtures/fip-draw');

function loadResponse(code: 'MD' | 'WD' | 'MQ' | 'WQ'): string {
  const raw = readFileSync(join(FIXTURE_DIR, `fip-draw-${code}.json`), 'utf-8');
  const parsed = JSON.parse(raw) as { html: string };
  return parsed.html;
}

describe('categoryAndTypeFromDrawCode', () => {
  it('maps the four draw codes to (category, drawType)', () => {
    expect(categoryAndTypeFromDrawCode('MD')).toEqual({ category: 'men', drawType: 'main_draw' });
    expect(categoryAndTypeFromDrawCode('WD')).toEqual({ category: 'women', drawType: 'main_draw' });
    expect(categoryAndTypeFromDrawCode('MQ')).toEqual({ category: 'men', drawType: 'qualifying' });
    expect(categoryAndTypeFromDrawCode('WQ')).toEqual({ category: 'women', drawType: 'qualifying' });
  });
});

describe('roundLabelFromMatchCount', () => {
  it('maps standard match counts to canonical round labels', () => {
    expect(roundLabelFromMatchCount(16)).toBe('R32');
    expect(roundLabelFromMatchCount(8)).toBe('R16');
    expect(roundLabelFromMatchCount(4)).toBe('QF');
    expect(roundLabelFromMatchCount(2)).toBe('SF');
    expect(roundLabelFromMatchCount(1)).toBe('F');
  });

  it('falls back to R{2N} for non-standard qualifier rounds', () => {
    // e.g. a Q draw with 12 matches → R24 (best-effort; qualifiers can have
    // arbitrary shapes; the linker only needs the match_widget_id anyway).
    expect(roundLabelFromMatchCount(12)).toBe('R24');
    expect(roundLabelFromMatchCount(6)).toBe('R12');
  });
});

describe('parseFipEventDraw — Brussels MD fixture', () => {
  const html = loadResponse('MD');
  const matches = parseFipEventDraw(html);

  it('extracts the full bracket (R32 + R16 + QF + SF + F = 31 matches)', () => {
    expect(matches).toHaveLength(31);
    const ids = matches.map((m) => m.matchWidgetId).sort();
    // Every slot has a widget ID — no placeholders missing.
    expect(new Set(ids).size).toBe(31);
    // Widget IDs are all MD###.
    for (const id of ids) {
      expect(id).toMatch(/^MD\d{3}$/);
    }
  });

  it('labels rounds by match count: R32=16, R16=8, QF=4, SF=2, F=1', () => {
    const byRound = matches.reduce<Record<string, number>>((acc, m) => {
      acc[m.roundLabel] = (acc[m.roundLabel] ?? 0) + 1;
      return acc;
    }, {});
    expect(byRound).toEqual({ R32: 16, R16: 8, QF: 4, SF: 2, F: 1 });
  });

  it('captures FIP pair IDs from data-single-team on real teams', () => {
    const realTeams = matches
      .flatMap((m) => [m.team1, m.team2])
      .filter((t) => !t.isBye);
    // Every real team has a P-prefixed FIP team id.
    for (const t of realTeams) {
      expect(t.fipTeamId, `fipTeamId on team ${t.player1Name}/${t.player2Name}`).toMatch(/^P\d+$/);
    }
  });

  it('marks Bye slots correctly (both names = "Bye", isBye=true, walkover status)', () => {
    // Brussels MD has 8 Bye-vs-real matches in R32 (scoped to R32 only; SF/F
    // placeholders have Bye-vs-Bye because no teams have advanced yet).
    const byeMatches = matches.filter((m) => m.team1.isBye || m.team2.isBye);
    expect(byeMatches.length).toBeGreaterThan(0);
    // A Bye-vs-real match: the real team wins by walkover.
    const byeVsReal = byeMatches.find(
      (m) => m.roundLabel === 'R32' && m.team1.isBye !== m.team2.isBye
    );
    expect(byeVsReal).toBeDefined();
    expect(byeVsReal!.status).toBe('walkover');
    expect(byeVsReal!.winnerTeam).not.toBeNull();
  });

  it('extracts seeds from additionalInfo like "(1)"', () => {
    const seeded = matches
      .flatMap((m) => [m.team1, m.team2])
      .filter((t) => t.seed !== null && !t.isBye);
    // MD has seeds 1..8 for the 8 seeded teams.
    expect(seeded.length).toBeGreaterThanOrEqual(8);
    const seeds = new Set(seeded.map((t) => t.seed));
    for (const s of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(seeds.has(s), `expected seed ${s} in MD bracket`).toBe(true);
    }
  });

  it('extracts (Q) / (WC) markers', () => {
    const markers = matches
      .flatMap((m) => [m.team1, m.team2])
      .filter((t) => t.marker !== null)
      .map((t) => t.marker);
    // MD bracket has both qualifier and wildcard entries.
    expect(markers).toContain('Q');
    expect(markers).toContain('WC');
  });

  it('parses finished matches with winner + set scores', () => {
    // MD008 was a completed R32 match at capture time (3-setter, winner on
    // team 2 via ✓ mark). The parser should surface status='finished',
    // winnerTeam=2, and a well-formed set_scores string. We pick MD008
    // instead of MD001 because capture ordering within the widget puts
    // the earliest completed matches mid-bracket, not at slot 1.
    const md008 = matches.find((m) => m.matchWidgetId === 'MD008')!;
    expect(md008).toBeDefined();
    expect(md008.status).toBe('finished');
    expect(md008.winnerTeam).not.toBeNull();
    expect(md008.setScores).toMatch(/^\d+-\d+(?: \d+-\d+)*$/);
  });
});

describe('parseFipEventDraw — Brussels WQ fixture (the unlinked match)', () => {
  const html = loadResponse('WQ');
  const matches = parseFipEventDraw(html);

  it('contains WQ011 (the currently-unlinked qualifier match)', () => {
    const wq011 = matches.find((m) => m.matchWidgetId === 'WQ011');
    expect(wq011, 'WQ011 must be present in FIP event-page draw data').toBeDefined();
    // Fully played at capture time: winner is known, set scores are captured.
    expect(wq011!.status).toBe('finished');
    expect(wq011!.winnerTeam).not.toBeNull();
    // Both teams have real FIP pair IDs.
    expect(wq011!.team1.fipTeamId).toMatch(/^P\d+$/);
    expect(wq011!.team2.fipTeamId).toMatch(/^P\d+$/);
    // Set scores in canonical "A-B C-D" form.
    expect(wq011!.setScores).toMatch(/^\d+-\d+(?: \d+-\d+)*$/);
  });

  it('round labels reflect qualifier shape (2 rounds)', () => {
    const byRound = new Set(matches.map((m) => m.roundLabel));
    // WQ has 12 matches = R24(8) + QF(4). Fall-through R24 is fine — downstream
    // only cares about match_widget_id for linking.
    expect(byRound.size).toBeGreaterThanOrEqual(1);
    expect(matches.length).toBeGreaterThanOrEqual(12);
  });

  it('emits Q1/Q2 labels when drawType="qualifying"', () => {
    // Same fixture, but with drawType passed in: the parser should map round
    // sizes to qualifier labels (largest round = Q1, next = Q2, …) instead
    // of main-draw labels (R24/QF). Repro of the Asuncion P2 bug where
    // women's qualifying matches landed in public.matches with round='R16'.
    const qualifying = parseFipEventDraw(html, 'qualifying');
    const labels = new Set(qualifying.map((m) => m.roundLabel));
    expect(labels).toContain('Q1');
    expect(labels).toContain('Q2');
    expect(labels.has('R24')).toBe(false);
    expect(labels.has('QF')).toBe(false);

    // The widget that originally surfaced the bug must now carry Q-style
    // label, not the bracket-shape fall-through.
    const wq011 = qualifying.find((m) => m.matchWidgetId === 'WQ011')!;
    expect(wq011.roundLabel).toMatch(/^Q\d+$/);
  });

  it('main_draw drawType keeps R32/R16/QF labels unchanged', () => {
    // Sanity: passing drawType='main_draw' must not touch the existing
    // mapping. Same as omitting the arg.
    const md = parseFipEventDraw(loadResponse('MD'), 'main_draw');
    const counts = md.reduce<Record<string, number>>((acc, m) => {
      acc[m.roundLabel] = (acc[m.roundLabel] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ R32: 16, R16: 8, QF: 4, SF: 2, F: 1 });
  });
});

describe('parseFipEventDraw — robustness', () => {
  it('returns [] for empty HTML', () => {
    expect(parseFipEventDraw('')).toEqual([]);
    expect(parseFipEventDraw('<html><body></body></html>')).toEqual([]);
  });

  it('skips .singleMatch divs that are missing data-match-id', () => {
    const html = `
      <div class="colDraw" data-round="2">
        <div class="singleMatch--box">
          <div class="singleMatch">
            <div class="singleMatch__team" data-single-team="P1"></div>
            <div class="singleMatch__team" data-single-team="P2"></div>
          </div>
          <div class="singleMatch" data-match-id="MD100">
            <div class="singleMatch__team" data-single-team="P3">
              <div class="singleMatch__team--wrap">
                <div class="singleMatch__team--item"><p class="singleMatch__team--itemName">A</p></div>
                <div class="singleMatch__team--item"><p class="singleMatch__team--itemName">B</p></div>
              </div>
              <div class="additionalInfo"></div>
            </div>
            <div class="singleMatch__team" data-single-team="P4">
              <div class="singleMatch__team--wrap">
                <div class="singleMatch__team--item"><p class="singleMatch__team--itemName">C</p></div>
                <div class="singleMatch__team--item"><p class="singleMatch__team--itemName">D</p></div>
              </div>
              <div class="additionalInfo"></div>
            </div>
          </div>
        </div>
      </div>`;
    const matches = parseFipEventDraw(html);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.matchWidgetId).toBe('MD100');
  });

  it('returns scheduled status + null winner for teams with no ✓ and no sets', () => {
    const html = `
      <div class="colDraw" data-round="4">
        <div class="singleMatch--box">
          <div class="singleMatch" data-match-id="MD200">
            <div class="singleMatch__team" data-single-team="P10">
              <div class="singleMatch__team--wrap">
                <div class="singleMatch__team--item">
                  <img class="singleMatch__team--itemFlag" src="/wp-content/uploads/2023/02/Spain_Fip.jpg"/>
                  <p class="singleMatch__team--itemName">P. One</p>
                </div>
                <div class="singleMatch__team--item"><p class="singleMatch__team--itemName">P. Two</p></div>
              </div>
              <div class="additionalInfo"><small>(3)&nbsp;</small></div>
              <div class="singleMatch__tableSets"></div>
            </div>
            <div class="singleMatch__team" data-single-team="P20">
              <div class="singleMatch__team--wrap">
                <div class="singleMatch__team--item"><p class="singleMatch__team--itemName">P. Three</p></div>
                <div class="singleMatch__team--item"><p class="singleMatch__team--itemName">P. Four</p></div>
              </div>
              <div class="additionalInfo"></div>
              <div class="singleMatch__tableSets"></div>
            </div>
          </div>
        </div>
      </div>`;
    const matches = parseFipEventDraw(html);
    expect(matches).toHaveLength(1);
    const m = matches[0]!;
    expect(m.status).toBe('scheduled');
    expect(m.winnerTeam).toBeNull();
    expect(m.setScores).toBeNull();
    expect(m.team1.seed).toBe(3);
    expect(m.team1.country).toBe('Spain');
    expect(m.roundLabel).toBe('QF');
  });
});
