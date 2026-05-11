// Mirror of /src/lib/round-canonical.ts on the Vercel side. Keep in
// lock-step — there's no shared workspace import path between the two
// codebases. Padelgod writers use this to set `matches.round_canonical`
// at INSERT time so downstream consumers (bracket builder, schedule UI,
// indexed lookups) get the normalized form without a backfill step.

export type RoundCode =
  | 'F'
  | 'SF'
  | 'QF'
  | 'R16'
  | 'R32'
  | 'R64'
  | 'Q1'
  | 'Q2'
  | 'Q3';

const MAP: Record<string, RoundCode> = {
  // Final
  final: 'F',
  finals: 'F',
  f: 'F',
  // Semifinal
  semifinal: 'SF',
  semifinals: 'SF',
  sf: 'SF',
  // Quarter
  quarter: 'QF',
  quarterfinal: 'QF',
  quarterfinals: 'QF',
  qf: 'QF',
  // Round of N
  'round of 16': 'R16',
  r16: 'R16',
  'round of 32': 'R32',
  r32: 'R32',
  'round of 64': 'R64',
  r64: 'R64',
  // Qualifiers
  q1: 'Q1',
  q2: 'Q2',
  q3: 'Q3',
};

export function roundCanonical(input: string | null | undefined): RoundCode | null {
  if (input == null) return null;
  const key = input.trim().toLowerCase();
  if (!key) return null;
  return MAP[key] ?? null;
}
