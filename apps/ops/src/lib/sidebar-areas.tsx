// apps/ops/src/lib/sidebar-areas.tsx
// Canonical registry for the 2-column sidebar: areas + their pages + a path
// matcher. Used by SidebarPrimary, SidebarSecondary, and the activity rail
// (which surfaces page names in audit-trail events).

import type { ReactNode } from 'react'

export type AreaId = 'home' | 'tournament-ops' | 'catalogs' | 'content' | 'system'

export interface Page {
  href: string
  label: string
}

export interface Area {
  id: AreaId
  label: string
  /** Inline SVG path data for a 24x24 viewBox. Caller wraps in <svg>. */
  iconPath: ReactNode
  pages: Page[]
}

const calendarClockIcon = (
  <>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </>
)

const trophyIcon = (
  <>
    <path d="M6 9V4h12v5" />
    <path d="M6 9a6 6 0 0 0 12 0" />
    <path d="M9 21h6" />
    <path d="M12 17v4" />
    <path d="M3 5h3" />
    <path d="M18 5h3" />
  </>
)

const layersIcon = (
  <>
    <rect x="3" y="4" width="18" height="4" rx="1" />
    <rect x="3" y="11" width="18" height="4" rx="1" />
    <rect x="3" y="18" width="18" height="3" rx="1" />
  </>
)

const fileTextIcon = (
  <>
    <path d="M4 4h12a2 2 0 0 1 2 2v14" />
    <path d="M4 4v16h14" />
    <path d="M8 8h6" />
    <path d="M8 12h6" />
    <path d="M8 16h4" />
  </>
)

const settingsIcon = (
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>
)

export const AREAS: ReadonlyArray<Area> = [
  {
    id: 'home',
    label: 'Home',
    iconPath: calendarClockIcon,
    pages: [{ href: '/today', label: 'Today' }],
  },
  {
    id: 'tournament-ops',
    label: 'Tournament Ops',
    iconPath: trophyIcon,
    pages: [
      { href: '/tournament-explorer', label: 'Tournament Explorer' },
      { href: '/entry-lists', label: 'Entry Lists' },
      { href: '/needs-review', label: 'Needs Review' },
      { href: '/simulator', label: 'Simulator' },
    ],
  },
  {
    id: 'catalogs',
    label: 'Catalogs',
    iconPath: layersIcon,
    pages: [
      { href: '/players', label: 'Players' },
      { href: '/brands', label: 'Brands & Equipment' },
      { href: '/streams', label: 'Streams' },
      { href: '/yt-channels', label: 'YT Channels' },
    ],
  },
  {
    id: 'content',
    label: 'Content',
    iconPath: fileTextIcon,
    pages: [
      { href: '/news', label: 'News' },
      { href: '/highlights', label: 'Highlights' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    iconPath: settingsIcon,
    pages: [
      { href: '/system/integration-health', label: 'Integration Health' },
      { href: '/system/data-quality', label: 'Data Quality' },
      { href: '/system/padelgod-health', label: 'Padelgod Health' },
      { href: '/system/shadow-mode', label: 'Shadow Mode' },
      { href: '/system/coverage-matrix', label: 'Coverage Matrix' },
      { href: '/system/feature-flags', label: 'Feature Flags' },
      { href: '/system/architecture', label: 'Architecture' },
    ],
  },
]

/**
 * Derive the active sidebar area from a pathname (may include query string).
 * Falls back to 'home' for unknown paths so the UI never breaks.
 */
export function areaFor(pathname: string): AreaId {
  const path = pathname.split('?')[0].replace(/\/+$/, '') || '/'

  if (path === '/today' || path.startsWith('/today/')) return 'home'

  if (
    path === '/tournament-explorer' || path.startsWith('/tournament-explorer/') ||
    path === '/entry-lists' || path.startsWith('/entry-lists/') ||
    path === '/needs-review' || path.startsWith('/needs-review/') ||
    path === '/simulator' || path.startsWith('/simulator/')
  ) return 'tournament-ops'

  if (
    path === '/players' || path.startsWith('/players/') ||
    path === '/brands' || path.startsWith('/brands/') ||
    path === '/streams' || path.startsWith('/streams/') ||
    path === '/yt-channels' || path.startsWith('/yt-channels/')
  ) return 'catalogs'

  if (
    path === '/news' || path.startsWith('/news/') ||
    path === '/highlights' || path.startsWith('/highlights/')
  ) return 'content'

  if (path === '/system' || path.startsWith('/system/')) return 'system'

  return 'home'
}
