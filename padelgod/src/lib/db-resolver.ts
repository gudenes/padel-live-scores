// padelgod/src/lib/db-resolver.ts
//
// Read-only player-lookup library used by the entry-list-fetcher (and any
// future padelgod worker that needs to resolve a parsed player name to a
// canonical fip_id). Mirrors the lookup chain of src/lib/player-resolver.ts
// in the main repo, minus the create-on-miss path — workers should never
// silently mint player rows from PDF data.
//
// Chain (first hit wins):
//   1. exact fip_id (handled by the caller, since fip_ids land via padelapi
//      or FIP-search, not via name parsing)
//   2. ALIAS: entity_external_ids row with source='alias' whose normalized
//      external_id matches the parsed name
//   3. exact normalized-name match in public.players (category-scoped,
//      country-narrowed, ranking-disambiguated)
//   4. SUBSET fuzzy: every token of the shorter side appears in the longer
//      side (catches "Alejandro Ruiz Granados" → "Alejandro Ruiz")
//   5. TYPO-tolerant fuzzy: ≥0.9 token overlap with 1-char edit tolerance on
//      tokens ≥4 chars (catches "Giannina"/"Gianina" class)
//
// Aliases are auto-stored on successful fuzzy match so subsequent snapshots
// hit step 2 instantly.

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
