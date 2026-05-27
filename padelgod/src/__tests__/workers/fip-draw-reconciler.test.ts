import { describe, it, expect } from 'vitest';
import {
  computeReconciliationPatch,
  type DrawForReconcile,
  type ExistingForReconcile,
} from '../../workers/fip-draw-reconciler.js';
import type { ResolvedFour } from '../../lib/draw-resolver.js';

// Test fixtures use realistic Albania 2026 player UUIDs and seed values so
// the cases mirror the 2026-05-26 incident the worker exists to prevent.
//   Garrido     916aa820-1c5d-4d9c-9fe7-bbc074c8051c  (seed 5)
//   Bergamini   43ac372d-0293-4791-9292-201e985e2ce6
//   Barahona    8d7c1bdf-5e83-4eb9-a5c1-a8b9c11fbfa0  (seed 9)
//   Alfonso     7934d376-5e86-44ca-a4ca-22b6fa971f4e
//   Collado     d8441345-2fea-4a7a-8b2b-372468f767ce
//   Hernandez   869e6480-7f1c-4f50-882c-c75ba49f056c
//   Leal        leal-uuid-placeholder
//   Guerrero    guerrero-uuid-placeholder

const GARRIDO = '916aa820-1c5d-4d9c-9fe7-bbc074c8051c';
const BERGAMINI = '43ac372d-0293-4791-9292-201e985e2ce6';
const BARAHONA = '8d7c1bdf-5e83-4eb9-a5c1-a8b9c11fbfa0';
const ALFONSO = '7934d376-5e86-44ca-a4ca-22b6fa971f4e';
const COLLADO = 'd8441345-2fea-4a7a-8b2b-372468f767ce';
const HERNANDEZ = '869e6480-7f1c-4f50-882c-c75ba49f056c';
const LEAL = 'leal-uuid-placeholder';
const GUERRERO = 'guerrero-uuid-placeholder';

function baseDraw(over: Partial<DrawForReconcile> = {}): DrawForReconcile {
  return {
    match_widget_id: 'MD020',
    round_label: 'R32',
    status: 'scheduled',
    team1_seed: null,
    team2_seed: null,
    team1_player1_name: null,
    team1_player2_name: null,
    team2_player1_name: null,
    team2_player2_name: null,
    ...over,
  };
}

function baseExisting(over: Partial<ExistingForReconcile> = {}): ExistingForReconcile {
  return {
    id: 'match-uuid',
    status: 'scheduled',
    round: 'R32',
    round_canonical: 'R32',
    pair1_player1_id: null,
    pair1_player2_id: null,
    pair2_player1_id: null,
    pair2_player2_id: null,
    pair1_seed: null,
    pair2_seed: null,
    winner_pair: null,
    ...over,
  };
}

function baseResolved(over: Partial<ResolvedFour> = {}): ResolvedFour {
  return { p1p1: null, p1p2: null, p2p1: null, p2p2: null, ...over };
}

describe('computeReconciliationPatch — no drift', () => {
  it('returns null when DB and draw match exactly', () => {
    const draw = baseDraw({
      team1_player1_name: 'Barahona', team1_player2_name: 'Alfonso',
      team2_player1_name: 'Hernandez', team2_player2_name: 'Collado',
      team1_seed: 9,
    });
    const existing = baseExisting({
      pair1_player1_id: BARAHONA, pair1_player2_id: ALFONSO,
      pair2_player1_id: HERNANDEZ, pair2_player2_id: COLLADO,
      pair1_seed: 9,
    });
    const resolved = baseResolved({ p1p1: BARAHONA, p1p2: ALFONSO, p2p1: HERNANDEZ, p2p2: COLLADO });
    expect(computeReconciliationPatch(draw, existing, resolved)).toBeNull();
  });
});

describe('computeReconciliationPatch — safety gates', () => {
  it('returns null when existing.status === finished', () => {
    const draw = baseDraw({ team1_player1_name: 'Barahona', team1_player2_name: 'Alfonso' });
    const existing = baseExisting({ status: 'finished', pair1_player1_id: GARRIDO, pair1_player2_id: BERGAMINI });
    const resolved = baseResolved({ p1p1: BARAHONA, p1p2: ALFONSO });
    expect(computeReconciliationPatch(draw, existing, resolved)).toBeNull();
  });

  it('returns null when existing.status === retired', () => {
    const draw = baseDraw({ team1_player1_name: 'Barahona', team1_player2_name: 'Alfonso' });
    const existing = baseExisting({ status: 'retired', pair1_player1_id: GARRIDO, pair1_player2_id: BERGAMINI });
    const resolved = baseResolved({ p1p1: BARAHONA, p1p2: ALFONSO });
    expect(computeReconciliationPatch(draw, existing, resolved)).toBeNull();
  });

  it('returns null when existing.status === live', () => {
    const draw = baseDraw({ team1_player1_name: 'Barahona', team1_player2_name: 'Alfonso' });
    const existing = baseExisting({ status: 'live', pair1_player1_id: GARRIDO, pair1_player2_id: BERGAMINI });
    const resolved = baseResolved({ p1p1: BARAHONA, p1p2: ALFONSO });
    expect(computeReconciliationPatch(draw, existing, resolved)).toBeNull();
  });
});

describe('computeReconciliationPatch — MD020 team swap', () => {
  it('overwrites pair1 player FKs and pair1_seed when both differ from draw', () => {
    // The Albania MD020 case verbatim:
    //   DB held Garrido/Bergamini (seed 5) as pair1; FIP draw updated
    //   the slot to Barahona/Alfonso (seed 9). Pair2 is unchanged.
    const draw = baseDraw({
      match_widget_id: 'MD020',
      round_label: 'R32',
      status: 'scheduled',
      team1_seed: 9,
      team1_player1_name: 'Javier Barahona', team1_player2_name: 'Gonzalo Gabriel Alfonso',
      team2_player1_name: 'Pol Hernandez Alvarez', team2_player2_name: 'Guillermo Collado Losada',
    });
    const existing = baseExisting({
      pair1_player1_id: GARRIDO, pair1_player2_id: BERGAMINI,
      pair2_player1_id: HERNANDEZ, pair2_player2_id: COLLADO,
      pair1_seed: 5,
    });
    const resolved = baseResolved({
      p1p1: BARAHONA, p1p2: ALFONSO, p2p1: HERNANDEZ, p2p2: COLLADO,
    });
    const patch = computeReconciliationPatch(draw, existing, resolved);
    expect(patch).toEqual({
      pair1_player1_id: BARAHONA,
      pair1_player2_id: ALFONSO,
      pair1_player1_name: null,
      pair1_player2_name: null,
      pair1_player1_country: null,
      pair1_player2_country: null,
      pair1_seed: 9,
    });
  });
});

describe('computeReconciliationPatch — pair orientation', () => {
  it('returns null when DB pair1/pair2 are swapped vs draw T1/T2', () => {
    // Crionet occasionally flips T1/T2 between snapshots — same teams,
    // different ordering should NOT count as drift.
    const draw = baseDraw({
      team1_player1_name: 'Barahona', team1_player2_name: 'Alfonso',
      team2_player1_name: 'Hernandez', team2_player2_name: 'Collado',
      team1_seed: 9,
    });
    const existing = baseExisting({
      pair1_player1_id: HERNANDEZ, pair1_player2_id: COLLADO,
      pair2_player1_id: BARAHONA, pair2_player2_id: ALFONSO,
      pair2_seed: 9,
    });
    const resolved = baseResolved({ p1p1: BARAHONA, p1p2: ALFONSO, p2p1: HERNANDEZ, p2p2: COLLADO });
    expect(computeReconciliationPatch(draw, existing, resolved)).toBeNull();
  });
});

describe('computeReconciliationPatch — MD011 BYE transition', () => {
  it("replaces pair2 + sets status='bye' + winner_pair when draw says BYE-walkover and DB has the wrong team", () => {
    // Albania MD011 verbatim:
    //   DB held Leal/Guerrero as pair2 (status=scheduled); the latest FIP
    //   draw shows the slot is a walkover-bye for Garrido/Bergamini (seed 5)
    //   on the T2 side (T1 empty).
    // The FIP draw encodes BYE-through as status='walkover' with one team
    // empty. Our schema has a distinct 'bye' status — match-detail page
    // renders 'walkover' as a finished "WINNER (W/O)" banner, which is
    // wrong for an auto-advance. Use 'bye' instead.
    const draw = baseDraw({
      match_widget_id: 'MD011',
      round_label: 'R16',
      status: 'walkover',
      team2_seed: 5,
      team2_player1_name: 'Javier Garrido', team2_player2_name: 'Lucas Bergamini',
    });
    const existing = baseExisting({
      round: 'R16',
      round_canonical: 'R16',
      pair2_player1_id: LEAL, pair2_player2_id: GUERRERO,
      pair2_seed: 3,
    });
    const resolved = baseResolved({ p2p1: GARRIDO, p2p2: BERGAMINI });
    const patch = computeReconciliationPatch(draw, existing, resolved);
    // Minimal patch: pair1 fields are not included because the existing
    // row already has pair1 null/null/null — same convention as
    // buildOopPatch (only fields that actually change appear in the patch).
    expect(patch).toEqual({
      pair2_player1_id: GARRIDO,
      pair2_player2_id: BERGAMINI,
      pair2_player1_name: null,
      pair2_player2_name: null,
      pair2_player1_country: null,
      pair2_player2_country: null,
      pair2_seed: 5,
      status: 'bye',
      winner_pair: 2,
    });
  });

  it('returns null when DB already reflects the BYE state', () => {
    const draw = baseDraw({
      match_widget_id: 'MD011', round_label: 'R16', status: 'walkover',
      team2_seed: 5,
      team2_player1_name: 'Garrido', team2_player2_name: 'Bergamini',
    });
    const existing = baseExisting({
      status: 'bye', round: 'R16', round_canonical: 'R16',
      pair2_player1_id: GARRIDO, pair2_player2_id: BERGAMINI,
      pair2_seed: 5, winner_pair: 2,
    });
    const resolved = baseResolved({ p2p1: GARRIDO, p2p2: BERGAMINI });
    expect(computeReconciliationPatch(draw, existing, resolved)).toBeNull();
  });

  it("flips an existing status='walkover' BYE row to 'bye' (the regression fix path)", () => {
    // Captures the regression that prompted this fix: rows that were
    // already in DB as status='walkover' with the right team/seed/winner
    // must still be re-patched to status='bye' on the next run.
    const draw = baseDraw({
      match_widget_id: 'MD011', round_label: 'R16', status: 'walkover',
      team2_seed: 5,
      team2_player1_name: 'Garrido', team2_player2_name: 'Bergamini',
    });
    const existing = baseExisting({
      status: 'walkover', round: 'R16', round_canonical: 'R16',
      pair2_player1_id: GARRIDO, pair2_player2_id: BERGAMINI,
      pair2_seed: 5, winner_pair: 2,
    });
    const resolved = baseResolved({ p2p1: GARRIDO, p2p2: BERGAMINI });
    expect(computeReconciliationPatch(draw, existing, resolved)).toEqual({
      status: 'bye',
    });
  });

  it('places bye-recipient on pair1 when draw has T1 named and T2 empty', () => {
    const draw = baseDraw({
      match_widget_id: 'MD007', round_label: 'R16', status: 'walkover',
      team1_seed: 1,
      team1_player1_name: 'Player A', team1_player2_name: 'Player B',
    });
    const existing = baseExisting({ round: 'R16', round_canonical: 'R16' });
    const resolved = baseResolved({ p1p1: 'a-uuid', p1p2: 'b-uuid' });
    const patch = computeReconciliationPatch(draw, existing, resolved);
    expect(patch).toEqual({
      pair1_player1_id: 'a-uuid',
      pair1_player2_id: 'b-uuid',
      pair1_player1_name: null,
      pair1_player2_name: null,
      pair1_player1_country: null,
      pair1_player2_country: null,
      pair1_seed: 1,
      status: 'bye',
      winner_pair: 1,
    });
  });
});

describe('computeReconciliationPatch — both-teams walkover', () => {
  it('flips status to walkover but does not set winner_pair when both teams named', () => {
    const draw = baseDraw({
      status: 'walkover',
      team1_player1_name: 'Barahona', team1_player2_name: 'Alfonso',
      team2_player1_name: 'Hernandez', team2_player2_name: 'Collado',
      team1_seed: 9,
    });
    const existing = baseExisting({
      pair1_player1_id: BARAHONA, pair1_player2_id: ALFONSO,
      pair2_player1_id: HERNANDEZ, pair2_player2_id: COLLADO,
      pair1_seed: 9,
    });
    const resolved = baseResolved({ p1p1: BARAHONA, p1p2: ALFONSO, p2p1: HERNANDEZ, p2p2: COLLADO });
    expect(computeReconciliationPatch(draw, existing, resolved)).toEqual({
      status: 'walkover',
    });
  });
});

describe('computeReconciliationPatch — round canonicalisation', () => {
  it('returns null when verbose round matches canonical (Round of 16 ↔ R16)', () => {
    const draw = baseDraw({
      round_label: 'Round of 16',
      team1_player1_name: 'Barahona', team1_player2_name: 'Alfonso',
      team2_player1_name: 'Hernandez', team2_player2_name: 'Collado',
    });
    const existing = baseExisting({
      round: 'R16', round_canonical: 'R16',
      pair1_player1_id: BARAHONA, pair1_player2_id: ALFONSO,
      pair2_player1_id: HERNANDEZ, pair2_player2_id: COLLADO,
    });
    const resolved = baseResolved({ p1p1: BARAHONA, p1p2: ALFONSO, p2p1: HERNANDEZ, p2p2: COLLADO });
    expect(computeReconciliationPatch(draw, existing, resolved)).toBeNull();
  });

  it('writes round + round_canonical when canonical forms differ', () => {
    const draw = baseDraw({
      round_label: 'R16',
      team1_player1_name: 'Barahona', team1_player2_name: 'Alfonso',
      team2_player1_name: 'Hernandez', team2_player2_name: 'Collado',
    });
    const existing = baseExisting({
      round: 'R32', round_canonical: 'R32',
      pair1_player1_id: BARAHONA, pair1_player2_id: ALFONSO,
      pair2_player1_id: HERNANDEZ, pair2_player2_id: COLLADO,
    });
    const resolved = baseResolved({ p1p1: BARAHONA, p1p2: ALFONSO, p2p1: HERNANDEZ, p2p2: COLLADO });
    expect(computeReconciliationPatch(draw, existing, resolved)).toEqual({
      round: 'R16',
      round_canonical: 'R16',
    });
  });
});

describe('computeReconciliationPatch — slot-level skip on unresolved name', () => {
  it('leaves existing FK alone when draw has a name but resolver returned null for that slot', () => {
    // Draw says team1_player1 is "Some Local Player" but the resolver
    // couldn't map the name to a players row. We must NOT overwrite the
    // existing valid FK with null — that would degrade a resolved row.
    const draw = baseDraw({
      team1_player1_name: 'Some Local Player', team1_player2_name: 'Alfonso',
      team2_player1_name: 'Hernandez', team2_player2_name: 'Collado',
    });
    const existing = baseExisting({
      pair1_player1_id: BARAHONA, pair1_player2_id: ALFONSO,
      pair2_player1_id: HERNANDEZ, pair2_player2_id: COLLADO,
    });
    const resolved = baseResolved({
      p1p1: null,           // unresolved — must skip
      p1p2: ALFONSO,
      p2p1: HERNANDEZ,
      p2p2: COLLADO,
    });
    expect(computeReconciliationPatch(draw, existing, resolved)).toBeNull();
  });
});

describe('computeReconciliationPatch — seed-only drift', () => {
  it('writes pair1_seed when it differs and players match', () => {
    const draw = baseDraw({
      team1_player1_name: 'Barahona', team1_player2_name: 'Alfonso',
      team2_player1_name: 'Hernandez', team2_player2_name: 'Collado',
      team1_seed: 9,
    });
    const existing = baseExisting({
      pair1_player1_id: BARAHONA, pair1_player2_id: ALFONSO,
      pair2_player1_id: HERNANDEZ, pair2_player2_id: COLLADO,
      pair1_seed: null,
    });
    const resolved = baseResolved({ p1p1: BARAHONA, p1p2: ALFONSO, p2p1: HERNANDEZ, p2p2: COLLADO });
    expect(computeReconciliationPatch(draw, existing, resolved)).toEqual({
      pair1_seed: 9,
    });
  });
});

// ─── Late-round-bye false-positive — see PR following the 2026-05-27 Albania
// incident. Reconciler must NOT treat a later-round walkover+one-empty cell
// as a real BYE event; those describe TBD feeders, not auto-advancers. The
// populator already has this guard (see computeFirstRoundByCategory). Mirror
// it via the ctx.firstMdRoundCanonical context param. ────────────────────
describe('computeReconciliationPatch — first-round-of-MD guard on isBye', () => {
  it('does NOT bye-patch a later-round walkover+one-empty cell when ctx says first MD round is earlier', () => {
    // Albania MD011 verbatim (the bug): R16 cell waiting on R32 winner.
    // FIP renders it as walkover with team1 empty + team2 seeded; this
    // is a TBD feeder, not a real BYE.
    const draw = baseDraw({
      match_widget_id: 'MD011',
      round_label: 'R16',
      status: 'walkover',
      team2_seed: 5,
      team2_player1_name: 'Javier Garrido',
      team2_player2_name: 'Lucas Bergamini',
    });
    const existing = baseExisting({
      round: 'R16', round_canonical: 'R16',
      pair2_player1_id: GARRIDO, pair2_player2_id: BERGAMINI,
      pair2_seed: 5,
    });
    const resolved = baseResolved({ p2p1: GARRIDO, p2p2: BERGAMINI });
    // R32 is the first MD round for a 28-pair draw — R16 is NOT.
    const patch = computeReconciliationPatch(draw, existing, resolved, {
      firstMdRoundCanonical: 'R32',
    });
    // Should not write status='bye'/'walkover' nor set winner_pair.
    // (computeNonByePatch branch may write status='walkover' for the
    // scheduled→walkover edge, but no winner_pair / pair-clearing.)
    expect(patch).toBeNull();
  });

  it('STILL bye-patches a first-round walkover+one-empty cell when ctx matches', () => {
    // Same shape as MD011 but on R32 (first MD round in a 28-pair draw).
    // Real R32 bye for the seed — must produce the bye patch.
    const draw = baseDraw({
      match_widget_id: 'MD011',
      round_label: 'R32',
      status: 'walkover',
      team2_seed: 5,
      team2_player1_name: 'Javier Garrido',
      team2_player2_name: 'Lucas Bergamini',
    });
    const existing = baseExisting({
      round: 'R32', round_canonical: 'R32',
    });
    const resolved = baseResolved({ p2p1: GARRIDO, p2p2: BERGAMINI });
    const patch = computeReconciliationPatch(draw, existing, resolved, {
      firstMdRoundCanonical: 'R32',
    });
    expect(patch).toEqual({
      pair2_player1_id: GARRIDO,
      pair2_player2_id: BERGAMINI,
      pair2_player1_name: null,
      pair2_player2_name: null,
      pair2_player1_country: null,
      pair2_player2_country: null,
      pair2_seed: 5,
      status: 'bye',
      winner_pair: 2,
    });
  });
});

describe('computeReconciliationPatch — unbye reversal', () => {
  it("reverses status='bye' + winner_pair when draw later shows scheduled with both teams named", () => {
    // The cure path: a row was wrongly bye-flagged by an earlier
    // reconciler run (before the first-round guard or before the draw
    // refreshed). The draw now shows the real R16 match scheduled with
    // both teams populated. We must roll the row back to scheduled +
    // clear winner_pair so the bracket and match page render correctly.
    const draw = baseDraw({
      match_widget_id: 'MD011',
      round_label: 'R16',
      status: 'scheduled',
      team2_seed: 5,
      team1_player1_name: 'Maximiliano Arce Simo',
      team1_player2_name: 'Alejandro Arroyo',
      team2_player1_name: 'Javier Garrido',
      team2_player2_name: 'Lucas Bergamini',
    });
    const existing = baseExisting({
      status: 'bye', winner_pair: 2,
      round: 'R16', round_canonical: 'R16',
      pair1_player1_id: 'arce-uuid', pair1_player2_id: 'arroyo-uuid',
      pair2_player1_id: GARRIDO, pair2_player2_id: BERGAMINI,
      pair2_seed: 5,
    });
    const resolved = baseResolved({
      p1p1: 'arce-uuid', p1p2: 'arroyo-uuid',
      p2p1: GARRIDO, p2p2: BERGAMINI,
    });
    expect(computeReconciliationPatch(draw, existing, resolved, {
      firstMdRoundCanonical: 'R32',
    })).toEqual({
      status: 'scheduled',
      winner_pair: null,
    });
  });

  it("reverses status='walkover' + winner_pair (the pre-PR-453 false-positive shape) when draw now shows scheduled with both teams named", () => {
    // WD015 verbatim: pre-PR-#453 the reconciler wrote status='walkover'
    // for BYE-through cells. Some rows never got the walkover→bye retro
    // flip because the draw had already moved to scheduled by then.
    // Existing winner_pair makes the match page render "WINNER (W/O)".
    const draw = baseDraw({
      match_widget_id: 'WD015',
      round_label: 'R16',
      status: 'scheduled',
      team2_seed: 2,
      team1_player1_name: 'Carmen Castillon Gamez',
      team1_player2_name: 'Maria Portillo Perez',
      team2_player1_name: 'Marina Guinart España',
      team2_player2_name: 'Veronica Virseda',
    });
    const existing = baseExisting({
      status: 'walkover', winner_pair: 2,
      round: 'R16', round_canonical: 'R16',
      pair1_player1_id: 'castillon-uuid', pair1_player2_id: 'portillo-uuid',
      pair2_player1_id: 'guinart-uuid', pair2_player2_id: 'virseda-uuid',
      pair2_seed: 2,
    });
    const resolved = baseResolved({
      p1p1: 'castillon-uuid', p1p2: 'portillo-uuid',
      p2p1: 'guinart-uuid', p2p2: 'virseda-uuid',
    });
    expect(computeReconciliationPatch(draw, existing, resolved, {
      firstMdRoundCanonical: 'R32',
    })).toEqual({
      status: 'scheduled',
      winner_pair: null,
    });
  });

  it("does NOT unbye a genuine walkover (existing walkover+winner, draw still walkover with both teams named)", () => {
    // A real walkover: both teams named, one withdrew. The draw keeps
    // showing walkover (no R-prior winner to flip it back to scheduled
    // because the bracket was always populated). winner_pair must stay
    // — that's the team that didn't withdraw.
    const draw = baseDraw({
      round_label: 'R16',
      status: 'walkover',
      team1_player1_name: 'Barahona', team1_player2_name: 'Alfonso',
      team2_player1_name: 'Hernandez', team2_player2_name: 'Collado',
      team1_seed: 9,
    });
    const existing = baseExisting({
      status: 'walkover', winner_pair: 1,
      round: 'R16', round_canonical: 'R16',
      pair1_player1_id: BARAHONA, pair1_player2_id: ALFONSO,
      pair2_player1_id: HERNANDEZ, pair2_player2_id: COLLADO,
      pair1_seed: 9,
    });
    const resolved = baseResolved({
      p1p1: BARAHONA, p1p2: ALFONSO, p2p1: HERNANDEZ, p2p2: COLLADO,
    });
    expect(computeReconciliationPatch(draw, existing, resolved, {
      firstMdRoundCanonical: 'R32',
    })).toBeNull();
  });
});
