// src/app/padelgodapi/_lib/navigation.ts
// Single source of truth for the docs sidebar structure.
// Reorder / rename freely — the sidebar + prev/next links all read from here.

export interface NavItem {
  label: string
  href: string
  /** When true, renders as a muted "Coming soon" label + disabled link */
  comingSoon?: boolean
}

export interface NavSection {
  title: string
  items: NavItem[]
}

export const DOCS_NAVIGATION: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Introduction', href: '/padelgodapi/introduction' },
      { label: 'Coverage', href: '/padelgodapi/coverage' },
      { label: 'Roadmap', href: '/padelgodapi/roadmap' },
    ],
  },
  {
    title: 'How it works',
    items: [
      { label: 'Architecture', href: '/padelgodapi/architecture' },
      { label: 'Workers', href: '/padelgodapi/workers' },
      { label: 'Data model', href: '/padelgodapi/data-model' },
    ],
  },
  {
    title: 'Pipelines',
    items: [
      { label: 'Live scoring', href: '/padelgodapi/pipelines/live-scoring' },
    ],
  },
  {
    title: 'Developer API',
    items: [
      { label: 'Getting started', href: '/padelgodapi/getting-started', comingSoon: true },
      { label: 'Authentication', href: '/padelgodapi/authentication', comingSoon: true },
      { label: 'Endpoints', href: '/padelgodapi/endpoints', comingSoon: true },
      { label: 'Rate limits', href: '/padelgodapi/rate-limits', comingSoon: true },
      { label: 'Error codes', href: '/padelgodapi/error-codes', comingSoon: true },
    ],
  },
]

/**
 * Flat, ordered list of real (non-comingSoon) items — used for prev/next
 * navigation at the bottom of the main content pages.
 */
export const FLAT_NAVIGATION: NavItem[] = DOCS_NAVIGATION.flatMap(s =>
  s.items.filter(i => !i.comingSoon)
)

/**
 * Worker detail pages live under `/padelgodapi/workers/<name>` but are
 * intentionally NOT in the sidebar (the nav would bloat once all 13 exist).
 * This array drives `PrevNextLinks` for those pages in pipeline reading
 * order (poller → diff → reconciler). Add new worker pages here as waves
 * ship.
 */
export const WORKER_DETAIL_ORDER: NavItem[] = [
  { label: 'live-poller-manager', href: '/padelgodapi/workers/live-poller-manager' },
  { label: 'shadow-diff-live', href: '/padelgodapi/workers/shadow-diff-live' },
  { label: 'static-reconciler', href: '/padelgodapi/workers/static-reconciler' },
]

function findInList(list: NavItem[], href: string): { prev: NavItem | null; next: NavItem | null } | null {
  const idx = list.findIndex(i => i.href === href)
  if (idx === -1) return null
  return {
    prev: idx > 0 ? list[idx - 1]! : null,
    next: idx < list.length - 1 ? list[idx + 1]! : null,
  }
}

/**
 * Return the prev/next items for a given href. Tries `FLAT_NAVIGATION` first,
 * then falls back to `WORKER_DETAIL_ORDER`. Returns `{ prev: null, next: null }`
 * if the href is in neither list.
 */
export function getAdjacent(currentHref: string): {
  prev: NavItem | null
  next: NavItem | null
} {
  return (
    findInList(FLAT_NAVIGATION, currentHref) ??
    findInList(WORKER_DETAIL_ORDER, currentHref) ??
    { prev: null, next: null }
  )
}
