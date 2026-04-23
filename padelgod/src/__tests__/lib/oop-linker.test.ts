import { describe, it, expect } from 'vitest';
import {
  linkOopSnapshotsToPublicMatches,
  extractLastName,
  type PublicMatchCandidate,
} from '../../lib/oop-linker.js';
import type { ParsedOopMatch } from '../../parsers/crionet-oop.js';

function parsed(over: Partial<ParsedOopMatch>): ParsedOopMatch {
  return {
    dayNumber: 6,
    category: 'women',
    roundLabel: 'Quarterfinals',
    court: 'COURT CBC',
    courtPosition: 0,
    courtDisplayOrder: 0,
    scheduledLabel: null,
    team1Player1Name: null,
    team1Player2Name: null,
    team2Player1Name: null,
    team2Player2Name: null,
    matchWidgetId: 'WD005',
    status: 'scheduled',
    ...over,
  };
}

function pmCandidate(over: Partial<PublicMatchCandidate>): PublicMatchCandidate {
  return {
    id: 'match-uuid-1',
    round: 'Quarter',
    court: 'Court CBC',
    category: 'women',
    pair1Player1Name: null,
    pair1Player2Name: null,
    pair2Player1Name: null,
    pair2Player2Name: null,
    ...over,
  };
}

describe('extractLastName', () => {
  it('drops a single-letter initial', () => {
    expect(extractLastName('M. Gonzalez Gallego')).toBe('gonzalez gallego');
  });
  it('keeps the full name when no initial is present', () => {
    expect(extractLastName('Maria Gonzalez Gallego')).toBe('maria gonzalez gallego');
    // ^ subtle: matches the initial-path behavior, since "Maria" has len>1
    // it's kept. last-name-match still works because public rows in the DB
    // also come through this fn.
  });
  it('handles empty / whitespace-only input', () => {
    expect(extractLastName('')).toBe('');
    expect(extractLastName('   ')).toBe('');
  });
  it('lowercases output', () => {
    expect(extractLastName('M. GONZALEZ')).toBe('gonzalez');
  });
});

describe('linkOopSnapshotsToPublicMatches', () => {
  const TOURNAMENT_WIDGET = 'FIP-2026-1701';

  it('links OOP row to the public match with full 4/4 name overlap', () => {
    const oop = [
      parsed({
        matchWidgetId: 'WD005',
        team1Player1Name: 'M. Ortega Gallego',
        team1Player2Name: 'M. Calvo',
        team2Player1Name: 'B. Gonzalez Fernandez',
        team2Player2Name: 'P. Josemaria Martin',
      }),
    ];
    const pm: PublicMatchCandidate[] = [
      pmCandidate({
        id: 'uuid-ortega-gonzalez',
        pair1Player1Name: 'M. Ortega Gallego',
        pair1Player2Name: 'M. Calvo',
        pair2Player1Name: 'B. Gonzalez Fernandez',
        pair2Player2Name: 'P. Josemaria Martin',
      }),
    ];

    const links = linkOopSnapshotsToPublicMatches(oop, pm, TOURNAMENT_WIDGET);
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      matchWidgetId: 'WD005',
      compositeExternalId: 'FIP-2026-1701:WD005',
      matchId: 'uuid-ortega-gonzalez',
    });
  });

  it('links with 3/4 overlap (one name typo / nickname) under default threshold', () => {
    const oop = [
      parsed({
        matchWidgetId: 'WD005',
        team1Player1Name: 'M. Ortega Gallego',
        team1Player2Name: 'M. Calvo',
        team2Player1Name: 'B. Gonzalez Fernandez',
        team2Player2Name: 'P. Josemaria Martin',
      }),
    ];
    const pm: PublicMatchCandidate[] = [
      pmCandidate({
        id: 'uuid-fuzzy',
        pair1Player1Name: 'M. Ortega Gallego',
        pair1Player2Name: 'M. Calvo',
        pair2Player1Name: 'B. Gonzalez Fernandez',
        // Typo / nickname — only 3 of 4 overlap
        pair2Player2Name: 'P. Josemaria Martinez',
      }),
    ];
    const links = linkOopSnapshotsToPublicMatches(oop, pm, TOURNAMENT_WIDGET);
    expect(links).toHaveLength(1);
    expect(links[0]!.matchId).toBe('uuid-fuzzy');
  });

  it('does NOT link when overlap is below threshold (default 3)', () => {
    const oop = [
      parsed({
        matchWidgetId: 'WD005',
        team1Player1Name: 'M. Ortega Gallego',
        team1Player2Name: 'M. Calvo',
        team2Player1Name: 'B. Gonzalez Fernandez',
        team2Player2Name: 'P. Josemaria Martin',
      }),
    ];
    const pm: PublicMatchCandidate[] = [
      pmCandidate({
        id: 'uuid-weak',
        pair1Player1Name: 'A. Someone',
        pair1Player2Name: 'B. Someone',
        pair2Player1Name: 'C. Someone',
        pair2Player2Name: 'P. Josemaria Martin', // only 1/4 overlap
      }),
    ];
    const links = linkOopSnapshotsToPublicMatches(oop, pm, TOURNAMENT_WIDGET);
    expect(links).toHaveLength(0);
  });

  it('canonicalizes round names — Quarterfinals in OOP matches Quarter in public', () => {
    const oop = [
      parsed({
        roundLabel: 'Quarterfinals',
        matchWidgetId: 'WD005',
        team1Player1Name: 'M. A',
        team1Player2Name: 'M. B',
        team2Player1Name: 'M. C',
        team2Player2Name: 'M. D',
      }),
    ];
    const pm: PublicMatchCandidate[] = [
      pmCandidate({
        id: 'uuid-quarter',
        round: 'Quarter',
        pair1Player1Name: 'M. A',
        pair1Player2Name: 'M. B',
        pair2Player1Name: 'M. C',
        pair2Player2Name: 'M. D',
      }),
    ];
    const links = linkOopSnapshotsToPublicMatches(oop, pm, TOURNAMENT_WIDGET);
    expect(links).toHaveLength(1);
    expect(links[0]!.matchId).toBe('uuid-quarter');
  });

  it('filters by category — women OOP does not match men public candidate', () => {
    const oop = [
      parsed({
        matchWidgetId: 'WD005',
        category: 'women',
        team1Player1Name: 'M. A',
        team1Player2Name: 'M. B',
        team2Player1Name: 'M. C',
        team2Player2Name: 'M. D',
      }),
    ];
    const pm: PublicMatchCandidate[] = [
      pmCandidate({
        id: 'uuid-men-same-names',
        category: 'men',
        pair1Player1Name: 'M. A',
        pair1Player2Name: 'M. B',
        pair2Player1Name: 'M. C',
        pair2Player2Name: 'M. D',
      }),
    ];
    const links = linkOopSnapshotsToPublicMatches(oop, pm, TOURNAMENT_WIDGET);
    expect(links).toHaveLength(0);
  });

  it('skips on tie (two candidates with the same score and matching court)', () => {
    // Two public matches with identical player sets — pathological but
    // defensive: we'd rather not link than link wrong.
    const names = {
      pair1Player1Name: 'M. A',
      pair1Player2Name: 'M. B',
      pair2Player1Name: 'M. C',
      pair2Player2Name: 'M. D',
    };
    const oop = [
      parsed({
        matchWidgetId: 'WD005',
        team1Player1Name: 'M. A',
        team1Player2Name: 'M. B',
        team2Player1Name: 'M. C',
        team2Player2Name: 'M. D',
      }),
    ];
    const pm: PublicMatchCandidate[] = [
      pmCandidate({ id: 'uuid-1', court: 'Court CBC', ...names }),
      pmCandidate({ id: 'uuid-2', court: 'Court CBC', ...names }),
    ];
    const links = linkOopSnapshotsToPublicMatches(oop, pm, TOURNAMENT_WIDGET);
    expect(links).toHaveLength(0);
  });

  it('tie-breaks by court when two candidates tie on score but different courts', () => {
    const names = {
      pair1Player1Name: 'M. A',
      pair1Player2Name: 'M. B',
      pair2Player1Name: 'M. C',
      pair2Player2Name: 'M. D',
    };
    const oop = [
      parsed({
        matchWidgetId: 'WD005',
        court: 'COURT CBC',
        team1Player1Name: 'M. A',
        team1Player2Name: 'M. B',
        team2Player1Name: 'M. C',
        team2Player2Name: 'M. D',
      }),
    ];
    const pm: PublicMatchCandidate[] = [
      // Wrong court — should lose the tiebreak
      pmCandidate({ id: 'uuid-nextensa', court: 'Court Nextensa', ...names }),
      // Right court
      pmCandidate({ id: 'uuid-cbc', court: 'Court CBC', ...names }),
    ];
    const links = linkOopSnapshotsToPublicMatches(oop, pm, TOURNAMENT_WIDGET);
    expect(links).toHaveLength(1);
    expect(links[0]!.matchId).toBe('uuid-cbc');
  });

  it('does not link the same public match to two different OOP rows', () => {
    // Two OOP rows that both best-match the same public row (pathological).
    // Only the first one wins; second gets skipped.
    const names = {
      pair1Player1Name: 'M. A',
      pair1Player2Name: 'M. B',
      pair2Player1Name: 'M. C',
      pair2Player2Name: 'M. D',
    };
    const oop = [
      parsed({ matchWidgetId: 'WD005', team1Player1Name: 'M. A', team1Player2Name: 'M. B', team2Player1Name: 'M. C', team2Player2Name: 'M. D' }),
      parsed({ matchWidgetId: 'WD006', team1Player1Name: 'M. A', team1Player2Name: 'M. B', team2Player1Name: 'M. C', team2Player2Name: 'M. D' }),
    ];
    const pm: PublicMatchCandidate[] = [pmCandidate({ id: 'uuid-single', ...names })];
    const links = linkOopSnapshotsToPublicMatches(oop, pm, TOURNAMENT_WIDGET);
    expect(links).toHaveLength(1);
    expect(links[0]!.matchWidgetId).toBe('WD005');
  });

  it('returns empty list when no matchWidgetId is present on any OOP row', () => {
    const oop = [
      parsed({ matchWidgetId: null, team1Player1Name: 'M. A', team1Player2Name: 'M. B', team2Player1Name: 'M. C', team2Player2Name: 'M. D' }),
    ];
    const pm: PublicMatchCandidate[] = [
      pmCandidate({
        id: 'uuid-1',
        pair1Player1Name: 'M. A',
        pair1Player2Name: 'M. B',
        pair2Player1Name: 'M. C',
        pair2Player2Name: 'M. D',
      }),
    ];
    const links = linkOopSnapshotsToPublicMatches(oop, pm, TOURNAMENT_WIDGET);
    expect(links).toHaveLength(0);
  });
});
