// apps/ops/src/lib/command-palette.ts
//
// Data layer for the ⌘K command palette. Two halves:
//   1. PAGE_COMMANDS + filterPages — a static index of the admin's pages
//      (mirrors the rail in components/shell/Rail.tsx) with a plain filter.
//   2. searchEntities — best-effort entity search (players / tournaments /
//      matches) over /api/internal/search. Never throws into the UI.

export interface PageCommand { href: string; label: string; group: string }

export const PAGE_COMMANDS: PageCommand[] = [
  { href: '/today', label: 'Today', group: 'Dashboard' },
  { href: '/odds', label: 'Live Odds', group: 'Dashboard' },
  { href: '/odds/calibration', label: 'Odds · Calibration', group: 'Dashboard' },
  { href: '/odds/methodology', label: 'Odds · Methodology', group: 'Dashboard' },
  { href: '/tournament-explorer', label: 'Tournament Explorer', group: 'Tournament Ops' },
  { href: '/entry-lists', label: 'Entry Lists', group: 'Tournament Ops' },
  { href: '/needs-review', label: 'Needs Review', group: 'Tournament Ops' },
  { href: '/simulator', label: 'Simulator', group: 'Tournament Ops' },
  { href: '/players', label: 'Players', group: 'Catalogs' },
  { href: '/brands', label: 'Brands', group: 'Catalogs' },
  { href: '/streams', label: 'Streams', group: 'Catalogs' },
  { href: '/yt-channels', label: 'YouTube Channels', group: 'Catalogs' },
  { href: '/partners', label: 'Partners', group: 'Catalogs' },
  { href: '/news', label: 'News', group: 'Content' },
  { href: '/news-sources', label: 'News Sources', group: 'Content' },
  { href: '/highlights', label: 'Highlights', group: 'Content' },
  { href: '/system/integration-health', label: 'Integration Health', group: 'System' },
  { href: '/system/data-quality', label: 'Data Quality', group: 'System' },
  { href: '/system/padelgod-health', label: 'Padelgod Health', group: 'System' },
  { href: '/system/shadow-mode', label: 'Shadow Mode', group: 'System' },
  { href: '/system/coverage-matrix', label: 'Coverage Matrix', group: 'System' },
  { href: '/system/feature-flags', label: 'Feature Flags', group: 'System' },
  { href: '/system/ocr-health', label: 'OCR Health', group: 'System' },
  { href: '/system/seo', label: 'SEO', group: 'System' },
  { href: '/system/architecture', label: 'Architecture', group: 'System' },
]

export function filterPages(query: string): PageCommand[] {
  const q = query.trim().toLowerCase()
  if (q === '') return PAGE_COMMANDS
  return PAGE_COMMANDS.filter(
    (c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q),
  )
}

export interface EntityHit { kind: 'player' | 'tournament' | 'match'; id: string; label: string; sub?: string; href: string }

/** Best-effort entity search. Returns [] on empty query or any error (never throws into the UI). */
export async function searchEntities(query: string, signal?: AbortSignal): Promise<EntityHit[]> {
  const q = query.trim()
  if (q.length < 2) return []
  try {
    const res = await fetch(`/api/internal/search?q=${encodeURIComponent(q)}`, { signal })
    if (!res.ok) return []
    const data = (await res.json()) as { hits?: EntityHit[] }
    return data.hits ?? []
  } catch {
    return []
  }
}
