// Pure helpers for projection pair URL slugs. A pair slug is a readable,
// SEO-friendly identity ("tapia-coello") derived from player surnames, but
// always resolved back to a stable pair_key against player IDs. No I/O here.

export interface SlugPlayer {
  id: string
  name: string
}

export interface SlugRow {
  pair_key: string
  pair_player_ids: string[]
}

export interface SlugIndex {
  /** canonical slug -> pair_key */
  slugToPairKey: Map<string, string>
  /** pair_key -> canonical slug */
  pairKeyToSlug: Map<string, string>
  /** sorted-surname-set key -> pair_key (for order-insensitive fallback) */
  surnameSetToPairKey: Map<string, string>
}

/** Lowercase, strip diacritics, keep [a-z0-9], collapse to single dashes. */
function normalizeToken(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Last whitespace-separated token of a full name, normalized. Falls back to whole name. */
function surnameOf(name: string): string {
  const tokens = name.trim().split(/\s+/)
  const last = tokens.length > 0 ? tokens[tokens.length - 1] : name
  return normalizeToken(last) || normalizeToken(name)
}

/** Build a deterministic pair slug from its players (ordered by player id). */
export function pairSlugFromNames(players: SlugPlayer[]): string {
  return [...players]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((p) => surnameOf(p.name))
    .join('-')
}

/** Sorted set of surnames, used as an order-insensitive fallback key. */
function surnameSetKey(players: SlugPlayer[]): string {
  return players.map((p) => surnameOf(p.name)).sort().join('|')
}

export function buildSlugIndex(rows: SlugRow[], nameById: Map<string, string>): SlugIndex {
  const slugToPairKey = new Map<string, string>()
  const pairKeyToSlug = new Map<string, string>()
  const surnameSetToPairKey = new Map<string, string>()

  for (const row of rows) {
    const players: SlugPlayer[] = row.pair_player_ids.map((id) => ({ id, name: nameById.get(id) ?? id }))
    const slug = pairSlugFromNames(players)
    slugToPairKey.set(slug, row.pair_key)
    pairKeyToSlug.set(row.pair_key, slug)
    surnameSetToPairKey.set(surnameSetKey(players), row.pair_key)
  }

  return { slugToPairKey, pairKeyToSlug, surnameSetToPairKey }
}

export interface ResolvedSlug {
  pairKey: string
  canonicalSlug: string
  /** true when the requested slug differs from canonical (caller should 308-redirect) */
  redirect: boolean
}

/**
 * Resolve a requested slug to a pair.
 *  1. Exact canonical match -> no redirect.
 *  2. Order-insensitive surname-set match -> redirect to canonical.
 *  3. Otherwise null (caller -> notFound()).
 */
export function resolvePairSlug(index: SlugIndex, requestedSlug: string): ResolvedSlug | null {
  const exact = index.slugToPairKey.get(requestedSlug)
  if (exact) {
    return { pairKey: exact, canonicalSlug: requestedSlug, redirect: false }
  }
  const setKey = requestedSlug.split('-').sort().join('|')
  const bySet = index.surnameSetToPairKey.get(setKey)
  if (bySet) {
    return { pairKey: bySet, canonicalSlug: index.pairKeyToSlug.get(bySet)!, redirect: true }
  }
  return null
}
