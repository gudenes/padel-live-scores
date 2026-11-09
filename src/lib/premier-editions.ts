import catalog from './premier-editions.json'

// Audited public records, 2026-11-09. This is a UI catalog, not a database
// migration. Add new record IDs explicitly; never infer identity from sponsors,
// cities or tier alone. Different events in Acapulco remain separate series.
export const premierEditions = catalog
const premierLevels = new Set(['p1', 'p2', 'major', 'finals'])

// Finals 2025: the Barcelona record has the 14 matches; the commercial-name
// record is empty. Mexico 2025 and Madrid 2026 use the selected official records.
const preferredRecords: Record<string, string> = {
  'finals:2025': '29fbd066-1879-4f15-b9b6-8f9535a6b647',
  'mexico-major:2025': 'c3fc9afd-adff-49ba-88bc-abaabc098732',
  'madrid:2026': '8083ac24-da11-4a8f-84c5-708c21307e9f',
}

/** Only reviewed duplicates resolve to another ID; source alone is not identity. */
export function preferredPremierTournamentId(id: string): string {
  const row = catalog.find(row => row.id === id)
  return row ? preferredRecords[`${row.series}:${row.year}`] ?? id : id
}

/** Filter fetched rows, preserving their metadata and order. Keep an alias if
 * the preferred row is absent from this query (pagination/filtering/failure).
 * This is presentation deduplication, never a match or database merge.
 */
export function dedupePremierTournaments<T extends { id: string }>(rows: readonly T[]): T[] {
  const present = new Set(rows.map(row => row.id))
  return rows.filter(row => {
    const preferred = preferredPremierTournamentId(row.id)
    return preferred === row.id || !present.has(preferred)
  })
}

/** One displayed record where a preferred edition was explicitly reviewed.
 * Alias IDs stay in the catalog so existing URLs still resolve their history.
 */
export function visiblePremierEditions() {
  return catalog.filter(row => {
    const preferred = preferredRecords[`${row.series}:${row.year}`]
    return !preferred || row.id === preferred
  })
}

export function resolvePremierPreviousEdition(id: string, level?: string | null) {
  const current = catalog.find(row => row.id === id)
  if (!current) return {
    handled: premierLevels.has((level ?? '').toLowerCase()),
    previous: null,
    reason: 'unlisted' as const,
  }
  const older = catalog.filter(row => row.series === current.series
    && row.year < current.year && row.ends_at < current.starts_at)
  const year = Math.max(...older.map(row => row.year))
  const candidates = older.filter(row => row.year === year)
  const preferred = preferredRecords[`${current.series}:${year}`]
  const previous = candidates.length === 1 ? candidates[0]
    : candidates.find(row => row.id === preferred) ?? null
  return {
    handled: true,
    previous,
    reason: previous ? 'linked' as const
      : candidates.length ? 'duplicate-review' as const : 'no-previous' as const,
  }
}
