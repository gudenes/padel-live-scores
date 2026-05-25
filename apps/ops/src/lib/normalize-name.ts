// apps/ops/src/lib/normalize-name.ts
//
// Name normalization shared by the entry-list aggregator, the
// player-search route, and the alias upserts. Byte-identical to
// `padelgod/src/lib/db-resolver.ts::normalizeName` — which is the
// authoritative source because padelgod is what populates the
// `players.normalized_name` column and the alias `metadata.normalized`
// JSON field that this function compares against.
//
// The main-app `src/lib/player-resolver.ts::normalize` is behaviorally
// equivalent but uses a two-step collapse (`/[^a-z0-9]/g` then
// `/\s+/g`) instead of a single `/[^a-z0-9]+/g`. The outputs match for
// every real input — the difference is cosmetic — but if you ever
// need to confirm that, this is the file to read first.
//
// Kept as its own file rather than reaching across packages.

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
