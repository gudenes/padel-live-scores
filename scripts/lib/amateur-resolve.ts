// scripts/lib/amateur-resolve.ts
// Player resolution for the season import.
//
// The id wins over the name, always. A spreadsheet name is edited by hand and
// drifts — accents get fixed, case changes, a surname is added. The SNP id
// does not. Resolving by name first would mean a corrected accent silently
// creates a second player and orphans the original's history.

export interface ResolutionIndex {
  bySnpId: Map<string, string>
  byNormalizedName: Map<string, string>
}

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function resolvePlayerId(
  index: ResolutionIndex,
  snpId: string | null,
  name: string,
): string | null {
  if (snpId) {
    const byId = index.bySnpId.get(snpId)
    if (byId) return byId
  }
  return index.byNormalizedName.get(normalizeName(name)) ?? null
}
