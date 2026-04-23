import { describe, it, expect } from 'vitest';
import {
  linkDrawSnapshotsToPublicMatches,
  extractSurnameTokens,
  type DrawSnapshotCandidate,
  type PublicMatchCandidate,
} from '../../lib/draw-linker.js';

const TOURNAMENT_WIDGET_ID = 'FIP-2026-1701';

// Helper: build a draw-snapshot-ish candidate with sensible defaults.
function draw(overrides: Partial<DrawSnapshotCandidate>): DrawSnapshotCandidate {
  return {
    matchWidgetId: 'WQ011',
    category: 'women',
    roundLabel: 'R16',
    team1Player1Name: 'Camila Fassio Goyeneche',
    team1Player2Name: 'Aida Martinez',
    team2Player1Name: 'Nuria Rodriguez Camacho',
    team2Player2Name: 'Giulia Dal Pozzo',
    team1FipId: 'P201785',
    team2FipId: 'P000456',
    status: 'finished',
    ...overrides,
  };
}

function publicMatch(overrides: Partial<PublicMatchCandidate>): PublicMatchCandidate {
  return {
    id: 'match-uuid-1',
    round: 'R16',
    category: 'women',
    pair1Player1Name: 'Camila Fassio Goyeneche',
    pair1Player2Name: 'Aida Martinez',
    pair2Player1Name: 'Nuria Rodriguez Camacho',
    pair2Player2Name: 'Giulia Dal Pozzo',
    ...overrides,
  };
}

describe('extractSurnameTokens', () => {
  it('strips single-letter initials and lowercases the rest', () => {
    expect(extractSurnameTokens('M. Ortega Gallego')).toEqual(['ortega', 'gallego']);
    expect(extractSurnameTokens('Marta Ortega Gallego')).toEqual(['marta', 'ortega', 'gallego']);
    expect(extractSurnameTokens('A. LOPEZ')).toEqual(['lopez']);
  });

  it('returns [] for empty/whitespace input', () => {
    expect(extractSurnameTokens('')).toEqual([]);
    expect(extractSurnameTokens('   ')).toEqual([]);
  });

  it('preserves accents (Muñoz stays distinct from Munoz)', () => {
    expect(extractSurnameTokens('Muñoz')).toEqual(['muñoz']);
    expect(extractSurnameTokens('Munoz')).toEqual(['munoz']);
  });
});

describe('linkDrawSnapshotsToPublicMatches — happy path', () => {
  it('links an exact 4-player name match', () => {
    const linkages = linkDrawSnapshotsToPublicMatches(
      [draw({})],
      [publicMatch({})],
      TOURNAMENT_WIDGET_ID,
    );
    expect(linkages).toEqual([
      {
        matchWidgetId: 'WQ011',
        compositeExternalId: 'FIP-2026-1701:WQ011',
        matchId: 'match-uuid-1',
      },
    ]);
  });

  it('links when public side uses short-form initials but surnames align (3/4 overlap)', () => {
    const linkages = linkDrawSnapshotsToPublicMatches(
      [draw({})],
      [
        publicMatch({
          pair1Player1Name: 'C. Fassio Goyeneche',
          pair1Player2Name: 'A. Martinez',
          pair2Player1Name: 'N. Rodriguez Camacho',
          // Missing partner name (null) — 3/4 is still above threshold.
          pair2Player2Name: null,
        }),
      ],
      TOURNAMENT_WIDGET_ID,
    );
    expect(linkages).toHaveLength(1);
  });

  it('respects minNameOverlap override (strict 4/4)', () => {
    const linkages = linkDrawSnapshotsToPublicMatches(
      [draw({})],
      [
        publicMatch({
          pair2Player2Name: null, // only 3/4 aligned
        }),
      ],
      TOURNAMENT_WIDGET_ID,
      { minNameOverlap: 4 },
    );
    expect(linkages).toHaveLength(0);
  });
});

describe('linkDrawSnapshotsToPublicMatches — skip conditions', () => {
  it('skips Bye rows (status=walkover)', () => {
    const linkages = linkDrawSnapshotsToPublicMatches(
      [draw({ status: 'walkover', team2FipId: null, team2Player1Name: null, team2Player2Name: null })],
      [publicMatch({})],
      TOURNAMENT_WIDGET_ID,
    );
    expect(linkages).toEqual([]);
  });

  it('skips rows where either team has a non-P (numeric) FIP id', () => {
    const linkages = linkDrawSnapshotsToPublicMatches(
      [draw({ team1FipId: '1390580661' })], // placeholder id for bye
      [publicMatch({})],
      TOURNAMENT_WIDGET_ID,
    );
    expect(linkages).toEqual([]);
  });

  it('skips rows with a null FIP team id even if player names are present', () => {
    const linkages = linkDrawSnapshotsToPublicMatches(
      [draw({ team1FipId: null })],
      [publicMatch({})],
      TOURNAMENT_WIDGET_ID,
    );
    expect(linkages).toEqual([]);
  });

  it('does NOT link across categories (men draw vs women public.matches)', () => {
    const linkages = linkDrawSnapshotsToPublicMatches(
      [draw({ category: 'men', matchWidgetId: 'MD004' })],
      [publicMatch({ category: 'women' })],
      TOURNAMENT_WIDGET_ID,
    );
    expect(linkages).toEqual([]);
  });

  it('does NOT link across rounds (QF draw vs R16 public)', () => {
    const linkages = linkDrawSnapshotsToPublicMatches(
      [draw({ roundLabel: 'QF' })],
      [publicMatch({ round: 'R16' })],
      TOURNAMENT_WIDGET_ID,
    );
    expect(linkages).toEqual([]);
  });

  it('canonicalizes Quarter/Quarterfinals/QF as equivalent', () => {
    const linkages = linkDrawSnapshotsToPublicMatches(
      [draw({ roundLabel: 'QF' })],
      [publicMatch({ round: 'Quarterfinals' })],
      TOURNAMENT_WIDGET_ID,
    );
    expect(linkages).toHaveLength(1);
  });
});

describe('linkDrawSnapshotsToPublicMatches — ambiguity', () => {
  it('skips when two public candidates tie on overlap score (skipOnTie default true)', () => {
    const linkages = linkDrawSnapshotsToPublicMatches(
      [draw({})],
      [
        publicMatch({ id: 'match-A' }),
        publicMatch({ id: 'match-B' }), // identical players → tie
      ],
      TOURNAMENT_WIDGET_ID,
    );
    expect(linkages).toEqual([]);
  });

  it('claims a public match at most once across multiple draw rows', () => {
    const shared = publicMatch({ id: 'match-shared' });
    const draw1 = draw({ matchWidgetId: 'MD001' });
    const draw2 = draw({ matchWidgetId: 'MD002' }); // same players, different widget — would both map to shared
    const linkages = linkDrawSnapshotsToPublicMatches(
      [draw1, draw2],
      [shared],
      TOURNAMENT_WIDGET_ID,
    );
    // First wins, second is skipped because the match is already claimed.
    expect(linkages).toHaveLength(1);
    expect(linkages[0]!.matchWidgetId).toBe('MD001');
  });

  it('links via best-score winner when one candidate clearly dominates', () => {
    const linkages = linkDrawSnapshotsToPublicMatches(
      [draw({})],
      [
        // Partial overlap — 2/4 surnames (below threshold)
        publicMatch({
          id: 'bad-match',
          pair1Player1Name: 'Someone Else',
          pair1Player2Name: 'Another Person',
          pair2Player1Name: 'Nuria Rodriguez Camacho',
          pair2Player2Name: 'Giulia Dal Pozzo',
        }),
        // Full overlap — 4/4
        publicMatch({ id: 'good-match' }),
      ],
      TOURNAMENT_WIDGET_ID,
    );
    expect(linkages).toHaveLength(1);
    expect(linkages[0]!.matchId).toBe('good-match');
  });
});

describe('linkDrawSnapshotsToPublicMatches — Brussels WQ011 regression', () => {
  // Real data captured 2026-04-23. WQ011 is the currently-unlinked women's
  // qualifier match. Exercises the exact production shape.
  it('links WQ011 to its public.matches twin via bipartite name overlap', () => {
    const brusselsWq011: DrawSnapshotCandidate = {
      matchWidgetId: 'WQ011',
      category: 'women',
      roundLabel: 'R16',
      team1Player1Name: 'Camila Fassio Goyeneche',
      team1Player2Name: 'Aida Martinez',
      team2Player1Name: 'Nuria Rodriguez Camacho',
      team2Player2Name: 'Giulia Dal Pozzo',
      team1FipId: 'P201785',
      team2FipId: 'P000456',
      status: 'finished',
    };

    // Simulate the kind of full-name data padelapi sync writes into
    // public.matches. Teams may be swapped between pair1/pair2 — the
    // bipartite matcher must handle that.
    const wq011PublicTwin: PublicMatchCandidate = {
      id: 'public-wq011-uuid',
      round: 'R16',
      category: 'women',
      pair1Player1Name: 'Nuria Rodriguez Camacho',
      pair1Player2Name: 'Giulia Dal Pozzo',
      pair2Player1Name: 'Camila Fassio Goyeneche',
      pair2Player2Name: 'Aida Martinez',
    };

    const linkages = linkDrawSnapshotsToPublicMatches(
      [brusselsWq011],
      [wq011PublicTwin],
      TOURNAMENT_WIDGET_ID,
    );
    expect(linkages).toEqual([
      {
        matchWidgetId: 'WQ011',
        compositeExternalId: 'FIP-2026-1701:WQ011',
        matchId: 'public-wq011-uuid',
      },
    ]);
  });
});
