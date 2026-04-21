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
 * Flat, ordered list of real (non-comingSoon) items — useful for prev/next
 * navigation at the bottom of content pages.
 */
export const FLAT_NAVIGATION: NavItem[] = DOCS_NAVIGATION.flatMap(s =>
  s.items.filter(i => !i.comingSoon)
)

export function getAdjacent(currentHref: string): {
  prev: NavItem | null
  next: NavItem | null
} {
  const idx = FLAT_NAVIGATION.findIndex(i => i.href === currentHref)
  if (idx === -1) return { prev: null, next: null }
  return {
    prev: idx > 0 ? FLAT_NAVIGATION[idx - 1]! : null,
    next: idx < FLAT_NAVIGATION.length - 1 ? FLAT_NAVIGATION[idx + 1]! : null,
  }
}
