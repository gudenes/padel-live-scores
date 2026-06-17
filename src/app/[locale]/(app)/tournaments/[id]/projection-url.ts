// Pure builder for the in-page Projection tab query string. Used by the
// tournament page to shallow-sync the active projection view into the URL
// (?tab=projection&category=<cat>[&pair=<slug>]) so it's deep-linkable
// without a route navigation.

export function buildProjectionQuery(
  category: 'men' | 'women',
  pairSlug: string | null,
): string {
  const base = `?tab=projection&category=${category}`
  return pairSlug ? `${base}&pair=${encodeURIComponent(pairSlug)}` : base
}
